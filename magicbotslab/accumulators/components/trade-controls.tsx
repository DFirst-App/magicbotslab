'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { BuyResult } from '@deriv/core';
import type { AccumulatorProposalInfo } from '../hooks/use-accumulator-proposal';
import type { GrowthRate, OpenPosition } from '../lib/types';

interface TradeControlsProps {
  growthRate: GrowthRate;
  onGrowthRateChange: (rate: GrowthRate) => void;
  growthRateOptions: { value: number; label: string }[];
  isConnected: boolean;
  stake: string;
  onStakeChange: (value: string) => void;
  takeProfit: string;
  onTakeProfitChange: (value: string) => void;
  proposal: AccumulatorProposalInfo | null;
  onBuy: () => void;
  isBuying: boolean;
  buyResult: BuyResult | null;
  buyError: string | null;
  onClearBuyResult: () => void;
  activePosition?: OpenPosition | null;
  onClose?: (contractId: number, bidPrice: string) => void;
  isClosing?: boolean;
  isAuthenticated?: boolean;
  botRunning?: boolean;
  botPhase?: string;
  botStatus?: string;
  sessionProfit?: number;
  onStartBot?: () => void;
  onStopBot?: () => void;
  onStopAndClose?: () => void;
  controlsLocked?: boolean;
}

export function TradeControls({
  growthRate,
  onGrowthRateChange,
  growthRateOptions,
  isConnected,
  stake,
  onStakeChange,
  takeProfit,
  onTakeProfitChange,
  proposal,
  onBuy,
  isBuying,
  buyResult,
  buyError,
  onClearBuyResult,
  activePosition,
  onClose,
  isClosing,
  isAuthenticated,
  botRunning = false,
  botPhase = 'idle',
  botStatus = '',
  sessionProfit = 0,
  onStartBot,
  onStopBot,
  onStopAndClose,
  controlsLocked = false,
}: TradeControlsProps) {
  useEffect(() => {
    if (buyError) {
      toast.error('Trade Failed', { description: buyError });
      onClearBuyResult();
    }
  }, [buyError, onClearBuyResult]);

  useEffect(() => {
    if (buyResult) {
      toast.success('Contract Opened', {
        description: `Stake ${buyResult.buyPrice.toFixed(2)} USD · Balance ${buyResult.balanceAfter.toFixed(2)} USD`,
      });
      onClearBuyResult();
    }
  }, [buyResult, onClearBuyResult]);

  const goal = parseFloat(takeProfit) || 100;
  const locked = controlsLocked || botRunning;

  return (
    <div className="w-full space-y-3 lg:max-w-[400px] lg:space-y-4">
      <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Smart Accumulator Bot
          </Label>
          <span
            className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
              botRunning
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {botRunning ? botPhase : 'idle'}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground min-h-[2.5rem]">
          {botStatus || 'Scans 10 Continuous Indices, picks the calmest market, adjusts growth 1–5%, and locks profit.'}
        </p>
        {botRunning && (
          <p className="text-xs font-medium">
            Session P/L:{' '}
            <span className={sessionProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              {sessionProfit >= 0 ? '+' : ''}{sessionProfit.toFixed(2)} USD
            </span>
            <span className="text-muted-foreground"> / {goal.toFixed(0)} USD goal</span>
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Growth rate</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] text-muted-foreground">
                  i
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px]">
                <p className="text-xs">Bot adjusts between 1% and 5% based on live volatility. Higher rates exit sooner.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Select
          value={String(growthRate)}
          onValueChange={(value) => onGrowthRateChange(parseFloat(value))}
          disabled={locked}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {growthRateOptions.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="stake" className="text-xs text-muted-foreground">Stake (min 1 USD)</Label>
        <Input
          id="stake"
          type="number"
          value={stake}
          onChange={(e) => onStakeChange(e.target.value)}
          onKeyDown={(e) => {
            if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
          }}
          min={1}
          step="0.01"
          labelRight="USD"
          disabled={locked}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="take-profit" className="text-xs text-muted-foreground">Session take profit</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] text-muted-foreground">
                  i
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px]">
                <p className="text-xs">Bot stops when combined session profit from closed trades reaches this goal.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Input
          id="take-profit"
          type="number"
          value={takeProfit}
          onChange={(e) => onTakeProfitChange(e.target.value)}
          onKeyDown={(e) => {
            if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
          }}
          min={1}
          step="0.01"
          labelRight="USD"
          disabled={locked && botPhase !== 'idle'}
        />
      </div>

      {!proposal && !activePosition && !botRunning && (
        <div className="space-y-2.5 rounded-md border border-border bg-muted/30 p-3 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-3 w-20 rounded bg-muted-foreground/20" />
            <div className="h-3 w-16 rounded bg-muted-foreground/20" />
          </div>
        </div>
      )}

      {proposal && !activePosition && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Max. payout</span>
            <span className="font-medium">{proposal.maxPayout.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
          </div>
          {proposal.barrierPercentage && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Barrier</span>
              <span className="font-medium">{proposal.barrierPercentage}</span>
            </div>
          )}
        </div>
      )}

      {activePosition && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Market</span>
            <span className="font-medium">{activePosition.underlying_symbol}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Stake</span>
            <span className="font-medium">{parseFloat(activePosition.buy_price).toFixed(2)} {activePosition.currency}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Current P&L</span>
            <span className={`font-medium ${parseFloat(activePosition.profit) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {parseFloat(activePosition.profit) >= 0 ? '+' : ''}{parseFloat(activePosition.profit).toFixed(2)} {activePosition.currency}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-1.5">
            <span className="text-muted-foreground font-medium">Total return</span>
            <span className="font-semibold">
              {(parseFloat(activePosition.buy_price) + parseFloat(activePosition.profit)).toFixed(2)} {activePosition.currency}
            </span>
          </div>
        </div>
      )}

      <div className="max-lg:fixed max-lg:bottom-[calc(env(safe-area-inset-bottom)+3.2rem)] max-lg:left-3 max-lg:right-3 lg:static space-y-2">
        {!botRunning && !activePosition && (
          <Button
            className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground"
            size="lg"
            disabled={!isConnected || !onStartBot}
            onClick={onStartBot}
          >
            Start Bot
          </Button>
        )}

        {botRunning && (
          <>
            <Button
              className="w-full rounded-full"
              size="lg"
              variant="outline"
              disabled={!onStopBot}
              onClick={onStopBot}
            >
              Stop Bot
            </Button>
            {activePosition && onStopAndClose && (
              <Button
                className="w-full rounded-full border-destructive/40 text-destructive hover:bg-destructive/10"
                size="lg"
                variant="outline"
                disabled={!isConnected || isClosing}
                onClick={() => void onStopAndClose()}
              >
                {isClosing ? 'Closing…' : 'Stop & Close Trade'}
              </Button>
            )}
          </>
        )}

        {!botRunning && activePosition && onClose && (
          <Button
            variant="outline"
            className="w-full rounded-full border-black bg-white text-black hover:bg-white hover:text-black dark:border-white dark:bg-transparent dark:text-white dark:hover:bg-white/10"
            size="lg"
            disabled={!isConnected || isClosing || !activePosition.is_valid_to_sell}
            onClick={() => onClose(activePosition.contract_id, activePosition.bid_price)}
          >
            {isClosing ? 'Closing...' : (
              <span className="flex flex-col items-center leading-tight gap-0.5">
                <span>Close trade</span>
                <span className="text-xs font-normal opacity-90">
                  {(parseFloat(activePosition.buy_price) + parseFloat(activePosition.profit)).toFixed(2)} {activePosition.currency}
                </span>
              </span>
            )}
          </Button>
        )}
      </div>

      {isAuthenticated && (
        <Button
          asChild
          variant="ghost"
          className="w-full text-sm text-muted-foreground hover:text-foreground"
        >
          <Link href="/reports/">View your positions →</Link>
        </Button>
      )}
    </div>
  );
}
