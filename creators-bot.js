/**
 * MAGIC BOTS LAB — Smart Recovery Differ, for practice.
 *
 * The same engine the simulator runs, in the same panel the trading dashboard
 * draws, with the same defaults it ships: stake 1, take profit 100, stop loss
 * 1000, martingale 3.1. A creator practising on a bot that looks or behaves
 * differently would film a bot nobody else can find.
 *
 * Two things are added on top, and only two.
 *
 *   · **Guiding.** Nothing is filled in for them. The stake box glows first
 *     with a figure suggested from their balance, then the take profit, then
 *     Start. Three steps, in order, one at a time.
 *   · **A stop loss that cannot fire.** The field shows the real default so
 *     the panel matches the dashboard, but 0 is what reaches the engine, and
 *     the engine only checks a stop loss when it is above zero. A practice run
 *     therefore always ends on the take profit, which is the ending worth
 *     filming.
 *
 * The balance survives between runs. Anything can be typed; only the shuffle
 * is bounded, because its job is to look like a real account rather than to
 * cap anybody.
 */

(function () {
  "use strict";

  var BAL_KEY = "simBalance";              // the same key the simulator uses
  var RECORD_KEY = "mbl_record_snooze";

  /** Shuffle picks inside this range. Typing is not limited by it. */
  var SHUFFLE_MIN = 1000;
  var SHUFFLE_MAX = 100000;

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

  function getBalance() {
    var v = parseFloat(localStorage.getItem(BAL_KEY));
    return isFinite(v) && v > 0 ? v : 0;
  }
  function setBalance(v) { try { localStorage.setItem(BAL_KEY, String(v)); } catch (e) {} }

  /** A believable, unrepeatable balance — nobody gets the same one twice. */
  function shuffled() {
    var whole = Math.floor(SHUFFLE_MIN + Math.random() * (SHUFFLE_MAX - SHUFFLE_MIN));
    return Math.round((whole + Math.floor(Math.random() * 100) / 100) * 100) / 100;
  }

  /**
   * Suggestions scaled to what they are trading with — $70 and $300 on $1,000.
   * Big enough that the run is worth watching, small enough that it gets there.
   */
  function suggestedStake(b) { return Math.max(0.35, Math.round(b * 0.07 * 100) / 100); }
  function suggestedTP(b) { return Math.max(5, Math.round(b * 0.3 * 100) / 100); }

  /* ── state ─────────────────────────────────────────────────────────────── */

  var S = {
    stage: "gate",
    // Whatever the last run left behind is what the box opens on.
    amount: "",
    balance: getBalance(),
    step: 0,               // 0 stake · 1 take profit · 2 start · 3 done
    stake: "",
    tp: "",
    running: false,
    stats: null,
    guideMsg: null,
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
      setBalance(Math.round(balance * 100) / 100);
      setText("balanceValue", "$" + money(balance));
    },
    updateStats: function (snap) {
      S.stats = snap;
      var pl = Number(snap.totalProfit);
      var el = document.getElementById("totalProfitValue");
      if (el) {
        el.textContent = (pl >= 0 ? "+$" : "-$") + money(Math.abs(pl));
        el.className = "stat-value " + (pl >= 0 ? "positive" : "negative");
      }
      setText("totalTradesValue", snap.totalTrades);
      setText("winRateValue", snap.winRate + "%");
      setText("currentStakeValue", "$" + money(snap.currentStake));
      setText("consecutiveLossesValue", snap.consecutiveLosses);
      setText("targetValue", snap.market + " / " + snap.digit);
    },
    updateTargets: function (market, digit) {
      S.target = market + " · digit " + digit;
      setText("botTarget", S.target);
    },
    setRunningState: function (on) {
      S.running = on;
      if (!on) S.step = 3;
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
      var list = document.getElementById("historyList");
      if (!list) return;
      var row = document.createElement("div");
      row.className = "history-item history-item--enter " + (e.win ? "win" : "loss");
      row.innerHTML =
        '<div class="history-meta">' +
          "<span><strong>" + esc(e.market) + "</strong> · digit " + esc(String(e.digit)) + "</span>" +
          "<span>Stake $" + money(e.stake) + " · " +
            new Date(e.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
          "</span>" +
        "</div>" +
        '<span class="history-profit ' + (e.win ? "win" : "loss") + '">' +
          (e.profit >= 0 ? "+" : "-") + "$" + money(Math.abs(e.profit)) + "</span>";
      list.insertBefore(row, list.firstChild);
      while (list.children.length > 60) list.removeChild(list.lastChild);
    },
    resetHistory: function () {
      var list = document.getElementById("historyList");
      if (list) list.innerHTML = "";
    },
    updateRunningTime: function (t) { setText("runningTimeValue", t); }
  };

  /* ── the way in ────────────────────────────────────────────────────────── */

  function viewGate() {
    var returning = S.balance > 0;

    return '<div class="gate">' +
      '<section class="gate-bot">' +
        '<div class="bot-badges-row">' +
          '<span class="bot-chip">Smart Recovery</span>' +
          '<span class="gate-badge">Practice money</span>' +
        "</div>" +
        "<h2>Smart Recovery Differ</h2>" +
        "<p>Starts with digit differ trades on random numbers. On loss, it analyses every volatility market to find " +
        "the best one for digit over 4 or under 5, and runs recovery trades until it wins.</p>" +
        '<ul class="bot-meta">' +
          "<li>Rating 5.0/5</li><li>Smart Recovery · Market Analysis</li><li>Volatility indices</li>" +
        "</ul>" +
      "</section>" +

      '<section class="gate-form">' +
        '<div class="input-group">' +
          '<label for="balInput">Practice balance</label>' +
          '<div class="bal-row">' +
            '<div class="bal-input"><span class="bal-cur">USD</span>' +
              '<input id="balInput" type="text" inputmode="decimal" value="' + esc(S.amount) +
              '" placeholder="0.00" aria-label="Practice balance" /></div>' +
            '<button class="secondary-btn" type="button" data-act="shuffle" title="A believable figure between $' +
              money(SHUFFLE_MIN) + " and $" + money(SHUFFLE_MAX) + '">' +
              icon('<path d="m18 14 4 4-4 4"/><path d="M2 18h1.97a4 4 0 0 0 3.3-1.7l5.46-8.6A4 4 0 0 1 16.03 6H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.97a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.04a4 4 0 0 1-3.3-1.8l-.36-.45"/>', 15) +
              " Shuffle</button>" +
          "</div>" +
          "<small>Type any amount you like. " +
          (returning
            ? "This is what your last run finished on."
            : "Shuffle gives you a figure between $" + money(SHUFFLE_MIN) + " and $" + money(SHUFFLE_MAX) +
              " that does not look staged on camera.") +
          "</small>" +
        "</div>" +

        '<div class="gate-next">' +
          icon('<path d="M15 10 20 5"/><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8Z"/>', 15) +
          "<span>Next: set a stake, set a target, press start — and record your screen while it trades. " +
          "<b>None of this is real money.</b></span>" +
        "</div>" +

        '<button class="primary-btn btn-liquid-glow gate-go" type="button" data-act="open">' +
          (returning ? "Continue" : "Open the bot") +
        "</button>" +
      "</section>" +
    "</div>" + window.MBLSteps.html();
  }

  /* ── the bot, in the dashboard's own clothes ───────────────────────────── */

  function viewBot() {
    var sug = suggestedStake(S.balance);
    var sugTP = suggestedTP(S.balance);

    return '<div class="bot-panel-content">' +
      '<div class="bot-panel-header">' +
        "<div>" +
          '<div style="font-size:16px;font-weight:700;">Smart Recovery Differ</div>' +
          '<div style="font-size:13px;color:var(--muted);">Runs smart recovery digit differ. Starts with DIGITDIFF, then uses DIGITOVER/DIGITUNDER recovery with martingale.</div>' +
        "</div>" +
      "</div>" +

      '<div class="bot-panel-grid">' +
        '<div class="bot-column">' +
          '<div class="bot-config">' +
            "<h4>Configuration</h4>" +

            '<div class="config-grid">' +
              '<div class="input-group' + (S.step === 0 ? " glow" : "") + '">' +
                '<label for="stakeInput">Initial Stake (USD)</label>' +
                '<input type="number" id="stakeInput" min="0.35" step="0.01" value="' + esc(S.stake) +
                  '" placeholder="' + money(DEFAULTS.initialStake) + '"' + (S.running ? " disabled" : "") + " />" +
                (S.step === 0
                  ? '<div class="cfg-hint"><b>Step 1 of 3.</b> What each trade risks. We suggest <b>' + money(sug) +
                    ' USD</b> for this balance. <button type="button" class="linky" data-act="useStake">Use ' + money(sug) + "</button></div>"
                  : '<small>Minimum stake is enforced by Deriv for each contract.</small>') +
              "</div>" +

              '<div class="input-group' + (S.step === 1 ? " glow" : "") + '">' +
                '<label for="takeProfitInput">Take Profit (USD)</label>' +
                '<input type="number" id="takeProfitInput" min="5" step="1" value="' + esc(S.tp) +
                  '" placeholder="' + money(DEFAULTS.takeProfit) + '"' + (S.running ? " disabled" : "") + " />" +
                (S.step === 1
                  ? '<div class="cfg-hint"><b>Step 2 of 3.</b> The bot stops itself the moment it reaches this. We suggest <b>' +
                    money(sugTP) + ' USD</b>. <button type="button" class="linky" data-act="useTP">Use ' + money(sugTP) + "</button></div>"
                  : "") +
              "</div>" +

              '<div class="input-group">' +
                '<label for="stopLossInput">Stop Loss (USD)</label>' +
                '<input type="number" id="stopLossInput" value="' + DEFAULTS.stopLoss + '" disabled />' +
              "</div>" +

              '<div class="input-group">' +
                '<label for="martingaleInput">Martingale Multiplier</label>' +
                '<input type="number" id="martingaleInput" value="' + DEFAULTS.martingaleMultiplier + '" disabled />' +
              "</div>" +
            "</div>" +

            '<div class="locked-note">' + icon('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 13) +
              '<span>Stop loss and martingale are the bot\'s own defaults and are left alone here. ' +
              '<b style="color:var(--text)">On practice the stop loss will not fire</b>, so a run always ends on your ' +
              "take profit — which is the ending you want on camera.</span></div>" +

            (S.guideMsg ? '<div class="guide-msg">' + icon('<path d="M20 6 9 17l-5-5"/>', 13) + "<span>" + esc(S.guideMsg) + "</span></div>" : "") +

            '<div class="config-actions">' +
              '<button class="primary-btn' + (S.step === 2 ? " glow btn-liquid-glow" : "") + '" type="button" data-act="start"' +
                (S.running ? " disabled" : "") + ">Start Bot</button>" +
              '<button class="secondary-btn' + (S.running ? " btn-liquid-glow" : "") + '" type="button" data-act="stop"' +
                (S.running ? "" : " disabled") + ">Stop Bot</button>" +
              '<div class="bot-stat">Connection: <strong id="botConnection">' + esc(S.connection) + "</strong></div>" +
            "</div>" +

            (S.step === 2 ? '<div class="cfg-hint"><b>Step 3 of 3.</b> Start recording your screen, then press Start Bot.</div>' : "") +

            '<div class="bot-stat">Target: <strong id="botTarget">' + esc(S.target) + "</strong></div>" +
            '<div class="bot-stat">Last contract: <strong id="botLastContract">' + esc(S.lastContract) + "</strong></div>" +
          "</div>" +
        "</div>" +

        '<div class="bot-column">' +
          '<div class="bot-stats">' +
            "<h4>Live Performance</h4>" +
            '<div class="stats-grid">' +
              statRow("Account Balance", "balanceValue", "$" + money(S.balance)) +
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
            '<div class="history-list" id="historyList"></div>' +
          "</div>" +
        "</div>" +
      "</div>" +

      window.MBLSteps.html() +
    "</div>";
  }

  function statRow(label, id, value) {
    return '<div class="stat-card"><span class="stat-label">' + label +
      '</span><span class="stat-value" id="' + id + '">' + value + "</span></div>";
  }

  /* ── the record prompt ─────────────────────────────────────────────────── */

  function recordPromptDue() {
    try {
      var until = parseInt(localStorage.getItem(RECORD_KEY) || "0", 10);
      return !(until && Date.now() < until);
    } catch (e) { return true; }
  }

  function askToRecord(next) {
    if (!recordPromptDue()) { next(); return; }

    var el = document.createElement("div");
    el.className = "rec-overlay";
    el.innerHTML =
      '<div class="rec-panel">' +
        "<h3>Start recording first</h3>" +
        "<p>The bot is about to open. Begin your screen recording <b>now</b>, so you catch it from the first trade " +
        "rather than joining halfway through.</p>" +
        '<label class="rec-check"><input type="checkbox" id="dontAsk" /><span>Do not show this again</span></label>' +
        '<button class="primary-btn" type="button" id="recGo" style="width:100%">I am recording — open the bot</button>' +
        '<button class="secondary-btn" type="button" id="recSkip" style="width:100%;margin-top:8px">Open it without recording</button>' +
      "</div>";
    document.body.appendChild(el);

    var finish = function () {
      if (el.querySelector("#dontAsk").checked) {
        try { localStorage.setItem(RECORD_KEY, String(Date.now() + 30 * 24 * 3600 * 1000)); } catch (e) {}
      }
      el.remove();
      next();
    };
    el.querySelector("#recGo").onclick = finish;
    el.querySelector("#recSkip").onclick = finish;
  }

  /* ── guided setup ──────────────────────────────────────────────────────── */

  function onType(which, value) {
    var n = parseFloat(value);
    if (which === "stake") {
      S.stake = value;
      if (isFinite(n) && n > 0 && S.step === 0) {
        S.step = 1;
        S.guideMsg = "Stake set to " + money(n) + " USD. Now set your take profit.";
        render();
      }
    } else {
      S.tp = value;
      if (isFinite(n) && n > 0 && S.step === 1) {
        S.step = 2;
        S.guideMsg = "Take profit set to " + money(n) + " USD. Everything else is handled — press Start Bot.";
        render();
      }
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

    bot.start({
      initialStake: stake,
      minStake: DEFAULTS.minStake,
      takeProfit: tp,
      // The field above shows the real default so the panel matches the
      // dashboard. Zero is what reaches the engine, and the engine only checks
      // a stop loss when it is above zero — so on practice it cannot fire.
      stopLoss: 0,
      martingaleMultiplier: DEFAULTS.martingaleMultiplier
    });

    // On a phone the trades are far below the fold, so go to them.
    setTimeout(function () {
      if (window.innerWidth < 1024) {
        var t = document.getElementById("recentTrades");
        if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 700);
  }

  /* ── render ────────────────────────────────────────────────────────────── */

  function render() {
    document.getElementById("view").innerHTML = S.stage === "bot" ? viewBot() : viewGate();
    document.getElementById("topTitle").textContent = S.stage === "bot" ? "Smart Recovery Differ" : "Create a post";
    document.getElementById("topSub").textContent = S.stage === "bot"
      ? "Set it up, record it — steps 2 and 3 are below"
      : "Practise on the real bot, then record, talk over it and edit";
    if (S.stats) botUI.updateStats(S.stats);
  }

  /* ── events ────────────────────────────────────────────────────────────── */

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) return;
    var act = el.dataset.act;

    if (act === "shuffle") {
      S.amount = String(shuffled());
      render();
      toast("Balance shuffled — that one will not look staged.");
      return;
    }

    if (act === "open") {
      var n = parseFloat(String(S.amount).replace(/,/g, ""));
      if (!isFinite(n) || n <= 0) { toast("Type a balance to practise with.", true); return; }

      askToRecord(function () {
        setBalance(n);
        S.balance = n;
        S.stage = "bot";
        // Nothing is filled in. The guide starts at step one, where it should.
        S.step = 0;
        S.stake = "";
        S.tp = "";
        S.guideMsg = null;
        S.stats = null;
        render();
      });
      return;
    }

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
    if (act === "stop") { if (bot) bot.stop("Stopped by you.", "warning"); return; }
    if (act === "voice") { toast("Downloading " + window.MBLSteps.downloadVoice()); }
  });

  document.addEventListener("input", function (e) {
    var el = e.target;
    if (el.id === "balInput") { S.amount = el.value; return; }
    if (el.id === "stakeInput") { onType("stake", el.value); return; }
    if (el.id === "takeProfitInput") { onType("tp", el.value); }
  });

  /* ── start ─────────────────────────────────────────────────────────────── */

  if (window.SimSmartRecoveryDifferBot) {
    bot = new window.SimSmartRecoveryDifferBot(botUI, {
      defaults: DEFAULTS,
      markets: ["R_10", "R_25", "R_50", "R_75", "R_100"]
    });
  }

  // The box opens on whatever the last run left behind.
  if (S.balance > 0) S.amount = String(S.balance);
  render();
})();
