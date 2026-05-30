import type { GrowthRate } from './types';
import type { OpenPosition } from '@/hooks/use-open-positions';
import type { AccumulatorProposalInfo } from '@/hooks/use-accumulator-proposal';

export const BOT_DEFAULTS = {
  growthRate: 0.05 as GrowthRate,
  minStake: 1,
  defaultStake: 100,
  defaultTakeProfit: 100,
  scanTickCount: 36,
  minLockProfit: 0.2,
};

export interface MarketMetrics {
  symbol: string;
  volatility: number;
  momentum: number;
  stability: number;
  calmScore: number;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Basic analysis of recent prices for the selected market. Used for simple entry decisions. */
export function analyzePrices(symbol: string, prices: number[]): MarketMetrics | null {
  if (prices.length < 8) return null;

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i += 1) {
    const prev = prices[i - 1];
    if (prev === 0) continue;
    returns.push((prices[i] - prev) / prev);
  }
  if (returns.length < 5) return null;

  const volatility = stdDev(returns);
  const momentum = returns.reduce((a, b) => a + b, 0) / returns.length;
  const absMomentum = Math.abs(momentum);
  const stability = volatility > 0 ? 1 / (1 + absMomentum / volatility) : 1;
  const calmScore = stability / (1 + volatility * 120);

  return { symbol, volatility, momentum, stability, calmScore };
}

/** Simple check: good entry when market is relatively calm on the user-selected market. */
export function isGoodEntry(metrics: MarketMetrics | null): boolean {
  if (!metrics) return false;
  // Basic calm condition — adjust threshold if needed
  return metrics.calmScore > 0.6 && metrics.volatility < 0.0012;
}

export interface CloseSignalInput {
  position: OpenPosition;
  proposal: AccumulatorProposalInfo | null;
  recentPrices: number[];
}

/**
 * Simplified close logic.
 * - Close on barrier pressure (from proposal)
 * - Basic profit lock
 * - Respect user's take profit (handled via limit_order on proposal)
 * No more complex peak profit protection, volatility spikes, growth-based max ticks, etc.
 */
export function shouldCloseTrade(input: CloseSignalInput): { close: boolean; reason?: string } {
  const profit = parseFloat(input.position.profit);

  if (input.proposal?.hasCrossedBarrier) {
    return { close: true, reason: 'Barrier pressure' };
  }

  if (profit >= BOT_DEFAULTS.minLockProfit) {
    return { close: true, reason: 'Profit target reached' };
  }

  return { close: false };
}

export function formatBotStatus(
  phase: string,
  detail?: string,
  sessionProfit?: number,
  goal?: number
): string {
  const pnl =
    sessionProfit != null && goal != null
      ? ` · Session P/L $${sessionProfit.toFixed(2)} / $${goal.toFixed(0)}`
      : '';
  return detail ? `${phase}: ${detail}${pnl}` : `${phase}${pnl}`;
}
