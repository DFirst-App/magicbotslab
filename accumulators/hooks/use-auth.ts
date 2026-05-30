'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  handleOAuthCallback,
  refreshAccessToken,
  fetchAccounts,
  getWebSocketOTP,
  getAuthInfo,
  getDerivAccounts,
  getActiveLoginId,
  setActiveLoginId,
  setAccountType,
  clearAllAuthData,
  parseReferralLink,
} from '@deriv/core';
import type { AuthInfo, DerivAccount, AuthState, AuthConfig } from '@deriv/core';
import {
  ensureMblAuthSynced,
  getMblPreferredLoginId,
  MBL_ACTIVE_LOGINID_KEY,
} from '@/lib/mbl-auth-bridge';

const MBL_EMBEDDED = process.env.NEXT_PUBLIC_MBL_EMBEDDED === '1';
const MBL_INDEX_URL = '../index.html';
const MBL_BOTS_URL = '../trading-dashboard.html';

function getAuthConfig(): AuthConfig {
  const config: AuthConfig = {
    clientId: process.env.NEXT_PUBLIC_DERIV_APP_ID ?? '',
    redirectUri:
      process.env.NEXT_PUBLIC_DERIV_REDIRECT_URI ??
      (typeof window !== 'undefined' ? window.location.origin : ''),
  };

  const scopesEnv = process.env.NEXT_PUBLIC_DERIV_OAUTH_SCOPES ?? '';
  if (scopesEnv) {
    config.scopes = scopesEnv.split(',').map((s) => s.trim()).join(' ');
  }

  const referralLink = process.env.NEXT_PUBLIC_DERIV_REFERRAL_LINK ?? '';
  if (referralLink) {
    const referral = parseReferralLink(referralLink);
    if (referral) {
      config.affiliateToken = referral.affiliateToken;
      config.affiliateTokenParam = referral.affiliateTokenParam;
      config.utmCampaign = referral.utmCampaign;
      config.utmSource = referral.utmSource;
      config.utmMedium = referral.utmMedium;
    }
  }

  return config;
}

function pickAccount(accounts: DerivAccount[]): DerivAccount {
  const preferred = getMblPreferredLoginId();
  if (preferred) {
    const match = accounts.find((a) => a.account_id === preferred);
    if (match) return match;
  }
  return accounts.find((a) => a.account_type === 'real') ?? accounts[0];
}

function redirectToConnect() {
  window.location.replace(MBL_INDEX_URL);
}

export interface UseAuthReturn {
  authState: AuthState;
  accounts: DerivAccount[];
  activeAccount: DerivAccount | null;
  activeAccountId: string | null;
  wsUrl: string | undefined;
  login: () => Promise<void>;
  signUp: () => Promise<void>;
  logout: () => void;
  switchAccount: (accountId: string) => Promise<void>;
  error: string | null;
  embeddedMode: boolean;
}

export function useAuth(): UseAuthReturn {
  const [authState, setAuthState] = useState<AuthState>(() =>
    MBL_EMBEDDED ? 'authenticating' : (typeof window !== 'undefined' && getAuthInfo() ? 'authenticated' : 'unauthenticated')
  );
  const [accounts, setAccounts] = useState<DerivAccount[]>(() => {
    if (typeof window === 'undefined') return [];
    return getDerivAccounts() ?? [];
  });
  const [activeAccountId, setActiveAccountIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return getMblPreferredLoginId() ?? getActiveLoginId() ?? null;
  });
  const [wsUrl, setWsUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);
  const activeAccountIdRef = useRef<string | null>(null);
  const tabHiddenAtRef = useRef<number | null>(null);

  const fetchOTPUrl = useCallback(async (accountId: string, authInfo: AuthInfo): Promise<string> => {
    return getWebSocketOTP(accountId, authInfo, getAuthConfig().clientId);
  }, []);

  const completeAuth = useCallback(async (authInfo: AuthInfo) => {
    const fetchedAccounts = await fetchAccounts(authInfo, getAuthConfig().clientId);
    setAccounts(fetchedAccounts);

    if (fetchedAccounts.length > 0) {
      const account = pickAccount(fetchedAccounts);
      setActiveLoginId(account.account_id);
      setAccountType(account.account_type);
      localStorage.setItem(MBL_ACTIVE_LOGINID_KEY, account.account_id);
      setActiveAccountIdState(account.account_id);

      const otpUrl = await fetchOTPUrl(account.account_id, authInfo);
      setWsUrl(otpUrl);
    }

    setAuthState('authenticated');
  }, [fetchOTPUrl]);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const init = async () => {
      const config = getAuthConfig();
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');

      if (MBL_EMBEDDED) {
        setAuthState('authenticating');
        try {
          const mblAuth = await ensureMblAuthSynced(config.clientId);
          if (!mblAuth) {
            redirectToConnect();
            return;
          }
          await completeAuth(mblAuth);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Authentication failed');
          setAuthState('error');
          redirectToConnect();
        }
        return;
      }

      if (code) {
        setAuthState('authenticating');
        try {
          const authInfo = await handleOAuthCallback(window.location.href, config);
          await completeAuth(authInfo);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Authentication failed');
          setAuthState('error');
          clearAllAuthData();
        }
        return;
      }

      const storedAuth = getAuthInfo();
      if (storedAuth) {
        if (storedAuth.expires_at && Date.now() / 1000 > storedAuth.expires_at) {
          try {
            const refreshed = await refreshAccessToken(
              storedAuth.refresh_token,
              config.clientId
            );
            await completeAuth(refreshed);
          } catch {
            clearAllAuthData();
            setAuthState('unauthenticated');
          }
          return;
        }

        const storedAccounts = getDerivAccounts();
        if (storedAccounts && storedAccounts.length > 0) {
          setAccounts(storedAccounts);
          const loginId = getActiveLoginId() ?? storedAccounts[0].account_id;
          setActiveAccountIdState(loginId);

          try {
            const otpUrl = await fetchOTPUrl(loginId, storedAuth);
            setWsUrl(otpUrl);
            setAuthState('authenticated');
          } catch {
            clearAllAuthData();
            setAuthState('unauthenticated');
          }
        } else {
          try {
            await completeAuth(storedAuth);
          } catch {
            clearAllAuthData();
            setAuthState('unauthenticated');
          }
        }
      }
    };

    init();
  }, [completeAuth, fetchOTPUrl]);

  useEffect(() => {
    activeAccountIdRef.current = activeAccountId;
  }, [activeAccountId]);

  useEffect(() => {
    if (authState !== 'authenticated') return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'hidden') {
        tabHiddenAtRef.current = Date.now();
        return;
      }

      const hiddenAt = tabHiddenAtRef.current;
      if (!hiddenAt || Date.now() - hiddenAt < 30_000) return;
      tabHiddenAtRef.current = null;

      const accountId = activeAccountIdRef.current;
      const authInfo = getAuthInfo();
      if (!authInfo || !accountId) return;

      try {
        const synced = MBL_EMBEDDED ? await ensureMblAuthSynced(getAuthConfig().clientId) : authInfo;
        if (!synced) {
          redirectToConnect();
          return;
        }
        const otpUrl = await fetchOTPUrl(accountId, synced);
        setWsUrl(otpUrl);
      } catch {
        if (MBL_EMBEDDED) {
          redirectToConnect();
        } else {
          clearAllAuthData();
          setAuthState('unauthenticated');
          setWsUrl(undefined);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [authState, fetchOTPUrl]);

  const login = useCallback(async () => {
    if (MBL_EMBEDDED) {
      redirectToConnect();
      return;
    }
  }, []);

  const signUp = useCallback(async () => {
    if (MBL_EMBEDDED) {
      redirectToConnect();
      return;
    }
  }, []);

  const logout = useCallback(() => {
    if (MBL_EMBEDDED) {
      window.location.href = MBL_BOTS_URL;
      return;
    }
    clearAllAuthData();
    setAccounts([]);
    setActiveAccountIdState(null);
    setWsUrl(undefined);
    setAuthState('unauthenticated');
    setError(null);
  }, []);

  const switchAccount = useCallback(async (accountId: string) => {
    const authInfo = MBL_EMBEDDED
      ? await ensureMblAuthSynced(getAuthConfig().clientId)
      : getAuthInfo();
    if (!authInfo) {
      redirectToConnect();
      return;
    }

    try {
      const account = accounts.find((a) => a.account_id === accountId);
      if (account) setAccountType(account.account_type);
      const otpUrl = await fetchOTPUrl(accountId, authInfo);
      setActiveLoginId(accountId);
      localStorage.setItem(MBL_ACTIVE_LOGINID_KEY, accountId);
      setActiveAccountIdState(accountId);
      setWsUrl(otpUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account switch failed');
    }
  }, [fetchOTPUrl, accounts]);

  const activeAccount = accounts.find((acc) => acc.account_id === activeAccountId) ?? accounts[0] ?? null;

  return {
    authState,
    accounts,
    activeAccount,
    activeAccountId,
    wsUrl,
    login,
    signUp,
    logout,
    switchAccount,
    error,
    embeddedMode: MBL_EMBEDDED,
  };
}
