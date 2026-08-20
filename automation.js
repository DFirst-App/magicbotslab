/**
 * AUTONOMOUS TRADING — Smart Recovery Differ.
 *
 * Runs the recommended bot without anyone pressing Start. It arms itself once the
 * account holds the minimum balance, sizes each run from the balance at that
 * moment, trades to a fixed target, then rests before going again.
 *
 * It does not contain a trading engine and does not talk to Deriv. It fills the
 * same Configuration inputs a person would fill, then calls the dashboard's own
 * startBot(), so every existing path — account selection, OTP socket, stats,
 * trade log, take-profit and stop-loss popups — runs exactly as it always has.
 * Everything specific to this dashboard is supplied through init(), so this file
 * knows nothing about the page beyond that contract.
 *
 * Sizing reuses MBLGuide.suggestStake, so the automation and the stake coach can
 * never disagree: the stake is the largest whose martingale ladder still fits
 * inside the configured share of the balance.
 *
 * Browser-resident: it trades while the dashboard is open in a tab, including a
 * background tab, and stops when the tab is closed. All scheduling is absolute
 * timestamps in localStorage, so a reload, a sleeping laptop or a throttled tab
 * only delays a check, never loses one.
 */
(() => {
  const STORE_KEY = "mbl_auto_v1";
  const BOT_KEY = "smartRecoveryDiffer";

  const TICK_MS = 20 * 1000;          // heartbeat
  const RETRY_MS = 60 * 1000;         // a run that failed to get going
  const COOLDOWN_MS = 90 * 60 * 1000; // quiet period after a completed run
  const OPT_OUT_MS = 60 * 60 * 1000;  // how long the switch stays off
  const MIN_BALANCE = 100;            // balance at which the automation arms
  const PROFIT_TARGET_PCT = 0.1;      // target for one run
  const SHORT_RUN_MS = 30 * 1000;     // shorter than this and the run never started properly

  const BLANK = {
    enabled: false,
    greeted: false,
    phase: "off",          // off | idle | running | cooldown
    nextRunAt: null,
    lastTradeAt: null,
    optedOutUntil: null,
  };

  let p = Object.assign({}, BLANK);
  let host = null;
  let timer = null;
  let booted = false;
  let ticking = false;
  /** True while the person is running a bot themselves — the automation waits. */
  let manual = false;
  /** Set just before we call start(), so the run that follows is known to be ours. */
  let claiming = false;
  let runCfg = null;
  let runStartedAt = 0;
  let justActivated = false;
  const listeners = [];

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) p = Object.assign({}, BLANK, JSON.parse(raw));
    } catch (_) { p = Object.assign({}, BLANK); }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (_) { /* storage off */ }
  }

  const round2 = (v) => Math.round(v * 100) / 100;

  /** Reuse the stake coach so the automation and the on-screen suggestion agree. */
  function suggestStake(balance) {
    const g = window.MBLGuide;
    if (g && typeof g.suggestStake === "function") return g.suggestStake(balance);
    return 0.35; // Deriv floor, if the guide has not loaded
  }

  function profitTarget(balance) {
    const b = Number(balance);
    if (!Number.isFinite(b) || b <= 0) return 0;
    return round2(b * PROFIT_TARGET_PCT);
  }

  function isEligible(balance) {
    return Number.isFinite(Number(balance)) && Number(balance) >= MIN_BALANCE;
  }

  /** Off only while the switch is held down; it comes back on its own. */
  function isActive() {
    return p.optedOutUntil == null || Date.now() >= p.optedOutUntil;
  }

  function isDue(now) {
    if (p.phase === "running") return false;
    if (p.nextRunAt == null) return true;
    return now >= p.nextRunAt;
  }

  function snapshot() {
    const bal = host && typeof host.getBalance === "function" ? host.getBalance() : null;
    const b = Number.isFinite(Number(bal)) ? Number(bal) : 0;
    return {
      enabled: p.enabled,
      phase: p.phase,
      active: isActive(),
      optedOutUntil: p.optedOutUntil,
      balance: Number.isFinite(Number(bal)) ? Number(bal) : null,
      currency: host && typeof host.getCurrency === "function" ? host.getCurrency() : "USD",
      // Mid-run these are the figures the run began with and never move; between
      // runs they are what the next run would use at the balance as it stands.
      stake: runCfg ? runCfg.initialStake : suggestStake(b),
      target: runCfg ? runCfg.takeProfit : profitTarget(b),
      nextRunAt: p.nextRunAt,
      lastTradeAt: p.lastTradeAt,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      justActivated: justActivated,
      minBalance: MIN_BALANCE,
    };
  }

  function emit() {
    const s = snapshot();
    for (let i = 0; i < listeners.length; i++) {
      try { listeners[i](s); } catch (_) { /* a bad listener must not stop a run */ }
    }
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    try { fn(snapshot()); } catch (_) {}
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function acknowledgeActivation() {
    justActivated = false;
    p.greeted = true;
    save();
    emit();
  }

  /**
   * Switch the automation on or off. Off is deliberately temporary — an hour, long
   * enough to trade by hand without it stepping in, then it returns. On is the
   * default, so a cleared browser is always automated.
   */
  function setActive(on) {
    if (on) {
      if (p.optedOutUntil == null) return;
      p.optedOutUntil = null;
      save(); emit(); tick();
      return;
    }
    if (p.optedOutUntil != null) return;
    p.optedOutUntil = Date.now() + OPT_OUT_MS;
    if (p.phase === "running" && host && typeof host.stop === "function") {
      try { host.stop(); } catch (_) {}
    }
    runCfg = null;
    p.phase = "idle";
    save(); emit();
  }

  /**
   * The dashboard tells us whenever a bot starts or stops — ours or the person's.
   * A run we did not claim is theirs, and we stay out of the way until it ends.
   */
  function notifyRunning(running) {
    if (running) {
      if (claiming) { claiming = false; runStartedAt = Date.now(); }
      else { manual = true; runCfg = null; }
      emit();
      return;
    }

    const wasOurs = p.phase === "running" && !manual;
    runCfg = null;
    claiming = false;

    if (manual) {           // their run finished — we may schedule again
      manual = false;
      if (p.phase === "running") p.phase = "idle";
      save(); emit(); tick();
      return;
    }

    if (!wasOurs) { emit(); return; }

    // A run that ended almost immediately never really started (no account, socket
    // trouble): try again shortly. A real run rests the full quiet period, timed
    // from when it stopped trading.
    const quick = Date.now() - runStartedAt < SHORT_RUN_MS;
    p.lastTradeAt = Date.now();
    p.phase = "cooldown";
    p.nextRunAt = Date.now() + (quick ? RETRY_MS : COOLDOWN_MS);
    save(); emit();
  }

  function startRun(balance) {
    const cfg = {
      initialStake: suggestStake(balance),
      takeProfit: profitTarget(balance),
      stopLoss: host.getDefaults().stopLoss,                 // unchanged, by design
      martingaleMultiplier: host.getDefaultMartingale(),     // unchanged, by design
    };
    runCfg = cfg;
    try {
      host.openBot(BOT_KEY);      // openBot rewrites the inputs, so it goes first
      host.setInputs(cfg);        // then the figures this run will actually use
      p.phase = "running";
      runStartedAt = Date.now();
      claiming = true;
      save(); emit();
      host.start();
    } catch (e) {
      claiming = false;
      runCfg = null;
      p.phase = "cooldown";
      p.nextRunAt = Date.now() + RETRY_MS;
      save(); emit();
    }
  }

  function tick() {
    if (ticking || !host) return;
    ticking = true;
    try {
      if (!host.hasToken()) {                 // disconnected: park, keep settings
        if (p.phase !== "off") { p.phase = "off"; save(); }
        emit();
        return;
      }

      // Switched off by hand: stay quiet until the hour is up, then come back.
      if (p.optedOutUntil != null) {
        if (Date.now() < p.optedOutUntil) { emit(); return; }
        p.optedOutUntil = null; save();
      }

      if (manual || host.isRunning()) { emit(); return; }
      if (typeof navigator !== "undefined" && !navigator.onLine) return;

      const bal = host.getBalance();

      if (!p.enabled) {
        // Arms on connect, and equally the moment a balance first reaches the
        // minimum — nobody has to reconnect to get here.
        if (isEligible(bal)) {
          p.enabled = true;
          p.phase = "idle";
          p.nextRunAt = null;
          if (!p.greeted) justActivated = true;
          save(); emit();
        } else { emit(); return; }
      }

      if (!isDue(Date.now())) { emit(); return; }

      if (!isEligible(bal)) {
        p.phase = "idle";
        p.nextRunAt = Date.now() + RETRY_MS;   // recheck later, stay armed
        save(); emit();
        return;
      }

      // If they are looking at a different bot, that is the one they care about
      // right now — wait rather than pulling the page out from under them.
      const open = host.getActiveBotKey();
      if (open && open !== BOT_KEY) { emit(); return; }

      startRun(bal);
    } catch (e) {
      p.nextRunAt = Date.now() + RETRY_MS;     // never wedge: always retry
      save(); emit();
    } finally {
      ticking = false;
    }
  }

  const onOnline = () => { emit(); tick(); };
  const onVisible = () => { if (document.visibilityState === "visible") tick(); };

  /** Called once by the dashboard with everything this module needs from the page. */
  function init(adapter) {
    if (booted) return;
    host = adapter;
    booted = true;
    load();
    // A run recorded as running cannot have survived a reload — the socket died
    // with the old page. Drop to idle so the next tick starts a fresh one.
    if (p.phase === "running") { p.phase = "idle"; save(); }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", emit);
    document.addEventListener("visibilitychange", onVisible);
    timer = setInterval(tick, TICK_MS);
    tick();
  }

  window.MBLAutomation = {
    init,
    tick,
    subscribe,
    snapshot,
    setActive,
    notifyRunning,
    acknowledgeActivation,
    BOT_KEY,
    MIN_BALANCE,
    PROFIT_TARGET_PCT,
  };
})();
