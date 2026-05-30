import type { GrowthRate } from './types';
import type { OpenPosition } from '@/hooks/use-open-positions';
import type { AccumulatorProposalInfo } from '@/hooks/use-accumulator-proposal';

/** Ten Continuous Indices volatility markets on Deriv. */
export const CONTINUOUS_INDEX_SYMBOLS = [
  'R_10',
  'R_25',
  'R_50',
  'R_75',
  'R_100',
  '1HZ10V',
  '1HZ25V',
  '1HZ50V',
  '1HZ75V',
  '1HZ100V',
] as const;

export const BOT_DEFAULTS = {
  growthRate: 0.05 as GrowthRate,
  minStake: 1,
  defaultStake: 100,
  defaultTakeProfit: 100,
  stakeMultiplierCalm: 3 as const,
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

export interface BotDecision {
  growthRate: GrowthRate;
  stakeMultiplier: 1 | 3;
  metrics: MarketMetrics;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Analyze recent tick prices for volatility and momentum stability. */
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

export function pickBestMarket(candidates: MarketMetrics[]): MarketMetrics | null {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => b.calmScore - a.calmScore)[0];
}

export function growthRateFromMetrics(metrics: MarketMetrics): GrowthRate {
  const v = metrics.volatility;
  if (v < 0.00035) return 0.05;
  if (v < 0.00055) return 0.04;
  if (v < 0.00085) return 0.03;
  if (v < 0.0012) return 0.02;
  return 0.01;
}

export function stakeMultiplierFromMetrics(metrics: MarketMetrics): 1 | 3 {
  if (metrics.volatility < 0.0004 && metrics.stability > 0.72) {
    return BOT_DEFAULTS.stakeMultiplierCalm;
  }
  return 1;
}

export function buildBotDecision(metrics: MarketMetrics): BotDecision {
  return {
    growthRate: growthRateFromMetrics(metrics),
    stakeMultiplier: stakeMultiplierFromMetrics(metrics),
    metrics,
  };
}

/** Higher growth = shorter max hold (more profit potential, more risk). */
export function maxTicksForGrowthRate(rate: GrowthRate): number {
  if (rate >= 0.05) return 10;
  if (rate >= 0.04) return 14;
  if (rate >= 0.03) return 18;
  if (rate >= 0.02) return 24;
  return 30;
}

export interface CloseSignalInput {
  position: OpenPosition;
  proposal: AccumulatorProposalInfo | null;
  recentPrices: number[];
  growthRate: GrowthRate;
  peakProfit: number;
}

export function shouldCloseTrade(input: CloseSignalInput): { close: boolean; reason?: string } {
  const profit = parseFloat(input.position.profit);
  const ticks = input.position.tick_count ?? 0;
  const maxTicks = maxTicksForGrowthRate(input.growthRate);

  if (input.proposal?.hasCrossedBarrier) {
    return { close: true, reason: 'Barrier pressure detected' };
  }

  if (ticks >= maxTicks) {
    return { close: true, reason: `Max duration for ${(input.growthRate * 100).toFixed(0)}% growth` };
  }

  if (profit >= Math.max(BOT_DEFAULTS.minLockProfit, parseFloat(input.position.buy_price) * 0.08)) {
    return { close: true, reason: 'Profit locked' };
  }

  if (input.peakProfit > 0.15 && profit < input.peakProfit * 0.45) {
    return { close: true, reason: 'Protecting open profit' };
  }

  if (profit < -parseFloat(input.position.buy_price) * 0.35) {
    return { close: true, reason: 'Cut loss — conditions shifted' };
  }

  if (input.recentPrices.length >= 10) {
    const tail = input.recentPrices.slice(-10);
    const metrics = analyzePrices(input.position.underlying_symbol, tail);
    if (metrics && metrics.volatility > 0.0015) {
      return { close: true, reason: 'Volatility spike' };
    }
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
