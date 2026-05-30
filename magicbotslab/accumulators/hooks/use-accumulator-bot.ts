'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DerivWS, ActiveSymbol } from '@deriv/core';
import type { AccumulatorProposalInfo } from './use-accumulator-proposal';
import type { OpenPosition } from './use-open-positions';
import type { GrowthRate } from '@/lib/types';
import {
  BOT_DEFAULTS,
  buildBotDecision,
  formatBotStatus,
  shouldCloseTrade,
} from '@/lib/accumulator-bot-engine';
import { useAccumulatorMarketScan } from './use-accumulator-market-scan';

export type BotPhase =
  | 'idle'
  | 'scanning'
  | 'arming'
  | 'buying'
  | 'managing'
  | 'closing'
  | 'goal_reached';

export interface UseAccumulatorBotParams {
  ws: DerivWS | null;
  isConnected: boolean;
  symbols: ActiveSymbol[];
  activeSymbol: ActiveSymbol | null;
  selectSymbol: (symbol: string) => void;
  prices: number[];
  growthRate: GrowthRate;
  setGrowthRate: (rate: GrowthRate) => void;
  stake: string;
  setStake: (value: string) => void;
  takeProfitGoal: number;
  proposal: AccumulatorProposalInfo | null;
  proposalError: string | null;
  buyContract: () => Promise<void>;
  isBuying: boolean;
  openPositions: OpenPosition[];
  sellContract: (contractId: number, bidPrice: string) => Promise<void>;
  sellingId: number | null;
}

export interface UseAccumulatorBotReturn {
  botRunning: boolean;
  botPhase: BotPhase;
  botStatus: string;
  sessionProfit: number;
  startBot: () => void;
  stopBot: () => void;
  stopAndClose: () => Promise<void>;
}

function findAccuPosition(positions: OpenPosition[]): OpenPosition | null {
  return positions.find((p) => p.contract_type === 'ACCU' && !p.is_sold && !p.is_expired) ?? null;
}

export function useAccumulatorBot(params: UseAccumulatorBotParams): UseAccumulatorBotReturn {
  const {
    ws,
    isConnected,
    symbols,
    activeSymbol,
    selectSymbol,
    prices,
    growthRate,
    stake,
    setGrowthRate,
    setStake,
    takeProfitGoal,
    proposal,
    proposalError,
    buyContract,
    isBuying,
    openPositions,
    sellContract,
    sellingId,
  } = params;

  const { scanMarkets } = useAccumulatorMarketScan(ws, isConnected);

  const [botRunning, setBotRunning] = useState(false);
  const [botPhase, setBotPhase] = useState<BotPhase>('idle');
  const [botStatus, setBotStatus] = useState('Bot ready — scans 10 Continuous Indices');
  const [sessionProfit, setSessionProfit] = useState(0);

  const botRunningRef = useRef(false);
  const sessionProfitRef = useRef(0);
  const peakProfitRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const scanRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const symbolAvailable = useCallback(
    (symbol: string) => symbols.some((s) => s.underlying_symbol === symbol),
    [symbols]
  );

  const runScanAndArm = useCallback(async () => {
    if (!botRunningRef.current || busyRef.current) return;
    if (findAccuPosition(openPositions)) return;

    busyRef.current = true;
    setBotPhase('scanning');
    setBotStatus(formatBotStatus('Scanning', '10 Continuous Indices', sessionProfitRef.current, takeProfitGoal));

    try {
      const best = await scanMarkets();
      if (!botRunningRef.current || !mountedRef.current) return;

      if (!best || !symbolAvailable(best.symbol)) {
        setBotStatus(formatBotStatus('Scanning', 'No stable market yet — retrying', sessionProfitRef.current, takeProfitGoal));
        busyRef.current = false;
        return;
      }

      const decision = buildBotDecision(best);
      const userBaseStake = parseFloat(stake) || BOT_DEFAULTS.defaultStake;
      const finalStake = Math.max(BOT_DEFAULTS.minStake, userBaseStake * decision.stakeMultiplier);

      selectSymbol(best.symbol);
      setGrowthRate(decision.growthRate);
      setStake(String(finalStake));

      setBotPhase('arming');
      setBotStatus(
        formatBotStatus(
          'Arming',
          `${best.symbol} · ${(decision.growthRate * 100).toFixed(0)}% · $${finalStake.toFixed(2)} stake`,
          sessionProfitRef.current,
          takeProfitGoal
        )
      );
    } finally {
      busyRef.current = false;
    }
  }, [openPositions, scanMarkets, selectSymbol, setGrowthRate, setStake, stake, symbolAvailable, takeProfitGoal]);

  const startBot = useCallback(() => {
    sessionProfitRef.current = 0;
    peakProfitRef.current = 0;
    setSessionProfit(0);
    botRunningRef.current = true;
    setBotRunning(true);
    setBotPhase('scanning');
    setBotStatus(formatBotStatus('Starting', 'Analyzing markets', 0, takeProfitGoal));
    void runScanAndArm();
  }, [runScanAndArm, takeProfitGoal]);

  const stopBot = useCallback(() => {
    botRunningRef.current = false;
    setBotRunning(false);
    setBotPhase('idle');
    setBotStatus(formatBotStatus('Stopped', undefined, sessionProfitRef.current, takeProfitGoal));
  }, [takeProfitGoal]);

  const stopAndClose = useCallback(async () => {
    botRunningRef.current = false;
    setBotRunning(false);
    const pos = findAccuPosition(openPositions);
    if (pos && pos.is_valid_to_sell) {
      setBotPhase('closing');
      setBotStatus('Closing active trade…');
      const realized = parseFloat(pos.profit);
      await sellContract(pos.contract_id, pos.bid_price);
      if (Number.isFinite(realized)) {
        sessionProfitRef.current += realized;
        setSessionProfit(sessionProfitRef.current);
      }
    }
    setBotPhase('idle');
    setBotStatus(formatBotStatus('Stopped', 'Trade closed', sessionProfitRef.current, takeProfitGoal));
  }, [openPositions, sellContract, takeProfitGoal]);

  // Track session goal only via explicit closes above
  useEffect(() => {
    if (!botRunning || !isConnected) return;

    const position = findAccuPosition(openPositions);

    if (sessionProfitRef.current >= takeProfitGoal) {
      botRunningRef.current = false;
      setBotRunning(false);
      setBotPhase('goal_reached');
      setBotStatus(formatBotStatus('Goal reached', `$${sessionProfitRef.current.toFixed(2)} profit`, sessionProfitRef.current, takeProfitGoal));
      if (position && position.is_valid_to_sell && !sellingId) {
        void sellContract(position.contract_id, position.bid_price);
      }
      return;
    }

    if (position) {
      const profit = parseFloat(position.profit);
      if (profit > peakProfitRef.current) peakProfitRef.current = profit;

      setBotPhase('managing');
      const signal = shouldCloseTrade({
        position,
        proposal: activeSymbol?.underlying_symbol === position.underlying_symbol ? proposal : null,
        recentPrices: prices,
        growthRate,
        peakProfit: peakProfitRef.current,
      });

      setBotStatus(
        formatBotStatus(
          'Managing',
          `${position.underlying_symbol} P/L ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`,
          sessionProfitRef.current,
          takeProfitGoal
        )
      );

      if (signal.close && position.is_valid_to_sell && !sellingId && !busyRef.current) {
        busyRef.current = true;
        setBotPhase('closing');
        setBotStatus(formatBotStatus('Closing', signal.reason, sessionProfitRef.current, takeProfitGoal));
        const realized = parseFloat(position.profit);
        void sellContract(position.contract_id, position.bid_price).finally(() => {
          if (Number.isFinite(realized)) {
            sessionProfitRef.current += realized;
            setSessionProfit(sessionProfitRef.current);
          }
          peakProfitRef.current = 0;
          busyRef.current = false;
          if (botRunningRef.current) {
            setTimeout(() => void runScanAndArm(), 400);
          }
        });
      }
      return;
    }

    if (
      botPhase === 'arming' &&
      proposal &&
      !proposalError &&
      activeSymbol &&
      parseFloat(String(proposal.askPrice)) > 0 &&
      !busyRef.current &&
      !isBuying
    ) {
      // Diagnostic log for bot buy attempts (very useful when pasting logs)
      console.log('[ACCU Bot] Triggering buy from arming phase', {
        symbol: activeSymbol.underlying_symbol,
        growthRate,
        stakeUsed: stake,
        proposalId: proposal.id,
        askPrice: proposal.askPrice,
        proposalError,
      });

      busyRef.current = true;
      setBotPhase('buying');
      setBotStatus(formatBotStatus('Opening', activeSymbol.underlying_symbol, sessionProfitRef.current, takeProfitGoal));
      void buyContract().finally(() => {
        busyRef.current = false;
        peakProfitRef.current = 0;
        setBotPhase('managing');
      });
      return;
    }

    // Extra visibility when proposal error blocks the bot
    if (botPhase === 'arming' && proposalError && !busyRef.current) {
      console.warn('[ACCU Bot] Waiting — proposal has error:', proposalError);
    }

    if (
      (botPhase === 'scanning' || (botPhase === 'arming' && !proposal)) &&
      !busyRef.current &&
      !isBuying &&
      !sellingId &&
      !scanRetryRef.current
    ) {
      scanRetryRef.current = setTimeout(() => {
        scanRetryRef.current = null;
        if (botRunningRef.current && !findAccuPosition(openPositions)) {
          void runScanAndArm();
        }
      }, botPhase === 'scanning' ? 900 : 1800);
    }
  }, [
    botRunning,
    isConnected,
    openPositions,
    takeProfitGoal,
    sellingId,
    proposal,
    activeSymbol,
    prices,
    growthRate,
    buyContract,
    isBuying,
    sellContract,
    botPhase,
    runScanAndArm,
  ]);

  return {
    botRunning,
    botPhase,
    botStatus,
    sessionProfit,
    startBot,
    stopBot,
    stopAndClose,
  };
}
