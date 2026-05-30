'use client';

import { useState, useEffect, useRef } from 'react';
import type { DerivWS, ProposalInfo } from '@deriv/core';

export interface AccumulatorProposalParams {
  symbol: string;
  amount: number;
  growthRate: number;
  currency: string;
  /** Optional take-profit limit in account currency. */
  takeProfit?: number;
}

interface AccumulatorProposalResponse {
  proposal?: {
    id: string;
    ask_price: number;
    payout: number;
    longcode: string;
    spot: number;
    spot_time: number;
    date_start: number;
    validation_params?: {
      stake?: { min: string };
      payout?: { max: string };
      max_ticks?: number;
    };
    contract_details?: {
      barrier_spot_distance: string;
      high_barrier: string;
      last_tick_epoch: number;
      low_barrier: string;
      maximum_payout: number;
      maximum_ticks: number;
      tick_size_barrier: number;
      tick_size_barrier_percentage: string;
    };
  };
  subscription?: {
    id: string;
  };
}

export interface AccumulatorProposalInfo extends ProposalInfo {
  /** Maximum payout for the accumulator contract. */
  maxPayout: number;
  /** Maximum ticks the accumulator can run. */
  maxTicks: number;
  /** Barrier distance as percentage string e.g. "±0.04048%". */
  barrierPercentage: string;
  /** High barrier value (absolute). */
  highBarrier: string;
  /** Low barrier value (absolute). */
  lowBarrier: string;
  /** Barrier distance from spot price (absolute number as string). */
  barrierSpotDistance: string;
  /** Whether the current tick has crossed the displayed barriers. */
  hasCrossedBarrier: boolean;
}

interface UseAccumulatorProposalReturn {
  proposal: AccumulatorProposalInfo | null;
  /** Last proposal error (if any). Rich logs are also emitted to console for easy copy-paste diagnosis. */
  proposalError: string | null;
}

/**
 * Custom proposal hook for accumulator contracts.
 *
 * NOTE ON DUPLICATE CODE:
 * This is intentionally a specialized copy of packages/core/src/react/useProposal.ts
 * because the shared hook does not yet support `growth_rate` + `limit_order` + ACCU contract_details.
 * If you refactor, consider making useProposal generic (extraPayload + custom response mapper)
 * so this file can delegate instead of duplicating subscription/error logic.
 *
 * This version now includes robust error handling + diagnostic logging per Deriv docs.
 */
export function useAccumulatorProposal(
  ws: DerivWS | null,
  isConnected: boolean,
  params: AccumulatorProposalParams | null
): UseAccumulatorProposalReturn {
  const [proposal, setProposal] = useState<AccumulatorProposalInfo | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  // Track previous barriers for delayed display — barriers shown on chart are
  // one tick behind.
  const prevBarriersRef = useRef<{ high: string; low: string } | null>(null);

  useEffect(() => {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    if (!ws || !isConnected || !params || params.amount <= 0) {
      setProposal(null);
      return;
    }

    let cancelled = false;

    // Clear previous error when starting a new proposal request
    setProposalError(null);

    const payload: Record<string, unknown> = {
      proposal: 1,
      amount: params.amount,
      basis: 'stake',
      contract_type: 'ACCU',
      currency: params.currency,
      symbol: params.symbol,
      growth_rate: params.growthRate,
    };

    if (params.takeProfit && params.takeProfit > 0) {
      payload.limit_order = { take_profit: params.takeProfit };
    }

    // Rich diagnostic log of what we are requesting (helps when user pastes logs)
    console.log('[ACCU Proposal] Requesting', {
      symbol: params.symbol,
      growthRate: params.growthRate,
      amount: params.amount,
      currency: params.currency,
      hasTakeProfit: !!params.takeProfit,
      payload,
    });

    ws.subscribe(payload, (data) => {
      if (cancelled) return;

      // === CRITICAL: Handle proposal errors from Deriv (this was previously swallowed) ===
      if ((data as any).error) {
        const err = (data as any).error;
        const errorMsg = err.message || 'Unknown proposal error';
        console.error('[ACCU Proposal Error] Full details for diagnosis:', {
          symbol: params.symbol,
          growthRate: params.growthRate,
          amount: params.amount,
          errorCode: err.code,
          errorMessage: errorMsg,
          errorDetails: err,
          fullResponse: data,
          sentPayload: payload,
        });
        setProposalError(errorMsg);
        setProposal(null);
        return;
      }

      const resp = data as unknown as AccumulatorProposalResponse;
      if (resp.proposal) {
        const p = resp.proposal;
        const details = p.contract_details;
        const newHigh = details?.high_barrier ?? '';
        const newLow = details?.low_barrier ?? '';

        // Delayed barrier display: show the PREVIOUS tick's barriers on the chart
        // The first time barriers arrive, show them immediately.
        const displayedHigh = prevBarriersRef.current?.high ?? newHigh;
        const displayedLow = prevBarriersRef.current?.low ?? newLow;

        // Store current barriers as the "previous" for next tick
        prevBarriersRef.current = { high: newHigh, low: newLow };

        // Detect if the current spot has crossed the displayed barriers.
        // The current spot (p.spot) is compared against the DISPLAYED barriers
        // (which are the previous tick's barriers).
        const spot = p.spot;
        const highNum = parseFloat(displayedHigh);
        const lowNum = parseFloat(displayedLow);
        const hasCrossedBarrier =
          !isNaN(spot) && !isNaN(highNum) && !isNaN(lowNum) &&
          (spot >= highNum || spot <= lowNum);

        setProposal({
          id: p.id,
          askPrice: p.ask_price,
          payout: p.payout,
          longcode: p.longcode,
          minStake: parseFloat(p.validation_params?.stake?.min ?? '0'),
          maxPayout: details?.maximum_payout ?? parseFloat(p.validation_params?.payout?.max ?? '0'),
          maxTicks: details?.maximum_ticks ?? (p.validation_params?.max_ticks ?? 0),
          barrierPercentage: details?.tick_size_barrier_percentage
            ? `±${details.tick_size_barrier_percentage}`
            : '',
          highBarrier: displayedHigh,
          lowBarrier: displayedLow,
          barrierSpotDistance: details?.barrier_spot_distance ?? '',
          hasCrossedBarrier,
        });
        setProposalError(null);
      }
    }).then((sub) => {
      if (cancelled) {
        sub.unsubscribe();
      } else {
        unsubRef.current = sub.unsubscribe;
      }
    }).catch((err) => {
      if (!cancelled) {
        const msg = err instanceof Error ? err.message : 'Proposal subscription failed';
        console.error('[ACCU Proposal] Subscription setup failed:', {
          symbol: params.symbol,
          growthRate: params.growthRate,
          error: msg,
        });
        setProposalError(msg);
        setProposal(null);
      }
    });

    return () => {
      cancelled = true;
      setProposal(null);
      setProposalError(null);
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, isConnected, params?.symbol, params?.amount, params?.growthRate, params?.currency, params?.takeProfit]);

  return { proposal, proposalError };
}
