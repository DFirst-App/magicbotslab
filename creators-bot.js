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
  var TIP_KEY = "mbl_bal_tip_seen";

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

  function readBalance() {
    var v = parseFloat(localStorage.getItem(BAL_KEY));
    return isFinite(v) && v > 0 ? v : DEFAULTS.takeProfit * 10;   // 1,000 to open on
  }
  function writeBalance(v) { try { localStorage.setItem(BAL_KEY, String(v)); } catch (e) {} }

  /** A believable, unrepeatable figure — nobody films the same balance twice. */
  function shuffled() {
    var whole = Math.floor(SHUFFLE_MIN + Math.random() * (SHUFFLE_MAX - SHUFFLE_MIN));
    return Math.round((whole + Math.floor(Math.random() * 100) / 100) * 100) / 100;
  }

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
    step: 0,               // 0 stake · 1 take profit · 2 start · 3 running or done
    stake: "",
    tp: "",
    running: false,
    stats: null,
    guideMsg: null,
    // The trades live here, not only in the DOM: a re-render used to wipe the
    // list at exactly the moment the run ended, which is the moment it matters.
    trades: [],
    connection: "Idle",
    target: "--",
    lastContract: "--",
    tipSeen: false
  };

  try { S.tipSeen = localStorage.getItem(TIP_KEY) === "1"; } catch (e) {}

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
      setText("balanceValue", "$" + money(balance));
      var input = document.getElementById("derivBalanceInput");
      // Do not fight somebody who is mid-edit.
      if (input && document.activeElement !== input) input.value = (Math.round(balance * 100) / 100).toFixed(2);
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

      (S.tipSeen ? "" :
        '<div class="bal-tip">' + icon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>', 15) +
        "<span>Type any balance you like and tap <b>Apply</b> — or " +
        '<button type="button" data-act="shuffle">shuffle one</button> that does not look staged on camera.</span>' +
        '<button type="button" data-act="tipdone" aria-label="Dismiss">Got it</button></div>') +

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
                  ? '<div class="cfg-hint"><b>Step 1 of 3.</b> What each trade risks. On a balance of $' + money(S.balance) +
                    " we suggest <b>" + money(sug) + ' USD</b>. <button type="button" class="linky" data-act="useStake">Use ' + money(sug) + "</button></div>"
                  : '<small>Minimum stake is enforced by Deriv for each contract.</small>') +
              "</div>" +

              '<div class="input-group' + (S.step === 1 ? " glow" : S.step > 1 ? " done" : "") + '">' +
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
              "<span>Stop loss and martingale are the bot's own defaults and are left alone here. " +
              "<b>On simulation the stop loss will not fire</b>, so a run ends on your take profit — the ending you " +
              "want on camera.</span></div>" +

            (S.guideMsg ? '<div class="guide-msg">' + icon('<path d="M20 6 9 17l-5-5"/>', 14) + "<span>" + esc(S.guideMsg) + "</span></div>" : "") +

            '<div class="config-actions">' +
              '<button class="primary-btn' + (S.step === 2 ? " glow btn-liquid-glow" : "") + '" type="button" data-act="start"' +
                (S.running ? " disabled" : "") + ">Start Bot</button>" +
              '<button class="secondary-btn' + (S.running ? " btn-liquid-glow" : "") + '" type="button" data-act="stop"' +
                (S.running ? "" : " disabled") + ">Stop Bot</button>" +
              '<div class="bot-stat">Connection: <strong id="botConnection">' + esc(S.connection) + "</strong></div>" +
            "</div>" +

            (S.step === 2
              ? '<div class="cfg-hint"><b>Step 3 of 3.</b> Start your screen recording, then press Start Bot.</div>'
              : "") +

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
      // The field shows the real default so the panel matches the dashboard.
      // Zero is what reaches the engine, and the engine only checks a stop loss
      // when it is above zero — so on simulation it cannot fire.
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

  function applyBalance(value) {
    var n = parseFloat(String(value).replace(/,/g, ""));
    if (!isFinite(n) || n <= 0) { toast("Type a balance to trade with.", true); return; }
    S.balance = Math.round(n * 100) / 100;
    S.pending = "";
    writeBalance(S.balance);
    // A new balance means new suggestions, so start the walk again.
    S.step = 0;
    S.stake = "";
    S.tp = "";
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

    if (act === "shuffle") { applyBalance(shuffled()); return; }

    if (act === "tipdone") {
      S.tipSeen = true;
      try { localStorage.setItem(TIP_KEY, "1"); } catch (err) {}
      render();
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
    if (el.id === "takeProfitInput") { onType("tp", el.value); }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target && e.target.id === "derivBalanceInput") {
      e.preventDefault();
      applyBalance(e.target.value);
    }
  });

  /* ── start ─────────────────────────────────────────────────────────────── */

  if (window.SimSmartRecoveryDifferBot) {
    bot = new window.SimSmartRecoveryDifferBot(botUI, {
      defaults: DEFAULTS,
      markets: ["R_10", "R_25", "R_50", "R_75", "R_100"]
    });
  }

  writeBalance(S.balance);
  render();
})();
