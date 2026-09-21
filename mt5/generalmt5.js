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
  /* The language layer's t() when it is on the page, English otherwise; and a
     {name} filler for the strings built with variables in them. */
  var T = function (s, vars) {
    var out = (typeof window !== "undefined" && typeof window.t === "function") ? window.t(s) : s;
    if (vars) for (var k in vars) out = out.split("{" + k + "}").join(String(vars[k]));
    return out;
  };


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
        '<div class="risk">' + T("Risk per trade {pct}%", { pct: p.risk }) + "</div>" +
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

    meta.textContent = T("{n} active · {a}/{b} markets scanned · highest-confidence first", { n: data.signals.length, a: data.meta.withData, b: data.meta.evaluated });

    if (data.signals.length) {
      box.className = "signals";
      box.innerHTML = data.signals.map(signalCard).join("");
    } else {
      box.className = "";
      box.innerHTML = '<div class="panel-empty">' + T("No entries right now — the engine only fires on a clean setup. It re-scans continuously and refreshes here every minute.") + '</div>';
    }

    if (data.standAside && data.standAside.length) {
      aside.hidden = false;
      $("asideSummary").textContent = T("Standing aside on {n} markets", { n: data.standAside.length });
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
        u.textContent = T("updated {time} · auto every 60s", { time: new Date().toLocaleTimeString() });
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

  /* ── how many more times they may send ──────────────────────────────────
     A mistake in the ID is fixed by editing and sending again, so nothing is
     locked after a send. A script hammering the form is another matter:
     three sends, then a wait for our answer — and any reply from us in the
     support thread, arriving after the last send, resets the count. The
     thread is what the bubble keeps in this browser, so no extra call. */
  var SENDS_KEY = "mbl_ea_sends";
  var THREAD_KEY = "mbl_support_thread";
  var MAX_SENDS = 3;
  function sends() {
    try { var v = JSON.parse(get(SENDS_KEY) || "null"); if (v && typeof v.n === "number") return v; } catch (e) {}
    return { n: 0, at: "" };
  }
  function repliedSince(iso) {
    if (!iso) return false;
    try {
      var thread = JSON.parse(get(THREAD_KEY) || "[]");
      return thread.some(function (l) { return l && l.from === "us" && !l.system && String(l.at || "") > iso; });
    } catch (e) { return false; }
  }
  function sendsLeft() {
    var v = sends();
    if (v.n > 0 && repliedSince(v.at)) { v = { n: 0, at: "" }; set(SENDS_KEY, JSON.stringify(v)); }
    return Math.max(0, MAX_SENDS - v.n);
  }
  function countSend() {
    var v = sends();
    set(SENDS_KEY, JSON.stringify({ n: v.n + 1, at: new Date().toISOString() }));
  }

  /* ── phone: country code + number, and the channel ───────────────────────
     The country is DETECTED, never demanded: the edge tells us where the
     request came from (/api/geo), the browser's locale is the fallback, and a
     choice made here is remembered and wins over both next time. The list is
     every country, searchable by name (in the visitor's language), by ISO code
     or by calling code. Nothing is forced — the person types the number they
     want to be reached on. */
  var CC_KEY = "mbl_cc", PHONE_KEY = "mbl_phone", CHAN_KEY = "mbl_contact";
  var COUNTRIES = window.DIAL_COUNTRIES || [];
  var cc = null;                                    // the chosen [iso, name, dial]
  var chan = get(CHAN_KEY) === "telegram" ? "telegram" : (get(CHAN_KEY) === "whatsapp" ? "whatsapp" : "");
  var namesOf = null;
  try { namesOf = new Intl.DisplayNames([document.documentElement.lang || "en"], { type: "region" }); } catch (e) { namesOf = null; }
  function countryName(c) {
    if (namesOf) { try { var n = namesOf.of(c[0]); if (n && n !== c[0]) return n; } catch (e) {} }
    return c[1];
  }
  // Windows has no flag glyphs, so the ISO code stands in for the flag there.
  var NO_FLAGS = /Win/.test(navigator.platform || "");
  function flagHtml(iso) {
    if (NO_FLAGS) return '<span class="cc-flag iso">' + iso + "</span>";
    var f = iso.replace(/./g, function (ch) { return String.fromCodePoint(127397 + ch.charCodeAt(0)); });
    return '<span class="cc-flag">' + f + "</span>";
  }
  function findCountry(iso) {
    iso = String(iso || "").toUpperCase();
    for (var i = 0; i < COUNTRIES.length; i++) if (COUNTRIES[i][0] === iso) return COUNTRIES[i];
    return null;
  }
  function setCountry(c, remember) {
    if (!c) return;
    cc = c;
    $("ccFlag").outerHTML = flagHtml(c[0]).replace('class="cc-flag', 'id="ccFlag" class="cc-flag');
    $("ccCode").textContent = "+" + c[2];
    $("ccBtn").setAttribute("aria-label", countryName(c) + " +" + c[2]);
    if (remember) set(CC_KEY, c[0]);
    paintModal();
  }
  function detectCountry() {
    var saved = findCountry(get(CC_KEY));
    if (saved) { setCountry(saved, false); return; }
    var loc = (navigator.language || "").split("-")[1];
    var fromLocale = loc && loc.length === 2 ? findCountry(loc) : null;
    if (fromLocale) setCountry(fromLocale, false);
    fetch("/api/geo", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var g = j && findCountry(j.country);
        // The edge knows where the request came from; the locale only guesses.
        if (g && !get(CC_KEY)) setCountry(g, false);
        else if (!cc && fromLocale) setCountry(fromLocale, false);
      })
      .catch(function () { if (!cc && fromLocale) setCountry(fromLocale, false); });
  }
  function renderList(q) {
    q = (q || "").trim().toLowerCase().replace(/^\+/, "");
    var list = $("ccList"), html = "", n = 0;
    var rows = COUNTRIES.map(function (c) { return { c: c, n: countryName(c) }; })
      .sort(function (a, b) { return a.n.localeCompare(b.n); });
    // Words that START with the query first (ni → Niger, Nigeria, Nicaragua);
    // anything merely containing it only when nothing starts with it.
    var starts = function (name) { return (" " + name.toLowerCase()).indexOf(" " + q) >= 0; };
    var hit = function (r) { return !q || starts(r.n) || starts(r.c[1]) || r.c[0].toLowerCase() === q || r.c[2].indexOf(q) === 0; };
    var loose = function (r) { return r.n.toLowerCase().indexOf(q) >= 0 || r.c[1].toLowerCase().indexOf(q) >= 0; };
    var shown = rows.filter(hit);
    if (q && !shown.length) shown = rows.filter(loose);
    for (var i = 0; i < shown.length; i++) {
      var c = shown[i].c, name = shown[i].n;
      n++;
      html += '<li><button type="button" class="cc-item' + (cc && cc[0] === c[0] ? " is-active" : "") + '" data-iso="' + c[0] + '" role="option">'
        + flagHtml(c[0]) + '<span class="cc-name">' + name.replace(/</g, "&lt;") + '</span><span class="cc-dial">+' + c[2] + "</span></button></li>";
    }
    list.innerHTML = n ? html : '<li class="cc-empty">' + T("No country matches that.") + "</li>";
  }
  function openCc() {
    $("ccPop").hidden = false; $("ccBtn").setAttribute("aria-expanded", "true");
    $("ccSearch").value = ""; renderList("");
    setTimeout(function () { $("ccSearch").focus(); var a = $("ccList").querySelector(".is-active"); if (a) a.scrollIntoView({ block: "center" }); }, 20);
  }
  function closeCc() { $("ccPop").hidden = true; $("ccBtn").setAttribute("aria-expanded", "false"); }
  $("ccBtn").onclick = function () { if ($("ccPop").hidden) openCc(); else closeCc(); };
  $("ccSearch").addEventListener("input", function () { renderList($("ccSearch").value); });
  $("ccSearch").addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeCc(); $("phone").focus(); e.stopPropagation(); }
    if (e.key === "Enter") { var f = $("ccList").querySelector(".cc-item"); if (f) f.click(); }
  });
  $("ccList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-iso]"); if (!b) return;
    setCountry(findCountry(b.getAttribute("data-iso")), true); closeCc(); $("phone").focus();
  });
  document.addEventListener("mousedown", function (e) { if (!$("ccPop").hidden && !$("phoneWrap").contains(e.target)) closeCc(); });
  // A number pasted with its own +code decides the country itself.
  $("phone").addEventListener("input", function () {
    var v = $("phone").value.replace(/[^\d+]/g, "");
    if (v.charAt(0) === "+") {
      var best = null;
      for (var i = 0; i < COUNTRIES.length; i++) {
        var d = COUNTRIES[i][2];
        if (v.slice(1, 1 + d.length) === d && (!best || d.length > best[2].length) && (d !== "1" || !best)) best = COUNTRIES[i];
      }
      if (best && best[2] !== "1") { setCountry(best, true); $("phone").value = v.slice(1 + best[2].length); }
    }
  });
  /* The number in E.164: the country's code, then the digits typed, minus a
     leading trunk zero — "0712…" in Kenya is "+254712…". */
  function phoneE164() {
    if (!cc) return "";
    var digits = $("phone").value.replace(/\D/g, "");
    if (digits.charAt(0) === "0" && cc[2] !== "1") digits = digits.replace(/^0+/, "");
    if (digits.length < 6 || digits.length + cc[2].length > 15) return "";
    return "+" + cc[2] + digits;
  }
  function paintChan() {
    Array.prototype.forEach.call(document.querySelectorAll(".chan-b"), function (b) {
      b.setAttribute("aria-checked", b.getAttribute("data-chan") === chan ? "true" : "false");
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll(".chan-b"), function (b) {
    b.onclick = function () { chan = b.getAttribute("data-chan"); set(CHAN_KEY, chan); paintChan(); paintModal(); };
  });
  paintChan();
  detectCountry();

  function showErr(msg) {
    if (msg && typeof window.tm === "function") msg = window.tm(msg);
    var e = $("modalErr");
    e.textContent = msg || "";
    e.hidden = !msg;
  }

  // The name and email are what gets checked, so they are what unlocks the
  // button. A phone, if typed, has to be a phone; the channel is optional.
  function formOk() {
    return $("name").value.trim().length > 1
      && isEmail($("email").value)
      && ($("phone").value.replace(/\D/g, "") === "" || phoneE164() !== "");
  }

  function paintModal() {
    var sent = phase === "sent";
    $("modalForm").hidden = phase === "done";
    $("modalDone").hidden = phase !== "done";
    $("sentNote").hidden = !sent;
    // The fields stay live after a send: a wrong detail is fixed here, not by
    // reloading the page.
    Array.prototype.forEach.call(root.querySelectorAll(".step"), function (s) {
      var n = s.getAttribute("data-step");
      s.classList.toggle("done", sent && n !== "6");
      var badge = s.querySelector(".step-n");
      badge.innerHTML = (sent && n !== "6")
        ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
        : n;
    });
    var left = sendsLeft();
    $("send").hidden = false;
    $("send").disabled = !formOk() || busy || left === 0;
    $("sendLabel").textContent = sent ? T("Send again") : T("Send for checking");
    $("sendLimit").hidden = left > 0;
    $("redeem").disabled = !$("code").value.trim() || busy;
  }

  function openModal() {
    // Details this browser already knows, so a returning person only checks them.
    if (!$("name").value) $("name").value = get(NAME_KEY);
    if (!$("email").value) $("email").value = get(MAIL_KEY);
    if (!$("phone").value) $("phone").value = get(PHONE_KEY);
    root.hidden = false;
    paintModal();
    setTimeout(function () { $("name").focus(); }, 60);
  }
  function closeModal() { root.hidden = true; }

  function send() {
    if (busy || !formOk() || sendsLeft() === 0) return;
    busy = true; showErr(null); paintModal();
    var name = $("name").value.trim();
    var email = $("email").value.trim();
    var phone = phoneE164();

    fetch("/api/mt5/ea-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitorId: visitorId(), name: name, email: email, phone: phone, country: cc ? cc[0] : "", contact: chan,
        lang: document.documentElement.lang || "", page: location.pathname,
      }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error(x.j.error || "Could not send that. Try again in a moment.");
        set(NAME_KEY, name); set(MAIL_KEY, email); set(PHONE_KEY, $("phone").value.trim());
        countSend();
        phase = "sent";
        openWait();

        /* The bubble opens onto THIS conversation — the request already in it
           and the details filled — rather than onto an empty window that gives
           no sign anything happened. The answer arrives in that same thread. */
        if (window.MBL_SUPPORT_ASK) {
          window.MBL_SUPPORT_ASK({
            name: name, email: email,
            text: phone
              ? T(x.j.already ? "Asked for the General MT5 EA again — {email}, {phone} on {channel}." : "Requested the General MT5 EA — {email}, {phone} on {channel}.", { email: email, phone: phone, channel: chan === "telegram" ? "Telegram" : (chan === "whatsapp" ? "WhatsApp" : "—") })
              : T(x.j.already ? "Asked for the General MT5 EA again — {email}." : "Requested the General MT5 EA — {email}.", { email: email }),
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

  /* The wait card: opened by a successful send, and again from the note. */
  function openWait() { $("waitRoot").hidden = false; }
  function closeWait() { $("waitRoot").hidden = true; }
  $("waitOpen").onclick = openWait;
  $("waitClose").onclick = closeWait;
  $("waitDone").onclick = closeWait;
  $("waitRoot").addEventListener("mousedown", function (e) { if (e.target === $("waitRoot")) closeWait(); });
  $("doneClose").onclick = closeModal;
  root.addEventListener("mousedown", function (e) { if (e.target === root) closeModal(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!$("waitRoot").hidden) closeWait(); else if (!root.hidden) closeModal();
  });
  ["name", "email", "phone", "code"].forEach(function (id) { $(id).addEventListener("input", paintModal); });
  $("send").onclick = send;
  $("redeem").onclick = redeem;
  $("code").addEventListener("keydown", function (e) { if (e.key === "Enter") redeem(); });
  $("refresh").onclick = load;
  /* "I have downloaded the EA": one tap sends the words to support, with the
     whole thread and our record of whether this browser was ever approved.
     Then the button says Sent, in green, and stays that way until we answer:
     one tap is one message, and ten taps are not ten. The lock survives a
     reload — it keeps the ids of the replies it had already seen, and a reply
     it has not seen is what opens the button again. */
  var DL_LOCK = "mbl_ea_downloaded_lock";
  /* Our replies: the ones this page holds, plus whatever is stored — another
     tab of this browser may have been the one that received the answer. */
  function replyIds() {
    var ids = window.MBL_SUPPORT_REPLY_IDS ? window.MBL_SUPPORT_REPLY_IDS() : [];
    try {
      JSON.parse(get("mbl_support_thread") || "[]").forEach(function (l) {
        if (l && l.from === "us" && !l.system && l.id && ids.indexOf(l.id) < 0) ids.push(l.id);
      });
    } catch (e) {}
    return ids;
  }
  function dlLock() { try { return JSON.parse(get(DL_LOCK) || "null"); } catch (e) { return null; } }
  function paintDownloaded(justNow) {
    var b = $("downloadedBtn"), lock = dlLock();
    var seen = (lock && lock.seen) || [];
    var waiting = !!lock && !replyIds().some(function (id) { return seen.indexOf(id) < 0; });
    if (lock && !waiting) { try { localStorage.removeItem(DL_LOCK); } catch (e) {} }
    var was = b.classList.contains("is-sent");
    b.disabled = waiting;
    b.classList.toggle("is-sent", waiting);
    if (justNow) { b.classList.add("just-sent"); setTimeout(function () { b.classList.remove("just-sent"); }, 900); }
    // English goes in; the language layer translates whatever is written here.
    if (waiting !== was) b.querySelector("span").textContent = waiting ? "Sent" : "I have downloaded the EA";
  }
  $("downloadedBtn").onclick = function () {
    if (this.disabled) return;
    if (window.MBL_SUPPORT_SEND) {
      window.MBL_SUPPORT_SEND({
        text: T("I have downloaded the EA — please guide me on how to set it up and use it the right way."),
        kind: "ea-downloaded",
      });
    }
  };
  // The words actually went out: lock the button on what we have said so far.
  window.addEventListener("mbl:support-sent", function (e) {
    if (!e.detail || e.detail.kind !== "ea-downloaded") return;
    set(DL_LOCK, JSON.stringify({ at: new Date().toISOString(), seen: replyIds() }));
    paintDownloaded(true);
  });
  // Our reply landing in the bubble is what unlocks sending again.
  window.addEventListener("mbl:support-reply", function () { paintDownloaded(); if (!root.hidden) paintModal(); });
  // The same thread in another tab of this browser may be the one that receives our answer.
  window.addEventListener("storage", function (e) { if (e.key === "mbl_support_thread" || e.key === DL_LOCK) paintDownloaded(); });
  paintDownloaded();

  /* Click-to-copy for the one string in the steps that must be typed
     exactly. The button says so for a moment, then goes back to "Copy". The
     clipboard API needs a secure context; the old selection trick covers a
     browser without it. */
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-copy]");
    if (!b) return;
    var text = b.getAttribute("data-copy");
    var done = function () {
      var label = b.querySelector("span");
      var was = label ? label.textContent : "";
      b.classList.add("is-copied");
      if (label) label.textContent = T("Copied");
      setTimeout(function () { b.classList.remove("is-copied"); if (label) label.textContent = was; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { /* nothing more to try */ }
      ta.remove();
    }
  });

  paintProfiles();
  load();
  setInterval(load, REFRESH_MS);
  // Cards and the signal meta line carry numbers in sentences built here, so a
  // language arriving after the first paint has to redraw them.
  window.addEventListener("langchange", function () { paintProfiles(); paintSignals(); });

  // /mt5/generalmt5#get opens straight onto the request, for links that
  // promise the download rather than the page.
  if (location.hash === "#get") openModal();
})();
