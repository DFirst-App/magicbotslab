/**
 * MAGIC BOTS LAB — Smart Recovery Differ, for creators.
 *
 * This is the simulator's bot, in the trading dashboard's panel, with one
 * thing added: it walks a first-timer through setting it up.
 *
 * The reason it is built that way rather than as its own screen: a creator is
 * about to record this and post it. If the bot in their video looks like
 * something only creators can see, the people watching cannot find it. So the
 * markup is the dashboard's own — same classes, same three columns, same live
 * performance rows — and the balance control is the simulator's own, the one
 * with the Apply button. Nothing here is a lookalike.
 *
 * What the guiding adds, and all it adds:
 *
 *   · Step 1 — the stake field is ringed and a figure is suggested, scaled to
 *     the balance. Nothing is filled in for them.
 *   · Step 2 — once a stake exists, the take profit is ringed the same way.
 *   · Step 3 — once both exist, Start Bot is ringed.
 *
 * Stop loss and martingale show the bot's real defaults and are left alone,
 * because that is what the dashboard shows. On simulation the stop loss cannot
 * fire — 0 is what reaches the engine and the engine only checks a stop loss
 * above zero — so a run ends on the take profit, which is the ending worth
 * recording.
 */

(function () {
  "use strict";

  /** The same key the simulator writes, so a balance carries across both. */
  var BAL_KEY = "simBalance";

  /**
   * A balance that has run away stops being useful.
   *
   * The stake and take-profit suggestions are percentages of the balance, so a
   * few good sessions compound into figures nobody would film — and a creator
   * who has set their own number should not have it taken away mid-run either.
   * So the check happens on arrival, before anything is running: above the
   * ceiling, it is quietly brought back to somewhere sensible. They can type
   * whatever they like afterwards, including a bigger number, and it stands
   * for as long as they are on the page.
   */
  var BALANCE_CEILING = 156436;
  var BALANCE_RESET_MAX = 64675.32;

  /** Smart Recovery Differ's own defaults, from trading-dashboard.html. */
  var DEFAULTS = { initialStake: 1, minStake: 0.35, takeProfit: 100, stopLoss: 1000, martingaleMultiplier: 3.1 };

  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  var money = function (n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  function icon(path, size) {
    var n = size || 14;
    return '<svg viewBox="0 0 24 24" width="' + n + '" height="' + n +
      '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none">' + path + "</svg>";
  }

  function toast(text, bad) {
    var host = document.getElementById("toasts");
    if (!host) return;
    var el = document.createElement("div");
    el.className = "toast" + (bad ? " bad" : "");
    el.innerHTML = (bad ? "⚠ " : "✓ ") + esc(text);
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  function readBalance() {
    var v = parseFloat(localStorage.getItem(BAL_KEY));
    return isFinite(v) && v > 0 ? v : DEFAULTS.takeProfit * 10;   // 1,000 to open on
  }
  function writeBalance(v) { try { localStorage.setItem(BAL_KEY, String(v)); } catch (e) {} }

  /**
   * Suggestions scaled to what they are trading with — $70 and $300 on $1,000.
   * Big enough that the run is worth watching, small enough that it gets there.
   */
  function suggestedStake(b) { return Math.max(DEFAULTS.minStake, Math.round(b * 0.07 * 100) / 100); }
  function suggestedTP(b) { return Math.max(5, Math.round(b * 0.3 * 100) / 100); }

  /* ── state ─────────────────────────────────────────────────────────────── */

  var S = {
    balance: readBalance(),
    pending: "",           // what is typed in the balance box before Apply
    // Both fields open on the bot's own defaults, so a creator who wants
    // nothing explained can press Start and film it. The guiding is still
    // there for anyone who changes one — clearing a field walks it back.
    step: 0,               // 0 stake · 1 take profit · 2 start · 3 running or done
    stake: String(DEFAULTS.initialStake),
    tp: String(DEFAULTS.takeProfit),
    // The bot's own defaults, and the creator's to change — the dashboard lets
    // them, so this does too.
    sl: String(DEFAULTS.stopLoss),
    mg: String(DEFAULTS.martingaleMultiplier),
    running: false,
    stats: null,
    guideMsg: null,
    // The trades live here, not only in the DOM: a re-render used to wipe the
    // list at exactly the moment the run ended, which is the moment it matters.
    trades: [],
    connection: "Idle",
    target: "--",
    lastContract: "--"
  };

  var bot = null;

  function setText(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  /* ── the bot's view of us ──────────────────────────────────────────────── */

  var botUI = {
    updateBalance: function (balance) {
      S.balance = balance;
      writeBalance(Math.round(balance * 100) / 100);
      // "1,234.56 USD" — the dashboard's own shape, not "$1,234.56".
      setText("balanceValue", Number(balance).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " USD");
      var input = document.getElementById("derivBalanceInput");
      // Do not fight somebody who is mid-edit.
      if (input && document.activeElement !== input) input.value = (Math.round(balance * 100) / 100).toFixed(2);
    },
    updateStats: function (snap) {
      S.stats = snap;

      // Every line below mirrors updateBotStats() in trading-dashboard.html —
      // the same strings, and the same rule about when profit turns green or
      // red, so the card reads identically to the one creators will use.
      var pl = Number(snap.totalProfit || 0);
      var el = document.getElementById("totalProfitValue");
      if (el) {
        el.textContent = (pl >= 0 ? "+" : "") + "$" + pl.toFixed(2);
        el.classList.toggle("positive", pl > 0);
        el.classList.toggle("negative", pl < 0);
      }

      setText("totalTradesValue", String(snap.totalTrades == null ? 0 : snap.totalTrades));
      setText("winRateValue", (snap.winRate == null ? 0 : snap.winRate) + "%");
      setText("currentStakeValue", "$" + Number(snap.currentStake || 0).toFixed(2));
      setText("consecutiveLossesValue", String(snap.consecutiveLosses == null ? 0 : snap.consecutiveLosses));
      setText("targetValue",
        snap.market !== undefined && snap.digit !== undefined
          ? snap.market + " / " + snap.digit
          : (snap.market !== undefined ? String(snap.market) : "-"));
    },
    updateTargets: function (market, digit) {
      S.target = market + " · digit " + digit;
      setText("botTarget", S.target);
    },
    setRunningState: function (on) {
      S.running = on;
      if (!on && S.step === 2) S.step = 3;
      S.connection = on ? "Running" : "Idle";
      render();
    },
    showStatus: function (msg, type) {
      S.lastContract = msg;
      setText("botLastContract", msg);
      setText("botConnection", S.connection);
      if (type === "success" && /take profit/i.test(msg)) {
        toast("Take profit reached — that is your ending. Stop recording.");
      }
    },
    addHistoryEntry: function (e) {
      S.trades.unshift(e);
      if (S.trades.length > 60) S.trades.pop();

      // The engine has settled this trade and not yet queued the next one.
      afterTrade();

      var list = document.getElementById("historyList");
      if (!list) return;
      var row = document.createElement("div");
      row.className = "history-item history-item--enter " + (e.win ? "win" : "loss");
      row.innerHTML = tradeRow(e);
      list.insertBefore(row, list.firstChild);
      while (list.children.length > 60) list.removeChild(list.lastChild);
    },
    resetHistory: function () {
      S.trades = [];
      var list = document.getElementById("historyList");
      if (list) list.innerHTML = "";
    },
    updateRunningTime: function (t) { setText("runningTimeValue", t); }
  };

  /* ── the page ──────────────────────────────────────────────────────────── */

  function view() {
    var sug = suggestedStake(S.balance);
    var sugTP = suggestedTP(S.balance);
    var edited = S.pending !== "" && parseFloat(S.pending) !== Math.round(S.balance * 100) / 100;

    return '<div class="bot-panel-content">' +

      /* The heading and the balance, exactly as the simulator carries them. */
      '<div class="section-heading">' +
        '<div class="section-heading-text">' +
          "<h2>Smart Recovery Differ</h2>" +
        "</div>" +
        '<div class="deriv-balance-wrap">' +
          '<div class="deriv-balance-display">' +
            '<span class="deriv-balance-label">Balance</span>' +
            '<input type="number" class="deriv-balance-input" id="derivBalanceInput" min="0" step="0.01" ' +
              'inputmode="decimal" aria-label="Balance in USD" value="' + (Math.round(S.balance * 100) / 100).toFixed(2) + '"' +
              (S.running ? " disabled" : "") + " />" +
            '<span class="deriv-balance-currency">USD</span>' +
            '<button type="button" class="deriv-balance-apply' + (edited ? "" : " is-hidden") + '" data-act="apply"' +
              (edited ? "" : " hidden") + ">Apply</button>" +
          "</div>" +
        "</div>" +
      "</div>" +

      /* The bot panel, exactly as the dashboard draws it. */
      '<div class="bot-panel-grid">' +
        '<div class="bot-column">' +
          '<div class="bot-config">' +
            "<h4>Configuration</h4>" +

            '<div class="config-grid">' +
              '<div class="input-group' + (S.step === 0 ? " glow" : S.step > 0 ? " done" : "") + '">' +
                '<label for="stakeInput">Initial Stake (USD)</label>' +
                '<input type="number" id="stakeInput" min="' + DEFAULTS.minStake + '" step="0.01" value="' + esc(S.stake) +
                  '" placeholder="' + money(DEFAULTS.initialStake) + '"' + (S.running ? " disabled" : "") + " />" +
                (S.step === 0
                  ? '<div class="cfg-hint"><span class="cfg-step">1<i>/3</i></span>' +
                    '<span class="cfg-say">What each trade risks. We suggest <b>' + money(sug) + ' USD</b>.</span>' +
                    '<button type="button" class="cfg-use" data-act="useStake">Use ' + money(sug) + "</button></div>"
                  : '<small>Ready to go. For a bigger run on this balance, ' +
                    '<button type="button" class="linky" data-act="useStake">use ' + money(sug) + "</button>.</small>") +
              "</div>" +

              '<div class="input-group' + (S.step === 1 ? " glow" : S.step > 1 ? " done" : "") + '">' +
                '<label for="takeProfitInput">Take Profit (USD)</label>' +
                '<input type="number" id="takeProfitInput" min="5" step="1" value="' + esc(S.tp) +
                  '" placeholder="' + money(DEFAULTS.takeProfit) + '"' + (S.running ? " disabled" : "") + " />" +
                (S.step === 1
                  ? '<div class="cfg-hint"><span class="cfg-step">2<i>/3</i></span>' +
                    '<span class="cfg-say">The bot stops itself the moment it reaches this. We suggest <b>' + money(sugTP) + ' USD</b>.</span>' +
                    '<button type="button" class="cfg-use" data-act="useTP">Use ' + money(sugTP) + "</button></div>"
                  : '<small>The bot stops itself here. For this balance, ' +
                    '<button type="button" class="linky" data-act="useTP">use ' + money(sugTP) + "</button>.</small>") +
              "</div>" +

              '<div class="input-group">' +
                '<label for="stopLossInput">Stop Loss (USD)</label>' +
                '<input type="number" id="stopLossInput" min="0" step="1" value="' + esc(S.sl) + '"' +
                  (S.running ? " disabled" : "") + " />" +
              "</div>" +

              '<div class="input-group">' +
                '<label for="martingaleInput">Martingale Multiplier</label>' +
                '<input type="number" id="martingaleInput" min="1" step="0.1" value="' + esc(S.mg) + '"' +
                  (S.running ? " disabled" : "") + " />" +
              "</div>" +
            "</div>" +

            (S.guideMsg ? '<div class="guide-msg">' + icon('<path d="M20 6 9 17l-5-5"/>', 14) + "<span>" + esc(S.guideMsg) + "</span></div>" : "") +

            '<div class="config-actions">' +
              '<button class="primary-btn' + (S.step === 2 ? " glow btn-liquid-glow" : "") + '" type="button" data-act="start"' +
                (S.running ? " disabled" : "") + ">Start Bot</button>" +
              '<button class="secondary-btn' + (S.running ? " btn-liquid-glow" : "") + '" type="button" data-act="stop"' +
                (S.running ? "" : " disabled") + ">Stop Bot</button>" +
              '<div class="bot-stat">Connection: <strong id="botConnection">' + esc(S.connection) + "</strong></div>" +
            "</div>" +

            '<div class="bot-stat">Target: <strong id="botTarget">' + esc(S.target) + "</strong></div>" +
            '<div class="bot-stat">Last contract: <strong id="botLastContract">' + esc(S.lastContract) + "</strong></div>" +
          "</div>" +
        "</div>" +

        '<div class="bot-column">' +
          '<div class="bot-stats">' +
            "<h4>Live Performance</h4>" +
            '<div class="stats-grid">' +
              statRow("Account Balance", "balanceValue",
                Number(S.balance).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " USD") +
              statRow("Total Profit", "totalProfitValue", "$0.00") +
              statRow("Total Trades", "totalTradesValue", "0") +
              statRow("Win Rate", "winRateValue", "0%") +
              statRow("Current Stake", "currentStakeValue", "$0.00") +
              statRow("Consecutive Losses", "consecutiveLossesValue", "0") +
              statRow("Market / Digit", "targetValue", "-") +
              statRow("Running Time", "runningTimeValue", "00:00:00") +
            "</div>" +
          "</div>" +
        "</div>" +

        '<div class="bot-column bot-history-column">' +
          '<div class="history-card">' +
            '<h4 id="recentTrades">Recent Trades</h4>' +
            '<div class="history-list" id="historyList">' +
              S.trades.map(function (e) {
                return '<div class="history-item ' + (e.win ? "win" : "loss") + '">' + tradeRow(e) + "</div>";
              }).join("") +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>" +
    "</div>";
  }

  /** One trade, in the dashboard's own history-item shape. */
  function tradeRow(e) {
    return '<div class="history-meta">' +
        "<span><strong>" + esc(e.market) + "</strong> · digit " + esc(String(e.digit)) + "</span>" +
        "<span>Stake $" + money(e.stake) + " · " +
          new Date(e.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
        "</span>" +
      "</div>" +
      '<span class="history-profit ' + (e.win ? "win" : "loss") + '">' +
        (e.profit >= 0 ? "+" : "-") + "$" + money(Math.abs(e.profit)) + "</span>";
  }

  function statRow(label, id, value) {
    return '<div class="stat-card"><span class="stat-label">' + label +
      '</span><span class="stat-value" id="' + id + '">' + value + "</span></div>";
  }

  /* ── guided setup ──────────────────────────────────────────────────────── */

  function onType(which, value) {
    var n = parseFloat(value);
    var ok = isFinite(n) && n > 0;

    if (which === "stake") {
      S.stake = value;
      if (!ok) { if (S.step !== 0) { S.step = 0; S.guideMsg = null; render(); } return; }
      if (S.step === 0) {
        S.step = 1;
        S.guideMsg = "Stake set to " + money(n) + " USD. Now set your take profit.";
        render();
      }
      return;
    }

    S.tp = value;
    if (!ok) { if (S.step !== 1) { S.step = 1; S.guideMsg = null; render(); } return; }
    if (S.step === 1) {
      S.step = 2;
      S.guideMsg = "Take profit set to " + money(n) + " USD. Everything else is handled — press Start Bot.";
      render();
    }
  }

  function start() {
    var stake = parseFloat(S.stake);
    var tp = parseFloat(S.tp);
    if (!(stake > 0)) { toast("Set a stake first.", true); return; }
    if (!(tp > 0)) { toast("Set a take profit first.", true); return; }
    if (stake > S.balance) { toast("That stake is bigger than your balance.", true); return; }

    S.guideMsg = null;
    botUI.resetHistory();

    var mg = parseFloat(S.mg);

    // A fresh schedule for a fresh run.
    resetPlan();

    bot.start({
      initialStake: stake,
      minStake: DEFAULTS.minStake,
      takeProfit: tp,
      // Stop loss is never enforced on this page. The field is there because
      // the dashboard has it, but only the take profit ends a run — a creator
      // is recording this, and the recording needs an ending worth posting.
      stopLoss: 0,
      martingaleMultiplier: isFinite(mg) && mg >= 1 ? mg : DEFAULTS.martingaleMultiplier
    });

    // On a phone the trades are far below the fold, so go to them.
    setTimeout(function () {
      if (window.innerWidth < 1024) {
        var t = document.getElementById("recentTrades");
        if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 700);
  }

  function applyBalance(value) {
    var n = parseFloat(String(value).replace(/,/g, ""));
    if (!isFinite(n) || n <= 0) { toast("Type a balance to trade with.", true); return; }
    S.balance = Math.round(n * 100) / 100;
    S.pending = "";
    writeBalance(S.balance);
    // A new balance means new suggestions, but the defaults still work — so
    // Start stays one click away and the hints simply update.
    S.step = 2;
    S.stake = String(DEFAULTS.initialStake);
    S.tp = String(DEFAULTS.takeProfit);
    S.guideMsg = null;
    S.stats = null;
    botUI.resetHistory();
    render();
    toast("Balance set to $" + money(S.balance) + ".");
  }

  /* ── render ────────────────────────────────────────────────────────────── */

  function render() {
    document.getElementById("view").innerHTML = view();
    if (S.stats) botUI.updateStats(S.stats);
  }

  /* ── events ────────────────────────────────────────────────────────────── */

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) return;
    var act = el.dataset.act;

    if (act === "apply") { applyBalance(document.getElementById("derivBalanceInput").value); return; }


    if (act === "useStake") {
      var v = String(suggestedStake(S.balance));
      var si = document.getElementById("stakeInput");
      if (si) si.value = v;
      onType("stake", v);
      return;
    }

    if (act === "useTP") {
      var t = String(suggestedTP(S.balance));
      var ti = document.getElementById("takeProfitInput");
      if (ti) ti.value = t;
      onType("tp", t);
      return;
    }

    if (act === "start") { start(); return; }
    if (act === "stop") { if (bot) bot.stop("Stopped by you.", "warning"); }
  });

  document.addEventListener("input", function (e) {
    var el = e.target;

    if (el.id === "derivBalanceInput") {
      // Apply only appears once the number differs from what is in play — the
      // same behaviour the simulator has.
      S.pending = el.value;
      var btn = document.querySelector('[data-act="apply"]');
      if (!btn) return;
      var differs = el.value !== "" && parseFloat(el.value) !== Math.round(S.balance * 100) / 100;
      btn.hidden = !differs;
      btn.classList.toggle("is-hidden", !differs);
      return;
    }

    if (el.id === "stakeInput") { onType("stake", el.value); return; }
    if (el.id === "takeProfitInput") { onType("tp", el.value); return; }
    // These two carry no guiding — they already hold the right answer.
    if (el.id === "stopLossInput") { S.sl = el.value; return; }
    if (el.id === "martingaleInput") { S.mg = el.value; }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target && e.target.id === "derivBalanceInput") {
      e.preventDefault();
      applyBalance(e.target.value);
    }
  });

  /**
   * The outcomes this page trades on, and when recovery runs.
   *
   * A creator is recording something they will post, so nothing here loses.
   * Every trade wins. What still happens — because it is what the bot is named
   * for, and what makes the target arrive quickly — is recovery: the engine
   * switches from a digit-differ trade paying 6% to an over-4 or under-5 trade
   * paying 95%, on a stake martingale has raised.
   *
   * Recovery is armed directly rather than by losing into it. Every field the
   * engine sets when it enters recovery is set here instead — the mode, the
   * over-or-under choice, the market, the raised stake — so from the engine's
   * side it is an ordinary recovery run and every code path after that point is
   * its own.
   *
   * A run opens somewhere between five and twenty-five trades in, and is a
   * single leg or a double, chosen at random. A double compounds the martingale
   * properly: stake x3.1, then stake x3.1 again. The distance to the next run
   * is drawn again each time, so no two recordings have the same shape.
   *
   * None of this touches sim/bots/. It wraps one bot instance, so the public
   * simulator is exactly as it always was.
   */
  function alwaysWins() {
    var base = new window.SimBase();
    var wrapped = Object.create(base);
    wrapped.simulateTradeWithConstraints = function () { return true; };
    return wrapped;
  }

  var RECOVERY_MARKETS = ["R_10", "R_25", "R_50", "R_75", "R_100"];

  var runPlan = { trades: 0, nextAt: 0, legsLeft: 0, depth: 0 };

  /** Five to twenty-five, redrawn every time. */
  function gap() { return 5 + Math.floor(Math.random() * 21); }

  function resetPlan() {
    runPlan.trades = 0;
    runPlan.nextAt = gap();
    runPlan.legsLeft = 0;
    runPlan.depth = 0;
  }

  /** The multiplier the creator has in the field, or the bot's own. */
  function martingale() {
    var mg = parseFloat(S.mg);
    return isFinite(mg) && mg >= 1 ? mg : DEFAULTS.martingaleMultiplier;
  }

  /**
   * Put the bot into recovery for its next trade, exactly as a loss would —
   * except the stake is raised from the opening stake by martingale to the
   * depth of this leg, so a double run really is x3.1 and then x3.1 again.
   */
  function armRecovery(depth) {
    if (!bot) return;
    bot.recoveryMode = true;
    bot.recoveryTradeType = Math.random() < 0.5 ? "OVER" : "UNDER";
    bot.recoveryMarket = RECOVERY_MARKETS[Math.floor(Math.random() * RECOVERY_MARKETS.length)];

    var opening = bot.config && bot.config.initialStake ? bot.config.initialStake : 1;
    bot.currentStake = parseFloat((opening * Math.pow(martingale(), depth)).toFixed(2));
  }

  /**
   * Called once per booked trade, after the engine has settled it and before it
   * queues the next one — which is the only moment recovery can be armed.
   */
  function afterTrade() {
    runPlan.trades += 1;

    // Mid-run: arm the next leg, one martingale step deeper.
    if (runPlan.legsLeft > 0) {
      runPlan.legsLeft -= 1;
      runPlan.depth += 1;
      armRecovery(runPlan.depth);
      return;
    }

    // Arming happens after a trade and applies to the next one, so the count
    // is checked one ahead — otherwise a five lands on trade six.
    if (runPlan.trades + 1 >= runPlan.nextAt) {
      // Single or double, evenly.
      var legs = Math.random() < 0.5 ? 1 : 2;
      runPlan.legsLeft = legs - 1;
      runPlan.depth = 1;
      armRecovery(1);
      runPlan.nextAt = runPlan.trades + legs + gap();
    }
  }

  /* ── start ─────────────────────────────────────────────────────────────── */

  if (window.SimSmartRecoveryDifferBot) {
    bot = new window.SimSmartRecoveryDifferBot(botUI, {
      defaults: DEFAULTS,
      markets: ["R_10", "R_25", "R_50", "R_75", "R_100"]
    });
    // Swap the outcome source on this instance only. The shared engine, and
    // every other page that uses it, is untouched.
    bot.simBase = alwaysWins();
  }

  // Bring a runaway balance back before the page draws, so the suggestions are
  // scaled to something a creator would actually put on camera.
  if (S.balance > BALANCE_CEILING) {
    S.balance = Math.round((1000 + Math.random() * (BALANCE_RESET_MAX - 1000)) * 100) / 100;
  }

  writeBalance(S.balance);
  render();
})();
