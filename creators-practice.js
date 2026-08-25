/**
 * MAGIC BOTS LAB — create a post.
 *
 * Most creators arrive having never traded. They are asked to screen-record a
 * bot placing trades, and the first time they try it they are fumbling through
 * a platform they have never opened, which is exactly what the video shows.
 *
 * So step one is a real bot: the same Smart Recovery Differ engine the
 * simulator runs, driven from this page with fake money. Then step two is the
 * voice-over and step three is the edit, because a screen recording on its own
 * is not a video.
 *
 * The setup is guided rather than explained. The stake box glows first with a
 * figure suggested from their balance; when it has a value the take profit
 * glows; when that has one the Start button glows. Stop loss is switched off
 * outright — passing 0 disables it in the engine — so a practice run always
 * ends on the happy ending a creator wants to film.
 *
 * The balance survives between runs, so somebody can come back and carry on
 * from whatever the bot left them.
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
    return '<svg class="ico" viewBox="0 0 24 24" width="' + n + '" height="' + n +
      '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
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

  function setBalance(v) {
    try { localStorage.setItem(BAL_KEY, String(v)); } catch (e) {}
  }

  /** A believable, unrepeatable balance — nobody gets the same one twice. */
  function randomBalance() {
    var whole = Math.floor(MIN_BALANCE + Math.random() * (MAX_TYPED - MIN_BALANCE));
    return Math.round((whole + Math.floor(Math.random() * 100) / 100) * 100) / 100;
  }

  /**
   * What to suggest, scaled to what they are trading with. $70 stake and a $300
   * target on $1,000 — big enough that the run is worth watching, small enough
   * that it gets there.
   */
  function suggestedStake(balance) {
    return Math.max(1, Math.round(balance * 0.07 * 100) / 100);
  }
  function suggestedTP(balance) {
    return Math.max(5, Math.round(balance * 0.3 * 100) / 100);
  }

  /* ── state ─────────────────────────────────────────────────────────────── */

  var S = {
    stage: "gate",          // gate → bot
    amount: String(MIN_BALANCE),
    balance: getBalance(),
    // Guided setup: 0 stake · 1 take profit · 2 press start · 3 running or done
    step: 0,
    stake: "",
    tp: "",
    running: false,
    stats: null,
    history: [],
    status: null,
    guideMsg: null
  };

  var bot = null;

  /* ── the bot's view of us ──────────────────────────────────────────────── */

  var botUI = {
    updateBalance: function (balance) {
      S.balance = balance;
      // Persist as it moves, so closing the tab mid-run does not lose it.
      setBalance(Math.round(balance * 100) / 100);
      paintLive();
    },
    updateStats: function (snap) { S.stats = snap; paintLive(); },
    updateTargets: function (market, digit) {
      S.target = { market: market, digit: digit };
      paintLive();
    },
    setRunningState: function (on) {
      S.running = on;
      if (!on) S.step = 3;
      render();
    },
    showStatus: function (msg, type) {
      S.status = { msg: msg, type: type };
      paintLive();
      if (type === "success" && /take profit/i.test(msg)) celebrate();
    },
    addHistoryEntry: function (e) {
      S.history.unshift(e);
      if (S.history.length > 40) S.history.pop();
      paintLive();
    },
    resetHistory: function () { S.history = []; paintLive(); },
    updateRunningTime: function (t) {
      var el = document.getElementById("runTime");
      if (el) el.textContent = t;
    }
  };

  /* ── the balance gate ──────────────────────────────────────────────────── */

  function viewGate() {
    var carry = S.balance >= 1;

    return '<div class="stack" style="max-width:1100px;margin:0 auto">' +
      '<section class="card accent">' +
        '<div class="eyebrow">' + icon('<path d="M15 10 20 5M4 20l5-5"/><rect x="2" y="2" width="20" height="20" rx="3"/>') + " Step 1 of 3 · Screen recording</div>" +
        "<h2>Practise on a real bot first</h2>" +
        "<p>This is the same <b>Smart Recovery Differ</b> that runs in the simulator — the real engine, on practice money. " +
        "Set a balance, let it trade, and record your screen while it does. That recording is your video.</p>" +
        '<p style="color:var(--warning)"><b>Nothing here is real money.</b> It is a practice account so your first video ' +
        "does not have you fumbling through a platform you have never opened.</p>" +
      "</section>" +

      '<section class="card">' +
        '<div class="eyebrow">' + icon('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>') + " Set your balance</div>" +
        "<p>Pick what the account should start with. Anything from <b>$" + money(MIN_BALANCE) + "</b> to <b>$" + money(MAX_TYPED) +
        "</b>. A round number looks staged on camera — the shuffle button gives you one that does not.</p>" +

        '<div class="row" style="margin-top:12px">' +
          '<div class="bal-input">' +
            '<span class="bal-cur">USD</span>' +
            '<input id="balInput" type="text" inputmode="decimal" value="' + esc(S.amount) + '" aria-label="Starting balance" />' +
          "</div>" +
          '<button class="btn ghost" data-act="shuffle">' +
            icon('<path d="m18 14 4 4-4 4"/><path d="m2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>', 15) +
            " Shuffle" +
          "</button>" +
        "</div>" +

        (carry
          ? '<div class="carry"><span>Your last run finished on <b>$' + money(S.balance) + "</b>.</span>" +
            '<button class="btn sm" data-act="carry">Carry on from that</button></div>'
          : "") +

        '<button class="btn wide" data-act="open" style="margin-top:14px">' +
          icon('<path d="m5 3 14 9-14 9V3z"/>', 15) + " Open the bot" +
        "</button>" +
      "</section>" +

      steps() +
    "</div>";
  }

  /* ── the bot ───────────────────────────────────────────────────────────── */

  function viewBot() {
    var sug = suggestedStake(S.balance);
    var sugTP = suggestedTP(S.balance);

    return '<div class="bot-wrap">' +
      '<section class="card bot-cfg">' +
        '<div class="bal-strip">' +
          '<span class="bal-strip-k">Practice balance</span>' +
          '<span class="bal-strip-v" id="liveBal">$' + money(S.balance) + "</span>" +
          '<span class="pill good" style="margin-left:auto">Practice money</span>' +
        "</div>" +

        "<h2 style=\"margin-top:14px\">Configuration</h2>" +

        '<div class="cfg-field' + (S.step === 0 ? " glow" : "") + '">' +
          '<label class="lbl" for="stakeIn">Initial stake (USD)</label>' +
          '<input class="field" id="stakeIn" type="text" inputmode="decimal" value="' + esc(S.stake) + '"' + (S.running ? " disabled" : "") + ' />' +
          (S.step === 0
            ? '<div class="cfg-hint">Step 1 of 2 — what each trade risks. We suggest <b>' + money(sug) +
              ' USD</b> for a balance of $' + money(S.balance) + '. <button type="button" class="linky" data-act="useStake">Use ' + money(sug) + "</button></div>"
            : "") +
        "</div>" +

        '<div class="cfg-field' + (S.step === 1 ? " glow" : "") + '">' +
          '<label class="lbl" for="tpIn">Take profit (USD)</label>' +
          '<input class="field" id="tpIn" type="text" inputmode="decimal" value="' + esc(S.tp) + '"' + (S.running ? " disabled" : "") + ' />' +
          (S.step === 1
            ? '<div class="cfg-hint">Step 2 of 2 — the bot stops itself the moment it reaches this. We suggest <b>' +
              money(sugTP) + ' USD</b>. <button type="button" class="linky" data-act="useTP">Use ' + money(sugTP) + "</button></div>"
            : "") +
        "</div>" +

        '<div class="cfg-locked">' +
          icon('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 13) +
          "<span><b>Stop loss is switched off</b> and martingale is already set. Leave them alone — this way the run " +
          "ends on your take profit, which is the ending you want on camera.</span>" +
        "</div>" +

        (S.guideMsg ? '<div class="guide-msg">' + icon('<path d="M20 6 9 17l-5-5"/>', 13) + " " + esc(S.guideMsg) + "</div>" : "") +

        '<div class="row" style="margin-top:14px">' +
          '<button class="btn go' + (S.step === 2 ? " glow" : "") + '" data-act="start"' + (S.running ? " disabled" : "") + ">" +
            icon('<path d="m5 3 14 9-14 9V3z"/>', 15) + " Start bot</button>" +
          '<button class="btn ghost" data-act="stop"' + (S.running ? "" : " disabled") + ">Stop</button>" +
          (S.running ? '<span class="running-pill">' + icon('<path d="M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9/>') + " running · <span id=\"runTime\">0s</span></span>" : "") +
        "</div>" +

        (S.status ? '<div class="cfg-status ' + esc(S.status.type || "") + '">' + esc(S.status.msg) + "</div>" : "") +
      "</section>" +

      '<section class="card bot-live" id="livePanel">' +
        '<div class="eyebrow">' + icon('<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>') + " Live</div>" +
        '<div class="grid g3" id="statGrid">' + statCards() + "</div>" +

        '<div class="eyebrow" style="margin-top:16px" id="recentTrades">' +
          icon('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>') + " Recent trades</div>" +
        '<div class="trades" id="tradeList">' + tradeRows() + "</div>" +
      "</section>" +
    "</div>" + steps();
  }

  function statCards() {
    var s = S.stats;
    var pl = s ? Number(s.totalProfit) : 0;
    return '<div class="stat"><div class="k">Session P/L</div><div class="v ' + (pl >= 0 ? "ok" : "bad-t") + '">' +
        (s ? (pl >= 0 ? "+" : "") + money(pl) : "—") + "</div></div>" +
      '<div class="stat"><div class="k">Trades</div><div class="v">' + (s ? s.totalTrades : "—") + "</div></div>" +
      '<div class="stat"><div class="k">Win rate</div><div class="v hi">' + (s ? s.winRate + "%" : "—") + "</div></div>" +
      '<div class="stat"><div class="k">Current stake</div><div class="v">' + (s ? money(s.currentStake) : "—") + "</div></div>" +
      '<div class="stat"><div class="k">Market</div><div class="v" style="font-size:14px">' + (s ? esc(s.market) : "—") + "</div></div>" +
      '<div class="stat"><div class="k">Target digit</div><div class="v hi2">' + (s ? esc(String(s.digit)) : "—") + "</div></div>";
  }

  function tradeRows() {
    if (!S.history.length) return '<div class="trades-empty">Nothing yet. Press Start and the trades appear here.</div>';
    return S.history.map(function (t) {
      var d = new Date(t.timestamp);
      return '<div class="trade ' + (t.win ? "win" : "loss") + '">' +
        '<span class="trade-dot"></span>' +
        '<span class="trade-mkt">' + esc(t.market) + "</span>" +
        '<span class="trade-dig">digit ' + esc(String(t.digit)) + "</span>" +
        '<span class="trade-stake">$' + money(t.stake) + "</span>" +
        '<span class="trade-pl">' + (t.profit >= 0 ? "+" : "") + money(t.profit) + "</span>" +
        '<span class="trade-time">' + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + "</span>" +
      "</div>";
    }).join("");
  }

  /** Repaint only what moves, so typing in a field is never interrupted. */
  function paintLive() {
    var bal = document.getElementById("liveBal");
    if (bal) bal.textContent = "$" + money(S.balance);
    var grid = document.getElementById("statGrid");
    if (grid) grid.innerHTML = statCards();
    var list = document.getElementById("tradeList");
    if (list) list.innerHTML = tradeRows();
  }

  function celebrate() {
    toast("Take profit reached — that is your ending. Stop recording.");
  }

  /* ── the three steps ───────────────────────────────────────────────────── */

  function steps() {
    return '<div class="steps">' +
      '<section class="card step-card">' +
        '<div class="step-n">1</div>' +
        "<h3>Record your screen</h3>" +
        "<p>Start the bot above and record it trading. <b>20 to 40 seconds is plenty</b> — enough to see a few trades " +
        "land and the bot stop itself at the target.</p>" +
        '<ul class="tips">' +
          "<li><b>On a phone:</b> swipe down for the control centre and tap Screen Record. On iPhone, add it in Settings → Control Centre first.</li>" +
          "<li><b>On a computer:</b> Windows — press <b>Win + Alt + R</b>. Mac — press <b>Shift + Cmd + 5</b>.</li>" +
          "<li>Record in <b>portrait</b> if you can. Sideways video gets less reach on every platform.</li>" +
        "</ul>" +
      "</section>" +

      '<section class="card step-card">' +
        '<div class="step-n">2</div>' +
        "<h3>Talk over it</h3>" +
        "<p>A silent screen recording is not a video. Say what people are looking at and say the name. " +
        "<b>Your own voice or a realistic AI voice — both are fine.</b></p>" +
        '<div class="voice-box">' +
          '<div class="voice-head">' +
            icon('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>', 16) +
            "<span>Hear an AI voice-over</span>" +
            '<button class="btn sm" data-act="voice">' + icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 14) + " Download</button>" +
          "</div>" +
          '<audio controls preload="none" src="' + VOICE_SRC + '" style="width:100%;margin-top:9px"></audio>' +
          '<p style="margin:8px 0 0;font-size:11.5px;color:var(--faint)">This one was made with a free AI voice tool. Using one is allowed.</p>' +
        "</div>" +
        '<p style="margin-top:12px"><b>Openers that work:</b></p>' +
        '<ul class="tips">' + STARTERS.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" +
      "</section>" +

      '<section class="card step-card">' +
        '<div class="step-n">3</div>' +
        "<h3>Edit it</h3>" +
        "<p>Put the recording and the voice together in whatever you already use — <b>CapCut</b> is free and does all " +
        "of this on a phone. VN and InShot work too.</p>" +
        '<ul class="tips">' +
          "<li>Add <b>captions</b>. Most people watch with the sound off, and CapCut writes them for you.</li>" +
          "<li>Cut the first second. Start on the trade, not on you lining up the shot.</li>" +
          "<li>Say <b>Magic Bots Lab</b> out loud, and say the bots are <b>100% free</b>. That is a rule, not a tip.</li>" +
          "<li>Export at 1080p and post the same video to all three of your accounts.</li>" +
        "</ul>" +
      "</section>" +
    "</div>";
  }

  /* ── the record prompt ─────────────────────────────────────────────────── */

  function recordPromptDue() {
    try {
      var until = parseInt(localStorage.getItem(RECORD_KEY) || "0", 10);
      return !(until && Date.now() < until);
    } catch (e) { return true; }
  }

  function snoozeRecordPrompt() {
    try { localStorage.setItem(RECORD_KEY, String(Date.now() + 30 * 24 * 3600 * 1000)); } catch (e) {}
  }

  function askToRecord(next) {
    if (!recordPromptDue()) { next(); return; }

    var el = document.createElement("div");
    el.className = "inv-overlay";
    el.innerHTML =
      '<div class="inv-panel" style="max-width:420px">' +
        "<h3 style=\"margin:0 0 8px\">Start recording first</h3>" +
        "<p style=\"margin:0 0 12px;font-size:13px;line-height:1.6;color:var(--muted)\">" +
        "The bot is about to start trading. Begin your screen recording <b>now</b>, so you catch it from the first trade " +
        "rather than joining halfway through.</p>" +
        '<label class="check" style="margin-bottom:14px"><input type="checkbox" id="dontAsk" /><span>Do not show this again</span></label>' +
        '<button class="btn wide" id="recGo">I am recording — open the bot</button>' +
        '<button class="btn ghost wide" id="recSkip" style="margin-top:8px">Open it without recording</button>' +
      "</div>";
    document.body.appendChild(el);

    var finish = function () {
      if (el.querySelector("#dontAsk").checked) snoozeRecordPrompt();
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
        S.guideMsg = "Take profit set to " + money(n) + " USD. Stop loss and martingale are handled — press Start.";
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

    S.history = [];
    S.status = null;
    S.guideMsg = null;

    bot.start({
      initialStake: stake,
      minStake: 0.35,
      takeProfit: tp,
      // Zero switches the stop loss off in the engine, so a practice run ends
      // on the take profit however big a stake somebody types in.
      stopLoss: 0,
      martingaleMultiplier: 3.1
    });

    // On a phone the trades are far below the fold, so go to them.
    setTimeout(function () {
      if (window.innerWidth < 900) {
        var t = document.getElementById("recentTrades");
        if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 700);
  }

  /* ── render ────────────────────────────────────────────────────────────── */

  function render() {
    document.getElementById("view").innerHTML = S.stage === "bot" ? viewBot() : viewGate();
    document.getElementById("topTitle").textContent = S.stage === "bot" ? "Practice bot" : "Create a post";
    document.getElementById("topSub").textContent = S.stage === "bot"
      ? "Set it up, record it, then steps 2 and 3 are below"
      : "Three steps: record, talk over it, edit";
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

    if (act === "carry") {
      S.amount = String(S.balance);
      render();
      return;
    }

    if (act === "open") {
      var n = parseFloat(String(S.amount).replace(/,/g, ""));
      if (!isFinite(n) || n < MIN_BALANCE) { toast("Start with at least $" + money(MIN_BALANCE) + ".", true); return; }
      if (n > MAX_TYPED) { toast("The most you can type in is $" + money(MAX_TYPED) + ".", true); return; }

      askToRecord(function () {
        setBalance(n);
        S.balance = n;
        S.stage = "bot";
        S.step = 0;
        S.stake = String(suggestedStake(n));
        S.tp = "";
        render();
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
    if (el.id === "stakeIn") { onType("stake", el.value); return; }
    if (el.id === "tpIn") { onType("tp", el.value); }
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
