'use client';

import { useSmartChartsApi } from '@/hooks/use-smartcharts-api';
import { useSmartChartChartData } from '@/hooks/use-smartchart-chart-data';
import { useAccumulatorTrading } from '../hooks/use-accumulator-trading';
import { useAccumulatorBot } from '../hooks/use-accumulator-bot';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { AccumulatorView } from '../components/accumulator-view';

export default function AccumulatorPage() {
  const logoSrc = useLogoSrc();
  const { ws, isConnected, isExhausted, auth } = useDerivWSContext();
  const { authState, accounts, activeAccount, login, signUp, logout, switchAccount, embeddedMode } = auth;

  const trading = useAccumulatorTrading({ ws, isConnected, isExhausted, isAuthenticated: !!auth.wsUrl, onAuthWSFailed: logout });

  const bot = useAccumulatorBot({
    isConnected: trading.isConnected,
    activeSymbol: trading.activeSymbol?.underlying_symbol ?? null,
    prices: trading.prices,
    stake: trading.stake,
    proposal: trading.proposal,
    buyContract: trading.buyContract,
    isBuying: trading.isBuying,
    openPositions: trading.openPositions,
    sellContract: trading.sellContract,
    sellingId: trading.sellingId,
  });

  const { chartData } = useSmartChartChartData(trading.ws, trading.isConnected, trading.symbols);
  const { getQuotes, subscribeQuotes, unsubscribeQuotes } = useSmartChartsApi(trading.ws);

  return (
    <AccumulatorView
      authState={authState}
      accounts={accounts}
      activeAccount={activeAccount}
      onLogin={login}
      onSignUp={signUp}
      onLogout={logout}
      onSwitchAccount={switchAccount}
      embeddedMode={embeddedMode}
      logoSrc={logoSrc}
      isConnected={trading.isConnected}
      isLoading={trading.isLoading}
      error={trading.error}
      activeSymbol={trading.activeSymbol}
      selectSymbol={trading.selectSymbol}
      growthRate={trading.growthRate}
      setGrowthRate={trading.setGrowthRate}
      growthRateOptions={trading.growthRateOptions}
      stake={trading.stake}
      setStake={trading.setStake}
      takeProfit={trading.takeProfit}
      setTakeProfit={trading.setTakeProfit}
      proposal={trading.proposal}
      buyContract={trading.buyContract}
      isBuying={trading.isBuying}
      buyResult={trading.buyResult}
      buyError={trading.buyError}
      clearBuyResult={trading.clearBuyResult}
      openPositions={trading.openPositions}
      sellContract={trading.sellContract}
      sellingId={trading.sellingId}
      chartData={chartData}
      getQuotes={getQuotes}
      subscribeQuotes={subscribeQuotes}
      unsubscribeQuotes={unsubscribeQuotes}
      botRunning={bot.botRunning}
      botPhase={bot.botPhase}
      botStatus={bot.botStatus}
      onStartBot={bot.startBot}
      onStopBot={bot.stopBot}
      onStopAndClose={bot.stopAndClose}
    />
  );
}
