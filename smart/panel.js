/**
 * MAGIC BOTS LAB — the dashboard's bot panel, in the bots page's own design.
 *
 * smart/bot.js trades and paints its own counters (profit, trades, current
 * stake, losses in a row, the live scan, the popups); this file draws the rest
 * of the panel the way trading-dashboard.html does, from the run bot.js keeps:
 *
 *   - Start Bot and Stop Bot, two buttons, the glow on whichever can be
 *     pressed (bot.js has one button that does both; it is kept out of sight
 *     and these press it);
 *   - Live Performance: the account balance, the win rate, the market and
 *     side being traded, and the running time;
 *   - Target and Last contract, as on the bots page;
 *   - Recent Trades: every trade of the run as the bots page's history items,
 *     the newest sliding in at the top with its win or loss glow.
 *
 * It only reads: nothing here can start, buy or stop anything bot.js did not
 * ask for.
 */

(function (global) {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var T = function (s) { return typeof global.t === "function" ? global.t(s) : s; };
  var B = function () { return global.MBLBot && global.MBLBot.run ? global.MBLBot.run() : null; };
  var D = global.MBLDeriv;
  if (!$("scan") || !$("botGo")) return;

  function round2(v) { return Math.round(v * 100) / 100; }
  function usd(v, cur) {
    var n = Number(v) || 0, sign = n < 0 ? "-" : "";
    return sign + (cur && cur !== "USD" ? "" : "$") + Math.abs(n).toFixed(2) + (cur && cur !== "USD" ? " " + cur : "");
  }

  /* ── Start Bot / Stop Bot ──────────────────────────────────────────── */

  var go = $("botGo"), start = $("botStart"), stop = $("botStop");
  start.addEventListener("click", function () {
    var r = B();
    if (r && r.active) return;
    if (!go.disabled) go.click();
  });
  stop.addEventListener("click", function () {
    var r = B();
    if (r && r.active && !r.stopping && !go.disabled) go.click();
  });
  function paintButtons() {
    var r = B(), running = !!(r && r.active), stopping = !!(running && r.stopping);
    start.disabled = running || (go.disabled && !running);
    stop.disabled = !running || stopping;
    stop.classList.toggle("is-stopping", stopping);
    // The glow sits on whichever button can be pressed, as on the bots page.
    start.classList.toggle("btn-liquid-glow", !running);
    stop.classList.toggle("btn-liquid-glow", running && !stopping);
  }

  /* ── Live Performance, Target, Last contract ──────────────────────── */

  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    s = s % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  function paintStats() {
    var r = B(), acc = null;
    if (D) acc = r && r.active ? D.accountOf(r.account) : D.current();
    $("pBalance").textContent = acc && acc.balance != null
      ? Number(acc.balance).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + (acc.currency || "USD")
      : "-";
    var n = r ? r.n : 0, won = r ? r.won : 0;
    $("pRate").textContent = (n ? Math.round(won / n * 100) : 0) + "%";

    var now = !$("botNow").hidden && $("nowMarket").textContent ? $("nowMarket").textContent + " / " + $("nowSide").textContent : "";
    var last = r && r.log && r.log[0];
    $("pMarket").textContent = now || (last ? last.market + " / " + last.label : "-");
    $("botTarget").textContent = now ? $("nowMarket").textContent + " · " + $("nowSide").textContent : "--";
    $("botLast").textContent = last ? (last.won ? T("WIN") : T("LOSS")) + " | " + last.market + " | " + last.label : "--";

    var end = r ? (r.active ? Date.now() : (r.ended && r.ended.at ? r.ended.at * 1000 : Date.now())) : 0;
    $("pTime").textContent = r && r.startedAt ? clock(end - r.startedAt * 1000) : "00:00:00";
    $("botPl").classList.toggle("positive", !!(r && r.pl > 0));
    $("botPl").classList.toggle("negative", !!(r && r.pl < 0));
  }

  /* ── Recent Trades ─────────────────────────────────────────────────── */

  /* The run's log is newest first. What is on screen is kept as the keys of
     the rows it shows; new rows are the ones above that, and a list that no
     longer matches (a new run, a resumed one) is drawn again, still. */
  var items = $("historyItems"), shown = [], drawnFor = null;
  function key(x) { return x.id ? String(x.id) : x.at + ":" + x.stake + ":" + x.pl; }
  function build(x, cur, animate) {
    var el = document.createElement("div");
    el.className = "history-item " + (x.won ? "win" : "loss") + (animate ? " history-item--enter" : "");
    var meta = document.createElement("div");
    meta.className = "history-meta";
    var title = document.createElement("strong");
    title.textContent = x.market + " · " + x.label;
    var time = document.createElement("span");
    time.textContent = new Date(x.at || Date.now()).toLocaleTimeString();
    var stake = document.createElement("span");
    stake.textContent = T("Stake") + ": " + usd(x.stake, cur);
    meta.appendChild(title); meta.appendChild(time); meta.appendChild(stake);
    var p = document.createElement("div");
    p.className = "history-profit " + (x.won ? "win" : "loss");
    p.textContent = (x.pl > 0 ? "+" : "") + usd(x.pl, cur);
    el.appendChild(meta); el.appendChild(p);
    el._row = x; el._won = x.won; el._pl = x.pl;
    return el;
  }
  function syncTrades() {
    var r = B(), cur = (r && r.currency) || "USD";
    // Newest first by the time each trade settled: one booked late (a line that dropped) takes its own place.
    var log = ((r && r.log) || []).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    var keys = log.map(key), fresh = keys.length - shown.length;
    var same = fresh >= 0 && drawnFor === r && keys.slice(fresh).join("|") === shown.join("|");
    if (!same) {
      items.textContent = "";
      log.forEach(function (x) { items.appendChild(build(x, cur, false)); });
    } else if (fresh > 0) {
      // One or two new trades slide in; a burst (a reload catching up) just appears.
      var animate = fresh <= 2;
      for (var i = fresh - 1; i >= 0; i--) items.insertBefore(build(log[i], cur, animate), items.firstChild);
    }
    // A trade Deriv booked differently from its exit tick: put its row right.
    Array.prototype.forEach.call(items.children, function (el) {
      var x = el._row;
      if (!x || (x.won === el._won && x.pl === el._pl)) return;
      el.className = "history-item " + (x.won ? "win" : "loss");
      var p = el.querySelector(".history-profit");
      p.className = "history-profit " + (x.won ? "win" : "loss");
      p.textContent = (x.pl > 0 ? "+" : "") + usd(x.pl, cur);
      el._won = x.won; el._pl = x.pl;
    });
    shown = keys; drawnFor = r;
  }

  /* ── keeping up ────────────────────────────────────────────────────── */

  /* Changes come in bursts (a trade moves five counters at once): paint once
     for the lot. A timer, not an animation frame — frames stop while the tab
     is out of sight, and the panel must be right the moment it is back. */
  var queued = false;
  function paint() {
    if (queued) return;
    queued = true;
    setTimeout(function () {
      queued = false;
      try { paintButtons(); } catch (e) {}
      try { paintStats(); } catch (e) {}
      try { syncTrades(); } catch (e) {}
    }, 16);
  }
  // bot.js paints its own counters, rows and button on every change: follow them.
  if (global.MutationObserver) {
    var mo = new MutationObserver(paint);
    [go, $("botGoText"), $("botN"), $("botPl"), $("botNext"), $("botStreak"), $("botStateText"), $("botLog"), $("botNow"), $("nowMarket"), $("nowSide"), $("acctAmt")].forEach(function (el) {
      if (el) mo.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    });
  }
  global.addEventListener("mbl:account", paint);
  global.addEventListener("mbl:runend", paint);
  global.addEventListener("langchange", function () { drawnFor = null; paint(); });
  // The running time ticks; everything else is checked once a second too, in case.
  setInterval(function () { var r = B(); if (r && r.active) paint(); }, 1000);

  /* ── the bots page's own way in ───────────────────────────────────── */

  // First visit to the bots from here: the bots page opens with its guide, as before.
  var bots = $("startTradingBtn");
  if (bots) bots.addEventListener("click", function (e) {
    var g = global.MBLGuide;
    if (!g || g.isDone(g.KEYS.dashboardBots)) return;
    g.mark(g.KEYS.dashboardBots);
    e.preventDefault();
    global.location.href = "trading-dashboard.html?guide=1";
  });

  paint();
})(window);
