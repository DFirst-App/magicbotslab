/**
 * MAGIC BOTS LAB — the trading balance, in the Creator Program rail.
 *
 * Posting is not the only way to earn here. A creator who has connected Deriv
 * has an account sitting idle while they make videos, and every bot is free —
 * so the rail shows what is in it and offers one tap to go and use it.
 *
 * The balance is read the way the trading dashboard reads it, including the
 * part that matters: **the stored access token expires**. The dashboard
 * refreshes it before use, and the first version of this file did not, which
 * is why a connected creator was told their account could not be reached. The
 * refresh happens here too now, against the same session object.
 *
 * There is no error state. If a balance cannot be shown the card simply
 * invites them to trade — being told something failed helps nobody, and the
 * button goes to the same place either way.
 */

(function () {
  "use strict";

  var TOKEN_KEY = "deriv_access_token";
  var SESSION_KEY = "deriv_oauth_session";
  var APP_ID = "338udJBKn1EbT7Tc29Snv";
  var TOKEN_URL = "https://auth.deriv.com/oauth2/token";
  var WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=" + encodeURIComponent(APP_ID);

  /** Deriv is usually quick; past this it is not worth a creator's attention. */
  var TIMEOUT_MS = 9000;

  var TRADE_HREF = "trading-dashboard.html";

  var host = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function money(n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function readSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveSession(session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      localStorage.setItem(TOKEN_KEY, session.access_token);
    } catch (e) {}
  }

  /**
   * A token Deriv will actually accept.
   *
   * The stored one has an expiry. Past it, Deriv rejects the authorize and the
   * balance never arrives — so if there is a refresh token, spend it first.
   * Mirrors getValidAccessToken() in dashboard.html.
   */
  function validToken() {
    var session = readSession();
    var stored = "";
    try { stored = localStorage.getItem(TOKEN_KEY) || ""; } catch (e) {}

    if (session && session.access_token && session.expires_at && Date.now() < session.expires_at - 60000) {
      return Promise.resolve(session.access_token);
    }
    if (!session || !session.refresh_token) return Promise.resolve(stored);

    return fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: APP_ID,
        refresh_token: session.refresh_token
      })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.access_token) return stored;
        saveSession({
          access_token: d.access_token,
          refresh_token: d.refresh_token || session.refresh_token,
          expires_at: Date.now() + ((d.expires_in || 3600) * 1000)
        });
        return d.access_token;
      })
      .catch(function () { return stored; });
  }

  /* ── the card ──────────────────────────────────────────────────────────── */

  var ICON_CHART =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>';

  var ICON_GO =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>';

  function draw(state) {
    if (!host) return;

    if (state.kind === "loading") {
      host.innerHTML =
        '<div class="bal-card is-loading">' +
          '<div class="bal-card-k">' + ICON_CHART + " Your trading balance</div>" +
          '<div class="bal-card-v">Checking…</div>' +
        "</div>";
      return;
    }

    if (state.kind === "balance") {
      host.innerHTML =
        '<div class="bal-card">' +
          '<div class="bal-card-k">' + ICON_CHART + " Your trading balance</div>" +
          '<div class="bal-card-v">' + esc(state.currency) + " " + money(state.balance) + "</div>" +
          '<p class="bal-card-s">Every bot is free. Set one running on it while you post.</p>' +
          '<a class="bal-card-go" href="' + TRADE_HREF + '">Start trading ' + ICON_GO + "</a>" +
        "</div>";
      return;
    }

    // No balance to show. Say nothing about why — the invitation is the same.
    host.innerHTML =
      '<div class="bal-card is-plain">' +
        '<div class="bal-card-k">' + ICON_CHART + " Trade while you post</div>" +
        '<p class="bal-card-s">Every bot is free. Pick one and let it run on your own account.</p>' +
        '<a class="bal-card-go" href="' + TRADE_HREF + '">Start trading ' + ICON_GO + "</a>" +
      "</div>";
  }

  /* ── reading it ────────────────────────────────────────────────────────── */

  function fetchBalance(token) {
    return new Promise(function (resolve) {
      var ws;
      var done = false;

      var finish = function (state) {
        if (done) return;
        done = true;
        try { if (ws) ws.close(); } catch (e) {}
        resolve(state);
      };

      var timer = setTimeout(function () { finish({ kind: "plain" }); }, TIMEOUT_MS);

      try { ws = new WebSocket(WS_URL); }
      catch (e) { clearTimeout(timer); finish({ kind: "plain" }); return; }

      ws.onopen = function () { ws.send(JSON.stringify({ authorize: token, req_id: 1 })); };

      ws.onmessage = function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.error) { clearTimeout(timer); finish({ kind: "plain" }); return; }

        if (msg.msg_type === "authorize" && msg.authorize) {
          clearTimeout(timer);

          var a = msg.authorize;
          var list = Array.isArray(a.account_list) ? a.account_list : [];

          // The account they actually trade on: real before demo, and the
          // largest of those — a 10,000 demo beside a real 0.68 would point
          // at money that is not theirs.
          var real = list.filter(function (x) { return !x.is_virtual && typeof x.balance === "number"; });
          var pick = real.sort(function (x, y) { return y.balance - x.balance; })[0];

          var balance = pick ? pick.balance : a.balance;
          var currency = (pick ? pick.currency : a.currency) || "USD";

          if (typeof balance !== "number") { finish({ kind: "plain" }); return; }
          finish({ kind: "balance", balance: balance, currency: currency });
        }
      };

      ws.onerror = function () { clearTimeout(timer); finish({ kind: "plain" }); };
      ws.onclose = function () { if (!done) { clearTimeout(timer); finish({ kind: "plain" }); } };
    });
  }

  function load() {
    var hasSomething = false;
    try {
      hasSomething = !!(localStorage.getItem(TOKEN_KEY) || localStorage.getItem(SESSION_KEY));
    } catch (e) {}

    if (!hasSomething) { draw({ kind: "plain" }); return; }

    draw({ kind: "loading" });

    validToken()
      .then(function (t) { return t ? fetchBalance(t) : { kind: "plain" }; })
      .then(draw)
      .catch(function () { draw({ kind: "plain" }); });
  }

  /** The dashboard calls this once the rail exists. */
  window.MBL_BALANCE_MOUNT = function (el) {
    host = el;
    load();
  };
})();
