/**
 * GENERAL MT5 — the page behaviour.
 *
 * Three things happen here and nothing else:
 *
 *   1. The risk profile picker, remembered in this browser, which also decides
 *      which signal set is shown.
 *   2. The live signals, fetched through /api/mt5/signals — the same feed the
 *      EA itself reads — and refreshed every minute.
 *   3. The access modal: four steps, ending in a download that only a code
 *      issued to THIS browser can unlock. The request goes through the support
 *      pipe, the answer arrives in the support bubble, and the bubble is opened
 *      the moment the request is sent so the person can see it happened.
 *
 * The visitor id is the same one the support bubble minted — that is what
 * binds the code to this browser, and why the bubble script must load first.
 */
(function () {
  "use strict";

  var PROFILE_KEY = "mbl_mt5_profile";
  var NAME_KEY = "mbl_support_name";
  var MAIL_KEY = "mbl_support_email";
  var ID_KEY = "mbl_support_id";
  var REFRESH_MS = 60000;
  var CATEGORIES = "forex,volatility";

  var get = function (k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
  var set = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  var isEmail = function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim()); };

  /* The same visitor id the support bubble uses. It normally exists already —
     the bubble script runs first — but if storage was cleared between the two
     loads, minting the same shape here keeps them in step. */
  function visitorId() {
    if (window.MBL_SUPPORT_ID) return window.MBL_SUPPORT_ID;
    var id = get(ID_KEY);
    if (/^[0-9A-F]{8}$/.test(id)) return id;
    var b = new Uint8Array(4);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 4; i++) b[i] = Math.random() * 256;
    id = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("").toUpperCase();
    set(ID_KEY, id);
    return id;
  }

  /* ── 1. risk profiles ───────────────────────────────────────────────── */

  var PROFILES = [
    { key: "conservative", label: "Conservative", risk: 0.4,
      blurb: "Fewer, high-conviction trades. No adding to positions. Tight risk, wide stops.",
      icon: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>' },
    { key: "moderate", label: "Moderate", risk: 0.75,
      blurb: "Balanced. Trades the clean trends and ranges, scales in up to twice on strength.",
      icon: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>' },
    { key: "aggressive", label: "Aggressive", risk: 1.5,
      blurb: "Presses winners hard — pyramids into strong trends, trades more setups, bigger runners.",
      icon: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>' },
  ];
  var profile = get(PROFILE_KEY);
  if (!PROFILES.some(function (p) { return p.key === profile; })) profile = "aggressive";

  function paintProfiles() {
    $("profiles").innerHTML = PROFILES.map(function (p) {
      var on = p.key === profile;
      return '<button type="button" class="profile' + (on ? " on" : "") + '" data-key="' + p.key + '">' +
        '<div class="profile-head">' +
          '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p.icon + "</svg>" +
          '<span class="profile-name">' + p.label + "</span>" +
          '<svg class="tick" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>' +
        "</div>" +
        "<p>" + p.blurb + "</p>" +
        '<div class="risk">Risk per trade ' + p.risk + "%</div>" +
      "</button>";
    }).join("");
    Array.prototype.forEach.call($("profiles").querySelectorAll(".profile"), function (b) {
      b.onclick = function () {
        profile = b.getAttribute("data-key");
        set(PROFILE_KEY, profile);
        paintProfiles();
        load();
      };
    });
  }

  /* ── 2. live signals ────────────────────────────────────────────────── */

  var loading = false;
  var data = null;

  function level(k, v, digits, cls) {
    return '<div class="level ' + cls + '"><div class="k">' + k + '</div><div class="v">' + Number(v).toFixed(digits) + "</div></div>";
  }

  function signalCard(s) {
    var buy = s.side === "buy";
    var dir = buy
      ? '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'
      : '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>';
    var color = buy ? "var(--accent)" : "var(--loss)";
    return '<div class="signal">' +
      '<div class="signal-head">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>' +
        '<span class="signal-name">' + esc(s.name) + "</span>" +
        '<span class="side ' + (buy ? "buy" : "sell") + '"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + dir + "</svg> " + esc(s.side) + "</span>" +
      "</div>" +
      '<div class="reason">' + esc(s.reason) + "</div>" +
      '<div class="levels">' +
        level("Entry", s.entry, s.digits, "entry") + level("Stop", s.stopLoss, s.digits, "stop") + level("Target", s.takeProfit, s.digits, "target") +
      "</div>" +
      '<div class="signal-foot">' +
        "<span>Risk " + esc(s.riskPct) + "% · " + esc(String(s.regime || "").replace("_", " ")) + "</span>" +
        '<span class="conf"><span class="bar"><i style="width:' + Math.max(0, Math.min(100, Number(s.confidence) || 0)) + "%;background:" + color + '"></i></span>' + esc(s.confidence) + "%</span>" +
      "</div>" +
    "</div>";
  }

  function paintSignals() {
    var box = $("signals");
    var meta = $("signalsMeta");
    var aside = $("aside");

    if (loading && !data) {
      box.innerHTML = '<div class="panel-empty"><span class="spinning"><svg class="spin" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Scanning forex + Volatility…</span></div>';
      meta.textContent = "";
      aside.hidden = true;
      return;
    }
    if (!data) { box.innerHTML = ""; return; }

    meta.textContent = data.signals.length + " active · " + data.meta.withData + "/" + data.meta.evaluated + " markets scanned · highest-confidence first";

    if (data.signals.length) {
      box.className = "signals";
      box.innerHTML = data.signals.map(signalCard).join("");
    } else {
      box.className = "";
      box.innerHTML = '<div class="panel-empty">No entries right now — the engine only fires on a clean setup. It re-scans continuously and refreshes here every minute.</div>';
    }

    if (data.standAside && data.standAside.length) {
      aside.hidden = false;
      $("asideSummary").textContent = "Standing aside on " + data.standAside.length + " markets";
      $("asideList").innerHTML = data.standAside.map(function (a) {
        return '<div class="aside-row"><b>' + esc(a.name) + "</b><span>" + esc(a.reason) + "</span></div>";
      }).join("");
    } else {
      aside.hidden = true;
    }
  }

  function setLoading(on) {
    loading = on;
    $("refresh").disabled = on;
    $("refreshIcon").classList.toggle("spin", on);
  }

  function load() {
    setLoading(true);
    $("pageErr").hidden = true;
    paintSignals();
    fetch("/api/mt5/signals?profile=" + profile + "&categories=" + CATEGORIES, { cache: "no-store" })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok || x.j.error) throw new Error(x.j.error || "Couldn't load signals.");
        data = x.j;
        var u = $("updated");
        u.textContent = "updated " + new Date().toLocaleTimeString() + " · auto every 60s";
        u.hidden = false;
      })
      .catch(function (e) {
        $("pageErr").textContent = (e && e.message) || "Couldn't load signals.";
        $("pageErr").hidden = false;
      })
      .then(function () { setLoading(false); paintSignals(); });
  }

  /* ── 3. the access modal ────────────────────────────────────────────── */

  var root = $("modalRoot");
  var phase = "form"; // form | sent | done
  var busy = false;

  function showErr(msg) {
    var e = $("modalErr");
    e.textContent = msg || "";
    e.hidden = !msg;
  }

  function formOk() {
    return $("clientId").value.trim().length > 0
      && $("name").value.trim().length > 1
      && isEmail($("email").value);
  }

  function paintModal() {
    var sent = phase === "sent";
    $("modalForm").hidden = phase === "done";
    $("modalDone").hidden = phase !== "done";
    $("sentNote").hidden = !sent;
    ["clientId", "name", "email"].forEach(function (id) { $(id).disabled = sent; });
    Array.prototype.forEach.call(root.querySelectorAll(".step"), function (s) {
      var n = s.getAttribute("data-step");
      s.classList.toggle("done", sent && n !== "4");
      var badge = s.querySelector(".step-n");
      badge.innerHTML = (sent && n !== "4")
        ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
        : n;
    });
    $("send").hidden = phase !== "form";
    $("send").disabled = !formOk() || busy;
    $("redeem").disabled = !$("code").value.trim() || busy;
  }

  function openModal() {
    // Details this browser already knows, so most people only ever type the ID.
    if (!$("name").value) $("name").value = get(NAME_KEY);
    if (!$("email").value) $("email").value = get(MAIL_KEY);
    root.hidden = false;
    paintModal();
    setTimeout(function () { $("clientId").focus(); }, 60);
  }
  function closeModal() { root.hidden = true; }

  function send() {
    if (busy || !formOk()) return;
    busy = true; showErr(null); paintModal();
    var clientId = $("clientId").value.trim();
    var name = $("name").value.trim();
    var email = $("email").value.trim();

    fetch("/api/mt5/ea-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId: visitorId(), mt5Login: clientId, name: name, email: email, page: location.pathname }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error(x.j.error || "Could not send that. Try again in a moment.");
        set(NAME_KEY, name); set(MAIL_KEY, email);
        phase = "sent";

        /* The bubble opens onto THIS conversation — the request already in it
           and the details filled — rather than onto an empty window that gives
           no sign anything happened. The answer arrives in that same thread. */
        if (window.MBL_SUPPORT_ASK) {
          window.MBL_SUPPORT_ASK({
            name: name, email: email,
            text: x.j.already
              ? "Asked for the General MT5 EA again — client / MT5 ID " + clientId + "."
              : "Requested the General MT5 EA — client / MT5 ID " + clientId + ".",
          });
        }
      })
      .catch(function (e) { showErr((e && e.message) || "Could not send that."); })
      .then(function () { busy = false; paintModal(); });
  }

  function redeem() {
    var code = $("code").value.trim();
    if (busy || !code) return;
    busy = true; showErr(null); paintModal();

    fetch("/api/mt5/ea-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, visitorId: visitorId() }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || "That code was not accepted."); });
        return r.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = "MagicBotsLabMT5.mq5";
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        phase = "done";
      })
      .catch(function (e) { showErr((e && e.message) || "That code was not accepted."); })
      .then(function () { busy = false; paintModal(); });
  }

  /* ── wire up ────────────────────────────────────────────────────────── */

  $("openEa").onclick = openModal;
  $("modalClose").onclick = closeModal;
  $("doneClose").onclick = closeModal;
  root.addEventListener("mousedown", function (e) { if (e.target === root) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !root.hidden) closeModal(); });
  ["clientId", "name", "email", "code"].forEach(function (id) { $(id).addEventListener("input", paintModal); });
  $("send").onclick = send;
  $("redeem").onclick = redeem;
  $("code").addEventListener("keydown", function (e) { if (e.key === "Enter") redeem(); });
  $("refresh").onclick = load;

  paintProfiles();
  load();
  setInterval(load, REFRESH_MS);

  // /mt5/generalmt5#get opens straight onto the request, for links that
  // promise the download rather than the page.
  if (location.hash === "#get") openModal();
})();
