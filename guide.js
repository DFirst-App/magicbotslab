(() => {
  const DERIV_PARTNER_URL = "https://track.deriv.com/_30qaRjl291dMjdsyM5hasGNd7ZgqdRLk/1/";
  const STORAGE_PREFIX = "mbl_guide_";

  const KEYS = {
    indexConnect: "index_connect_v1",
    dashboardBots: "dashboard_bots_v1",
    tradingWelcome: "trading_welcome_v1",
    balanceTipSession: "balance_tip_session_v1"
  };

  const STAKE_COACH = {
    minStake: 0.35,
    recommendedBalance: 1000,
    smartRecoveryMartingale: 3.1,
    lossBuffer: 6,
    balanceUtilization: 0.5,
    recommendedBotKey: "smartRecoveryDiffer"
  };

  function mark(key) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, "1");
    } catch (_) {}
  }

  function isDone(key) {
    try {
      return localStorage.getItem(STORAGE_PREFIX + key) === "1";
    } catch (_) {
      return false;
    }
  }

  function lossSumMultiplier(losses, multiplier) {
    const m = Number(multiplier) || STAKE_COACH.smartRecoveryMartingale;
    const n = Math.max(1, Math.floor(Number(losses) || STAKE_COACH.lossBuffer));
    return (Math.pow(m, n) - 1) / (m - 1);
  }

  function suggestStake(balance, options = {}) {
    const bal = Number(balance);
    if (!Number.isFinite(bal) || bal <= 0) return STAKE_COACH.minStake;
    const mult = options.multiplier ?? STAKE_COACH.smartRecoveryMartingale;
    const losses = options.losses ?? STAKE_COACH.lossBuffer;
    const util = options.utilization ?? STAKE_COACH.balanceUtilization;
    const minStake = options.minStake ?? STAKE_COACH.minStake;
    const raw = (bal * util) / lossSumMultiplier(losses, mult);
    const rounded = Math.floor(raw * 100) / 100;
    return Math.max(minStake, rounded);
  }

  function suggestMinBalance(stake, options = {}) {
    const s = Number(stake);
    if (!Number.isFinite(s) || s <= 0) return STAKE_COACH.recommendedBalance;
    const mult = options.multiplier ?? STAKE_COACH.smartRecoveryMartingale;
    const losses = options.losses ?? STAKE_COACH.lossBuffer;
    const util = options.utilization ?? STAKE_COACH.balanceUtilization;
    return Math.ceil((s * lossSumMultiplier(losses, mult)) / util);
  }

  function evaluateStake(balance, stake, options = {}) {
    const bal = Number(balance);
    const st = Number(stake);
    const suggested = suggestStake(balance, options);
    const minBal = suggestMinBalance(Math.max(st, STAKE_COACH.minStake), options);
    const recommendedBal = STAKE_COACH.recommendedBalance;

    if (!Number.isFinite(bal) || bal <= 0) {
      return {
        level: "warn",
        suggestedStake: suggested,
        minBalanceForStake: minBal,
        message: `Suggested starting stake: $${suggested.toFixed(2)} (based on a ${STAKE_COACH.lossBuffer}-loss recovery buffer at ${STAKE_COACH.smartRecoveryMartingale}×).`
      };
    }

    if (st > suggested * 1.15 || bal < minBal) {
      return {
        level: bal < minBal * 0.85 ? "tight" : "warn",
        suggestedStake: suggested,
        minBalanceForStake: minBal,
        message: bal < recommendedBal
          ? `Your stake is a bit high for this balance. Try $${suggested.toFixed(2)} so the bot has room if several trades lose in a row. Growing toward $${recommendedBal.toLocaleString()} USD helps long-term.`
          : `Consider lowering stake to about $${suggested.toFixed(2)} so recovery has room after a losing streak.`
      };
    }

    if (bal >= recommendedBal) {
      return {
        level: "good",
        suggestedStake: suggested,
        minBalanceForStake: minBal,
        message: `Good fit — your balance gives the bot room for recovery at about $${st.toFixed(2)} per trade. Rome wasn't built in a day; steady sessions win.`
      };
    }

    return {
      level: "good",
      suggestedStake: suggested,
      minBalanceForStake: minBal,
      message: `Sizing looks reasonable. For the smoothest experience we still recommend working toward $${recommendedBal.toLocaleString()} USD over time.`
    };
  }

  window.MBLGuide = {
    KEYS,
    STAKE_COACH,
    DERIV_PARTNER_URL,
    mark,
    isDone,
    lossSumMultiplier,
    suggestStake,
    suggestMinBalance,
    evaluateStake
  };
})();
