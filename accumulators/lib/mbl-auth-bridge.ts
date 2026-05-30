import type { AuthInfo } from '@deriv/core';
import { storeAuthInfo, getAuthInfo, refreshAccessToken } from '@deriv/core';

const MBL_ACCESS_TOKEN_KEY = 'deriv_access_token';
const MBL_OAUTH_SESSION_KEY = 'deriv_oauth_session';
const MBL_ACTIVE_LOGINID_KEY = 'mbl_active_loginid';
const TOKEN_URL = 'https://auth.deriv.com/oauth2/token';

export { MBL_ACTIVE_LOGINID_KEY };

function readMblSession(): {
  access_token?: string;
  refresh_token?: string | null;
  expires_at?: number;
} | null {
  try {
    const raw = localStorage.getItem(MBL_OAUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeMblSession(session: {
  access_token: string;
  refresh_token?: string | null;
  expires_at: number;
}) {
  localStorage.setItem(MBL_OAUTH_SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(MBL_ACCESS_TOKEN_KEY, session.access_token);
}

function toAuthInfo(session: {
  access_token: string;
  refresh_token?: string | null;
  expires_at: number;
}): AuthInfo {
  const expiresAtMs = Number(session.expires_at);
  const expiresAtSec = Math.floor(expiresAtMs / 1000);
  const expiresIn = Math.max(60, expiresAtSec - Math.floor(Date.now() / 1000));
  return {
    access_token: session.access_token,
    token_type: 'Bearer',
    expires_in: expiresIn,
    expires_at: expiresAtSec,
    scope: 'trade account_manage',
    refresh_token: session.refresh_token || '',
  };
}

async function refreshMblSession(
  refreshToken: string,
  clientId: string
): Promise<AuthInfo | null> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) return null;

  const tokenData = await response.json();
  if (!tokenData.access_token) return null;

  const updated = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || refreshToken,
    expires_at: Date.now() + ((tokenData.expires_in || 3600) * 1000),
  };
  writeMblSession(updated);
  const authInfo = toAuthInfo(updated);
  storeAuthInfo(authInfo);
  return authInfo;
}

/**
 * Reuse Magic Bots Lab OAuth session from index.html / dashboard / trading-dashboard.
 */
export async function ensureMblAuthSynced(clientId: string): Promise<AuthInfo | null> {
  const existing = getAuthInfo();
  const session = readMblSession();
  const accessToken = localStorage.getItem(MBL_ACCESS_TOKEN_KEY) || session?.access_token;

  if (!accessToken && !session?.access_token) {
    return null;
  }

  const expiresAtMs = Number(session?.expires_at || 0);
  const isExpired = expiresAtMs > 0 && Date.now() >= expiresAtMs - 60_000;

  if (isExpired && session?.refresh_token) {
    const refreshed = await refreshMblSession(session.refresh_token, clientId);
    if (refreshed) return refreshed;
  }

  if (!session?.access_token && accessToken) {
    const fallback = {
      access_token: accessToken,
      refresh_token: session?.refresh_token || null,
      expires_at: expiresAtMs || Date.now() + 3600_000,
    };
    writeMblSession(fallback);
    const authInfo = toAuthInfo(fallback);
    storeAuthInfo(authInfo);
    return authInfo;
  }

  if (session?.access_token && !isExpired) {
    const authInfo = toAuthInfo({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: expiresAtMs,
    });
    storeAuthInfo(authInfo);
    return authInfo;
  }

  if (existing && !isExpired) {
    return existing;
  }

  if (session?.refresh_token) {
    return refreshMblSession(session.refresh_token, clientId);
  }

  return null;
}

export function getMblPreferredLoginId(): string | null {
  return localStorage.getItem(MBL_ACTIVE_LOGINID_KEY);
}
