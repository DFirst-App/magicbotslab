import type { OpenPosition } from '@/hooks/use-open-positions';
import type { AccumulatorProposalInfo } from '@/hooks/use-accumulator-proposal';

export const BOT_MIN_STAKE = 1;
export const BOT_MIN_LOCK_PROFIT = 0.35;

export function isMarketCalmEnough(prices: number[]): boolean {
  if (prices.length < 12) return false;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i += 1) {
    const prev = prices[i - 1];
    if (prev === 0) continue;
    returns.push((prices[i] - prev) / prev);
  }
  if (returns.length < 8) return false;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance);
  return volatility < 0.0014;
}

export function shouldCloseForProfit(input: {
  position: OpenPosition;
  proposal: AccumulatorProposalInfo | null;
  peakProfit: number;
}): { close: boolean; reason?: string } {
  const profit = parseFloat(input.position.profit);
  const stake = parseFloat(input.position.buy_price);

  if (input.proposal?.hasCrossedBarrier) {
    return { close: true, reason: 'Price near barrier — locking in' };
  }

  if (Number.isFinite(profit) && profit >= Math.max(BOT_MIN_LOCK_PROFIT, stake * 0.08)) {
    return { close: true, reason: 'Profit secured' };
  }

  if (input.peakProfit >= 0.5 && profit < input.peakProfit * 0.55) {
    return { close: true, reason: 'Protecting open profit' };
  }

  return { close: false };
}
