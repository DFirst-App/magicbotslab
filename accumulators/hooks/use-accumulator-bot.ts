'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccumulatorProposalInfo } from './use-accumulator-proposal';
import type { OpenPosition } from './use-open-positions';
import { BOT_MIN_STAKE, isMarketCalmEnough, shouldCloseForProfit } from '@/lib/accumulator-bot-engine';

export type BotPhase = 'idle' | 'waiting' | 'buying' | 'managing' | 'closing';

export interface UseAccumulatorBotParams {
  isConnected: boolean;
  activeSymbol: string | null;
  prices: number[];
  stake: string;
  proposal: AccumulatorProposalInfo | null;
  buyContract: () => Promise<void>;
  isBuying: boolean;
  openPositions: OpenPosition[];
  sellContract: (contractId: number, bidPrice: string) => Promise<void>;
  sellingId: number | null;
}

function findOpenAccu(positions: OpenPosition[]): OpenPosition | null {
  return positions.find((p) => p.contract_type === 'ACCU' && !p.is_sold && !p.is_expired) ?? null;
}

export function useAccumulatorBot({
  isConnected,
  activeSymbol,
  prices,
  stake,
  proposal,
  buyContract,
  isBuying,
  openPositions,
  sellContract,
  sellingId,
}: UseAccumulatorBotParams) {
  const [botRunning, setBotRunning] = useState(false);
  const [botPhase, setBotPhase] = useState<BotPhase>('idle');
  const [botStatus, setBotStatus] = useState('Auto bot uses your growth rate, stake, and take profit settings.');

  const runningRef = useRef(false);
  const busyRef = useRef(false);
  const peakProfitRef = useRef(0);
  const entryCooldownUntilRef = useRef(0);

  const startBot = useCallback(() => {
    runningRef.current = true;
    peakProfitRef.current = 0;
    setBotRunning(true);
    setBotPhase('waiting');
    setBotStatus('Analyzing chart — will open when conditions look stable');
  }, []);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setBotRunning(false);
    setBotPhase('idle');
    setBotStatus('Auto bot stopped');
  }, []);

  const stopAndClose = useCallback(async () => {
    runningRef.current = false;
    setBotRunning(false);
    const pos = findOpenAccu(openPositions);
    if (pos?.is_valid_to_sell) {
      setBotPhase('closing');
      await sellContract(pos.contract_id, pos.bid_price);
    }
    setBotPhase('idle');
    setBotStatus('Stopped and closed active trade');
  }, [openPositions, sellContract]);

  useEffect(() => {
    if (!botRunning || !isConnected) return;

    const position = findOpenAccu(openPositions);
    const stakeNum = parseFloat(stake);

    if (position) {
      const profit = parseFloat(position.profit);
      if (profit > peakProfitRef.current) peakProfitRef.current = profit;

      setBotPhase('managing');
      setBotStatus(
        `Managing ${position.underlying_symbol} · P/L ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} USD`
      );

      const signal = shouldCloseForProfit({
        position,
        proposal: activeSymbol === position.underlying_symbol ? proposal : null,
        peakProfit: peakProfitRef.current,
      });

      if (signal.close && position.is_valid_to_sell && !sellingId && !busyRef.current) {
        busyRef.current = true;
        setBotPhase('closing');
        setBotStatus(signal.reason ?? 'Closing trade');
        void sellContract(position.contract_id, position.bid_price).finally(() => {
          peakProfitRef.current = 0;
          entryCooldownUntilRef.current = Date.now() + 2000;
          busyRef.current = false;
          if (runningRef.current) {
            setBotPhase('waiting');
            setBotStatus('Trade closed — waiting for next entry');
          }
        });
      }
      return;
    }

    if (busyRef.current || isBuying || sellingId) return;

    if (!activeSymbol || !Number.isFinite(stakeNum) || stakeNum < BOT_MIN_STAKE) {
      setBotPhase('waiting');
      setBotStatus('Set stake to at least $1.00 to trade');
      return;
    }

    if (!isMarketCalmEnough(prices)) {
      setBotPhase('waiting');
      setBotStatus('Waiting for calmer price action on this market');
      return;
    }

    if (proposal && parseFloat(String(proposal.askPrice)) > 0) {
      if (Date.now() < entryCooldownUntilRef.current) return;
      busyRef.current = true;
      entryCooldownUntilRef.current = Date.now() + 3500;
      setBotPhase('buying');
      setBotStatus(`Opening on ${activeSymbol}`);
      void buyContract().finally(() => {
        peakProfitRef.current = 0;
        if (runningRef.current) setBotPhase('managing');
        window.setTimeout(() => {
          busyRef.current = false;
        }, 3500);
      });
      return;
    }

    setBotPhase('waiting');
    setBotStatus('Waiting for live quote…');
  }, [
    botRunning,
    isConnected,
    openPositions,
    activeSymbol,
    prices,
    stake,
    proposal,
    buyContract,
    isBuying,
    sellingId,
    sellContract,
  ]);

  return {
    botRunning,
    botPhase,
    botStatus,
    startBot,
    stopBot,
    stopAndClose,
  };
}
