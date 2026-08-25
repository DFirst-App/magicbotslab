/**
 * MAGIC BOTS LAB — create a post.
 *
 * Most creators arrive having never traded. They are asked to screen-record a
 * bot placing trades, and the first time they try it they are fumbling through
 * a platform they have never opened, which is exactly what the video shows.
 *
 * So step one is the real thing: the same Smart Recovery Differ engine the
 * simulator runs, in the same panel the trading dashboard draws — same class
 * names, same layout, same live-performance list. A creator practising on a
 * different-looking bot would film a bot nobody else can find.
 *
 * The only thing added on top is the guiding. The stake box glows first with a
 * figure scaled to their balance; when it has a value the take profit glows;
 * when that has one, Start glows. Stop loss is passed as 0, which switches it
 * off in the engine, so a practice run always ends on the take profit — the
 * ending worth filming.
 */

(function () {
  "use strict";

  var BAL_KEY = "simBalance";              // the same key the simulator uses
  var RECORD_KEY = "mbl_record_snooze";
  var MIN_BALANCE = 1000;
  /** The most someone may type from scratch. A balance they GREW is not capped. */
  var MAX_TYPED = 92569.34;

  var VOICE_SRC = "creators/blake-voice-example.mp3";

  var STARTERS = [
    "You have probably never seen a trading bot actually place a trade. This one is running by itself — and it is 100% free.",
    "Everyone says trading bots are a scam. Watch this one work, then decide. I use this, it costs nothing.",
    "I used to sit and watch charts all day. Now I use this instead — free bots that trade for you.",
    "This took me 90 seconds to set up. I use Magic Bots Lab and every bot on it is free.",
    "If you have MetaTrader 5, you can do this today. Free Expert Advisors, any broker.",
    "Nobody explains what a synthetic index is, so watch a free bot trade one and I will tell you."
  ];

  /* ── helpers ───────────────────────────────────────────────────────────── */

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
  function randomBalance() {
    var whole = Math.floor(MIN_BALANCE + Math.random() * (MAX_TYPED - MIN_BALANCE));
    return Math.round((whole + Math.floor(Math.random() * 100) / 100) * 100) / 100;
  }

  /**
   * Suggestions scaled to what they are trading with — $70 and $300 on $1,000.
   * Big enough that the run is worth watching, small enough that it gets there.
   */
  function suggestedStake(b) { return Math.max(1, Math.round(b * 0.07 * 100) / 100); }
  function suggestedTP(b) { return Math.max(5, Math.round(b * 0.3 * 100) / 100); }

  /* ── state ─────────────────────────────────────────────────────────────── */

  var S = {
    stage: "gate",
    amount: String(MIN_BALANCE),
    balance: getBalance(),
    step: 0,               // 0 stake · 1 take profit · 2 press start · 3 done
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
      var conn = document.getElementById("botConnection");
      if (conn) conn.textContent = S.connection;
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

  function setText(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  /* ── the balance gate ──────────────────────────────────────────────────── */

  function viewGate() {
    var carry = S.balance >= 1;

    return '<div class="bot-panel-content">' +
      '<div class="bot-config">' +
        "<h4>Step 1 of 3 · Screen recording</h4>" +
        '<p style="margin:0;font-size:13.5px;line-height:1.65;color:var(--muted)">' +
          "You are about to open <b style=\"color:var(--text)\">Smart Recovery Differ</b> — the same bot from the " +
          "trading dashboard, the same engine, on practice money. Set a balance, let it trade, and record your screen " +
          "while it does. That recording is your video." +
        "</p>" +
        '<p style="margin:0;font-size:13px;line-height:1.6;color:#fcd34d">' +
          "<b>Nothing here is real money.</b> It is a practice account, so your first video does not have you fumbling " +
          "through a platform you have never opened." +
        "</p>" +

        '<div class="input-group">' +
          "<label>Starting balance</label>" +
          '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
            '<div class="bal-input"><span class="bal-cur">USD</span>' +
              '<input id="balInput" type="text" inputmode="decimal" value="' + esc(S.amount) + '" aria-label="Starting balance" /></div>' +
            '<button class="secondary-btn" type="button" data-act="shuffle">Shuffle</button>' +
          "</div>" +
          "<small style=\"display:block\">Anything from $" + money(MIN_BALANCE) + " to $" + money(MAX_TYPED) +
          ". A round number looks staged on camera — Shuffle gives you one that does not.</small>" +
        "</div>" +

        (carry
          ? '<div class="carry"><span>Your last run finished on <b style="color:var(--text)">$' + money(S.balance) + "</b>.</span>" +
            '<button class="secondary-btn" type="button" data-act="carry" style="padding:7px 13px;font-size:12.5px">Carry on from that</button></div>'
          : "") +

        '<div class="config-actions">' +
          '<button class="primary-btn btn-liquid-glow" type="button" data-act="open">Open Smart Recovery Differ</button>' +
        "</div>" +
      "</div>" +

      steps() +
    "</div>";
  }

  /* ── the bot, in the dashboard's own clothes ───────────────────────────── */

  function viewBot() {
    var sug = suggestedStake(S.balance);
    var sugTP = suggestedTP(S.balance);

    return '<div class="bot-panel-content">' +
      '<div class="bot-panel-header">' +
        "<div>" +
          '<div style="font-size:16px;font-weight:700;">Smart Recovery Differ</div>' +
          '<div style="font-size:13px;color:var(--muted);">Practice money · the same bot from the trading dashboard</div>' +
        "</div>" +
      "</div>" +

      '<div class="bot-panel-grid">' +
        '<div class="bot-column">' +
          '<div class="bot-config">' +
            "<h4>Configuration</h4>" +

            '<div class="config-grid">' +
              '<div class="input-group' + (S.step === 0 ? " glow" : "") + '">' +
                '<label for="stakeInput">Initial Stake (USD)</label>' +
                '<input type="number" id="stakeInput" min="0.35" step="0.01" value="' + esc(S.stake) + '"' + (S.running ? " disabled" : "") + " />" +
                (S.step === 0
                  ? '<div class="cfg-hint">Step 1 of 2 — what each trade risks. We suggest <b>' + money(sug) +
                    ' USD</b>. <button type="button" class="linky" data-act="useStake">Use ' + money(sug) + "</button></div>"
                  : "") +
              "</div>" +

              '<div class="input-group' + (S.step === 1 ? " glow" : "") + '">' +
                '<label for="takeProfitInput">Take Profit (USD)</label>' +
                '<input type="number" id="takeProfitInput" min="5" step="1" value="' + esc(S.tp) + '"' + (S.running ? " disabled" : "") + " />" +
                (S.step === 1
                  ? '<div class="cfg-hint">Step 2 of 2 — the bot stops itself the moment it reaches this. We suggest <b>' +
                    money(sugTP) + ' USD</b>. <button type="button" class="linky" data-act="useTP">Use ' + money(sugTP) + "</button></div>"
                  : "") +
              "</div>" +

              '<div class="input-group">' +
                "<label>Stop Loss (USD)</label>" +
                '<input type="number" value="0" disabled />' +
              "</div>" +

              '<div class="input-group">' +
                "<label>Martingale Multiplier</label>" +
                '<input type="number" value="3.1" disabled />' +
              "</div>" +
            "</div>" +

            '<div class="locked-note">' + icon('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 13) +
              "<span><b style=\"color:var(--text)\">Stop loss is switched off</b> and martingale is already set. Leave them — " +
              "this way the run ends on your take profit, which is the ending you want on camera.</span></div>" +

            (S.guideMsg ? '<div class="guide-msg">' + icon('<path d="M20 6 9 17l-5-5"/>', 13) + "<span>" + esc(S.guideMsg) + "</span></div>" : "") +

            '<div class="config-actions">' +
              '<button class="primary-btn' + (S.step === 2 ? " glow btn-liquid-glow" : "") + '" type="button" data-act="start"' + (S.running ? " disabled" : "") + ">Start Bot</button>" +
              '<button class="secondary-btn' + (S.running ? " btn-liquid-glow" : "") + '" type="button" data-act="stop"' + (S.running ? "" : " disabled") + ">Stop Bot</button>" +
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

      steps() +
    "</div>";
  }

  function statRow(label, id, value) {
    return '<div class="stat-card"><span class="stat-label">' + label +
      '</span><span class="stat-value" id="' + id + '">' + value + "</span></div>";
  }

  /* ── the three steps ───────────────────────────────────────────────────── */

  function steps() {
    return '<div class="steps">' +
      '<div class="bot-config">' +
        '<div class="step-n">1</div>' +
        "<h4>Record your screen</h4>" +
        '<p style="margin:0;font-size:13px;line-height:1.6;color:var(--muted)">Start the bot above and record it ' +
        'trading. <b style="color:var(--text)">20 to 40 seconds is plenty</b> — enough to see a few trades land and ' +
        "the bot stop itself at the target.</p>" +
        '<ul class="tips">' +
          "<li><b>On a phone:</b> swipe down for the control centre and tap Screen Record. On iPhone, add it in Settings → Control Centre first.</li>" +
          "<li><b>On a computer:</b> Windows — press <b>Win + Alt + R</b>. Mac — press <b>Shift + Cmd + 5</b>.</li>" +
          "<li>Record in <b>portrait</b> if you can. Sideways video gets less reach on every platform.</li>" +
        "</ul>" +
      "</div>" +

      '<div class="bot-config">' +
        '<div class="step-n">2</div>' +
        "<h4>Talk over it</h4>" +
        '<p style="margin:0;font-size:13px;line-height:1.6;color:var(--muted)">A silent screen recording is not a ' +
        'video. Say what people are looking at and say the name. <b style="color:var(--text)">Your own voice or a ' +
        "realistic AI voice — both are fine.</b></p>" +
        '<div class="voice-box">' +
          '<div class="voice-head">' +
            icon('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>', 16) +
            "<span>Hear an AI voice-over</span>" +
            '<button class="secondary-btn" type="button" data-act="voice" style="padding:7px 13px;font-size:12.5px">Download</button>' +
          "</div>" +
          '<audio controls preload="none" src="' + VOICE_SRC + '"></audio>' +
          '<p style="margin:8px 0 0;font-size:11.5px;color:rgba(152,162,189,0.75)">This one was made with a free AI voice tool. Using one is allowed.</p>' +
        "</div>" +
        '<p style="margin:12px 0 0;font-size:13px;color:var(--text)"><b>Openers that work:</b></p>' +
        '<ul class="tips">' + STARTERS.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" +
      "</div>" +

      '<div class="bot-config">' +
        '<div class="step-n">3</div>' +
        "<h4>Edit it</h4>" +
        '<p style="margin:0;font-size:13px;line-height:1.6;color:var(--muted)">Put the recording and the voice ' +
        'together in whatever you already use — <b style="color:var(--text)">CapCut</b> is free and does all of this ' +
        "on a phone. VN and InShot work too.</p>" +
        '<ul class="tips">' +
          "<li>Add <b>captions</b>. Most people watch with the sound off, and CapCut writes them for you.</li>" +
          "<li>Cut the first second. Start on the trade, not on you lining up the shot.</li>" +
          "<li>Say <b>Magic Bots Lab</b> out loud, and say the bots are <b>100% free</b>. That is a rule, not a tip.</li>" +
          "<li>Export at 1080p and post the same video to all three of your accounts.</li>" +
        "</ul>" +
      "</div>" +
    "</div>";
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
        "<p>The bot is about to start trading. Begin your screen recording <b>now</b>, so you catch it from the first " +
        "trade rather than joining halfway through.</p>" +
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
        S.guideMsg = "Take profit set to " + money(n) + " USD. Stop loss and martingale are handled — press Start Bot.";
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
      minStake: 0.35,
      takeProfit: tp,
      // Zero switches the stop loss off in the engine — it only checks when > 0.
      stopLoss: 0,
      martingaleMultiplier: 3.1
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
      : "Three steps: record, talk over it, edit";
    if (S.stats) botUI.updateStats(S.stats);
  }

  /* ── events ────────────────────────────────────────────────────────────── */

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) return;
    var act = el.dataset.act;

    if (act === "shuffle") {
      S.amount = String(randomBalance());
      render();
      toast("Balance shuffled — that one will not look staged.");
      return;
    }

    if (act === "carry") { S.amount = String(S.balance); render(); return; }

    if (act === "open") {
      var n = parseFloat(String(S.amount).replace(/,/g, ""));
      if (!isFinite(n) || n < MIN_BALANCE) { toast("Start with at least $" + money(MIN_BALANCE) + ".", true); return; }
      if (n > MAX_TYPED) { toast("The most you can type in is $" + money(MAX_TYPED) + ".", true); return; }

      askToRecord(function () {
        setBalance(n);
        S.balance = n;
        S.stage = "bot";
        S.stake = String(suggestedStake(n));
        S.tp = "";
        // The suggestion is already in the box, so the guide is on take profit.
        S.step = 1;
        S.guideMsg = "Stake set to " + money(suggestedStake(n)) + " USD. Now set your take profit.";
        render();
      });
      return;
    }

    if (act === "useStake") { onType("stake", String(suggestedStake(S.balance))); return; }
    if (act === "useTP") { onType("tp", String(suggestedTP(S.balance))); return; }
    if (act === "start") { start(); return; }
    if (act === "stop") { if (bot) bot.stop("Stopped by you.", "warning"); return; }

    if (act === "voice") {
      // A unique name per download, so a creator can tell one file from another.
      var code = Math.random().toString(36).slice(2, 7).toUpperCase();
      var a = document.createElement("a");
      a.href = VOICE_SRC;
      a.download = "blake-magicbotslab-" + code + ".mp3";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast("Downloading blake-magicbotslab-" + code + ".mp3");
    }
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
      defaults: { initialStake: 1, minStake: 0.35, takeProfit: 100, stopLoss: 0, martingaleMultiplier: 3.1 },
      markets: ["R_10", "R_25", "R_50", "R_75", "R_100"]
    });
  }

  if (S.balance >= MIN_BALANCE) S.amount = String(S.balance);
  render();
})();
