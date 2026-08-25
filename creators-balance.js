/**
 * MAGIC BOTS LAB — the trading balance, in the Creator Program sidebar.
 *
 * Posting is not the only way to earn here. A creator who has already
 * connected Deriv has an account sitting idle while they make videos, and the
 * bots are free — so the sidebar shows what is in it and offers one tap to go
 * and put it to work.
 *
 * The balance is read the same way the trading dashboard reads it: authorize
 * over Deriv's WebSocket with the token this browser already holds, take the
 * figure, close the socket. Nothing is stored and nothing new is asked for. If
 * there is no token, or Deriv does not answer, the card says so plainly rather
 * than showing a zero that might be mistaken for a real balance.
 */

(function () {
  "use strict";

  var TOKEN_KEY = "deriv_access_token";
  var APP_ID = "338udJBKn1EbT7Tc29Snv";
  var WS = "wss://ws.derivws.com/websockets/v3?app_id=" + encodeURIComponent(APP_ID);

  /** Deriv is usually quick; past this it is not worth a creator's attention. */
  var TIMEOUT_MS = 9000;

  var host = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function money(n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  /* ── the card ──────────────────────────────────────────────────────────── */

  function draw(state) {
    if (!host) return;

    var chart = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>';

    var arrow = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>';

    if (state.kind === "loading") {
      host.innerHTML =
        '<div class="bal-card is-loading">' +
          '<div class="bal-card-k">' + chart + " Your trading balance</div>" +
          '<div class="bal-card-v">Checking…</div>' +
        "</div>";
      return;
    }

    if (state.kind === "balance") {
      host.innerHTML =
        '<div class="bal-card">' +
          '<div class="bal-card-k">' + chart + " Your trading balance</div>" +
          '<div class="bal-card-v">' + esc(state.currency) + " " + money(state.balance) + "</div>" +
          '<p class="bal-card-s">The bots are free. Set one running on it while you post.</p>' +
          '<a class="bal-card-go" href="trading-dashboard.html">Go trade ' + arrow + "</a>" +
        "</div>";
      return;
    }

    // No token, or Deriv did not answer. Either way there is nothing to show,
    // so the card asks for the one thing that would change that.
    host.innerHTML =
      '<div class="bal-card is-empty">' +
        '<div class="bal-card-k">' + chart + " Earn while you post</div>" +
        '<p class="bal-card-s">' +
          (state.kind === "unreachable"
            ? "Could not reach your account just now."
            : "Connect your Deriv account and run a free bot on it alongside the videos.") +
        "</p>" +
        '<a class="bal-card-go ghost" href="index.html">' +
          (state.kind === "unreachable" ? "Open the dashboard " : "Connect an account ") + arrow +
        "</a>" +
      "</div>";
  }

  /* ── reading it ────────────────────────────────────────────────────────── */

  function load() {
    var t = token();
    if (!t) { draw({ kind: "none" }); return; }

    draw({ kind: "loading" });

    var ws;
    var done = false;

    var finish = function (state) {
      if (done) return;
      done = true;
      try { if (ws) ws.close(); } catch (e) {}
      draw(state);
    };

    var timer = setTimeout(function () { finish({ kind: "unreachable" }); }, TIMEOUT_MS);

    try {
      ws = new WebSocket(WS);
    } catch (e) {
      clearTimeout(timer);
      finish({ kind: "unreachable" });
      return;
    }

    ws.onopen = function () {
      ws.send(JSON.stringify({ authorize: t, req_id: 1 }));
    };

    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }

      if (msg.error) { clearTimeout(timer); finish({ kind: "unreachable" }); return; }

      if (msg.msg_type === "authorize" && msg.authorize) {
        clearTimeout(timer);

        var a = msg.authorize;
        var list = Array.isArray(a.account_list) ? a.account_list : [];

        // The account they actually trade on: real before demo, and the
        // largest of those, which is the one worth pointing at.
        var real = list.filter(function (x) { return !x.is_virtual && typeof x.balance === "number"; });
        var pick = real.sort(function (x, y) { return y.balance - x.balance; })[0];

        var balance = pick ? pick.balance : a.balance;
        var currency = (pick ? pick.currency : a.currency) || "USD";

        if (typeof balance !== "number") { finish({ kind: "unreachable" }); return; }
        finish({ kind: "balance", balance: balance, currency: currency });
      }
    };

    ws.onerror = function () { clearTimeout(timer); finish({ kind: "unreachable" }); };
    ws.onclose = function () { if (!done) { clearTimeout(timer); finish({ kind: "unreachable" }); } };
  }

  /** The dashboard calls this once the rail exists. */
  window.MBL_BALANCE_MOUNT = function (el) {
    host = el;
    load();
  };
})();
