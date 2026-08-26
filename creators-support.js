/**
 * MAGIC BOTS LAB — the support bubble.
 *
 * Somebody stuck at eleven at night will not compose an email. They will type
 * one line into a box if there is a box. The name and email are remembered
 * across the site, so most people only ever type the message, and what they
 * sent stays on screen afterwards — a form that swallows your words and says
 * "thanks" leaves you unsure anything happened.
 *
 * A bare "hi" is not a question yet, so it is held back once with a request for
 * detail rather than spending a round trip each way. Held-back messages are not
 * marked as sent, because they were not.
 *
 * The reply comes back by email. Nothing here says how it reaches us.
 */

(function () {
  "use strict";

  var NAME_KEY = "mbl_support_name";
  var MAIL_KEY = "mbl_support_email";
  var ID_KEY = "mbl_support_id";
  var THREAD_KEY = "mbl_support_thread";

  var isEmail = function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim()); };
  var get = function (k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
  var set = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };

  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  /** A greeting on its own, or one word. Anything with a digit or a question
   *  mark is a real question however short it is. */
  function justAGreeting(t) {
    var s = String(t || "").trim().replace(/[!.?,\s]+$/g, "");
    if (s.length > 40) return false;
    if (/[?0-9]/.test(s)) return false;
    return /^(hi|hey+|hello+|yo|sup|hola|niaje|mambo|habari|help|good\s*(morning|afternoon|evening|day)|how\s*are\s*(you|u)|what'?s\s*up)$/i.test(s)
      || s.split(/\s+/).length < 2;
  }

  var id = get(ID_KEY);
  if (!/^[0-9A-F]{8}$/.test(id)) {
    var b = new Uint8Array(4);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach(function (_, i) { b[i] = Math.random() * 256; });
    id = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("").toUpperCase();
    set(ID_KEY, id);
  }

  var state = {
    open: false,
    nudged: false,
    busy: false,
    // An explicit "I am editing" flag. Clearing the email was doing this job,
    // which destroyed the value somebody might not have wanted to lose.
    editWho: false,
    unread: 0,
    name: get(NAME_KEY),
    email: get(MAIL_KEY),
    thread: (function () { try { return JSON.parse(get(THREAD_KEY) || "[]"); } catch (e) { return []; } })()
  };

  var CHAT_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>';
  var CLOSE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  var btn = document.createElement("button");
  btn.className = "sup-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Message support");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = CHAT_ICON;
  document.body.appendChild(btn);

  var panel = document.createElement("div");
  panel.className = "sup";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Message support");
  panel.hidden = true;
  document.body.appendChild(panel);

  /** A creator's own details beat anything cached here. */
  window.MBL_SUPPORT_IDENTITY = function (name, email) {
    if (name) { state.name = name; set(NAME_KEY, name); }
    if (isEmail(email)) { state.email = email; set(MAIL_KEY, email); }
    if (state.open) draw();
  };

  function draw() {
    var needsWho = state.editWho || !isEmail(state.email) || !state.name.trim();

    panel.innerHTML =
      '<div class="sup-head">' +
        '<span style="width:34px;height:34px;border-radius:999px;display:grid;place-items:center;background:rgba(0,210,255,.18);color:var(--accent);flex:none">' +
          '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>' +
        "</span>" +
        '<div style="min-width:0;flex:1"><div style="font-size:14px;font-weight:700">Talk to us</div>' +
        '<div style="font-size:11px;color:var(--muted)"><span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:var(--success);margin-right:5px"></span>Usually answered within a day</div></div>' +
        // Closing from inside the panel: the bubble behind it is a small target
        // on a phone, and on a short screen it can be off the bottom entirely.
        '<button type="button" id="supClose" class="sup-close" aria-label="Close support">' +
          '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
        "</button>" +
      "</div>" +

      '<div class="sup-body" id="supBody">' +
        '<div class="sup-msg">Hi' + (state.name ? " " + esc(state.name.split(" ")[0]) : "") +
          " — ask us anything about the Creator Program or the bots. Tell us what happened and what you expected. " +
          "The answer comes back here.</div>" +
        state.thread.map(function (l) {
          if (l.from === "us") {
            // system = the widget talking (the nudge). Anything else is an
            // answer from a person, and it is the reason this window exists.
            return l.system
              ? '<div class="sup-msg">' + esc(l.text) + "</div>"
              : '<div class="sup-reply"><div class="sup-reply-who"><i></i>Magic Bots Lab support</div>' +
                '<div class="sup-reply-body">' + esc(l.text) + "</div></div>";
          }
          return '<div><div class="sup-mine">' + esc(l.text) + "</div>" +
            (l.sent === false ? "" : '<div class="sup-sent">✓ Sent · check back here or your email</div>') + "</div>";
        }).join("") +
      "</div>" +

      '<div class="sup-who">' +
        (needsWho
          ? '<div style="display:flex;align-items:center;gap:8px">' +
              '<div style="flex:1;min-width:0;font-size:11px;color:var(--muted)">' +
                (state.editWho ? "Change these, then tap Done." : "Fill these in first so we can reply — then type what you need below.") +
              "</div>" +
              // Offered only once both are usable: a Done that saved an
              // unusable address would lose the reply.
              (state.editWho && isEmail(state.email) && state.name.trim()
                ? '<button type="button" id="supDone" class="sup-done">Done</button>' : "") +
            "</div>" +
            '<input class="field" id="supName" placeholder="Your name" value="' + esc(state.name) + '" />' +
            '<input class="field" id="supMail" type="email" placeholder="Your email for the reply" value="' + esc(state.email) + '" />'
          : '<button type="button" id="supChange" style="all:unset;cursor:pointer;display:flex;gap:6px;width:100%;font-size:11.5px;color:var(--muted)">' +
            '<span class="mono" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(state.email) + "</span>" +
            '<span style="color:var(--accent);font-weight:600">Change</span></button>') +
      "</div>" +

      '<div class="sup-foot">' +
        '<textarea class="field" id="supText" rows="1" placeholder="Type what you need…" aria-label="Your message"></textarea>' +
        '<button class="btn" id="supSend" aria-label="Send" style="width:42px;height:40px;padding:0">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/></svg>' +
        "</button>" +
      "</div>";

    var body = panel.querySelector("#supBody");
    body.scrollTop = body.scrollHeight;

    panel.querySelector("#supClose").onclick = function () { toggle(false); };

    var change = panel.querySelector("#supChange");
    if (change) change.onclick = function () { state.editWho = true; draw(); };

    var done = panel.querySelector("#supDone");
    if (done) done.onclick = function () {
      set(NAME_KEY, state.name.trim());
      set(MAIL_KEY, state.email.trim());
      state.editWho = false;
      draw();
    };

    var box = panel.querySelector("#supText");
    box.onkeydown = function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    };
    panel.querySelector("#supSend").onclick = send;
    setTimeout(function () { box.focus(); }, 60);
  }

  function remember(line) {
    state.thread = state.thread.concat([line]).slice(-30);
    set(THREAD_KEY, JSON.stringify(state.thread));
  }

  function send() {
    if (state.busy) return;

    var box = panel.querySelector("#supText");
    var message = (box.value || "").trim();
    if (message.length < 2) return;

    var nameEl = panel.querySelector("#supName");
    var mailEl = panel.querySelector("#supMail");
    if (nameEl) state.name = nameEl.value.trim();
    if (mailEl) state.email = mailEl.value.trim();

    if (!state.nudged && justAGreeting(message)) {
      state.nudged = true;
      remember({ text: message, from: "them", sent: false });
      remember({
        from: "us",
        system: true,
        text: "Hello! So we can actually help, tell us what you need in a bit of detail — what you were doing, " +
              "what happened, and what you expected instead. Then send it and we will reply to your email."
      });
      box.value = "";
      draw();
      return;
    }

    if (!state.name) { alert("Add your name so we know who we are replying to."); return; }
    if (!isEmail(state.email)) { alert("Add the email we should reply to."); return; }

    set(NAME_KEY, state.name);
    set(MAIL_KEY, state.email);

    state.busy = true;
    fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: state.name, email: state.email, message: message,
        source: window.MBL_SUPPORT_SOURCE || "Magic Bots Lab · Creator Program",
        visitorId: id, page: location.pathname
      })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (r) {
      state.busy = false;
      if (!r.ok) { alert(r.d.error || "We could not send that just now."); return; }
      remember({ text: message, from: "them", sent: true });
      state.nudged = false;
      // Sending is also finishing with the editor — leaving it open afterwards
      // makes it look like something is still required.
      state.editWho = false;
      draw();
      // There is a conversation now, so start listening for the answer.
      schedule();
    }).catch(function () {
      state.busy = false;
      alert("We could not reach you just now. Try again in a minute.");
    });
  }

  function paintBadge() {
    var old = btn.querySelector(".sup-badge");
    if (old) old.remove();
    if (state.open || !state.unread) return;
    var b = document.createElement("span");
    b.className = "sup-badge";
    b.setAttribute("aria-label", state.unread + (state.unread === 1 ? " new reply" : " new replies"));
    b.textContent = state.unread > 9 ? "9+" : String(state.unread);
    btn.appendChild(b);
  }

  function toggle(open) {
    state.open = open === undefined ? !state.open : open;
    panel.hidden = !state.open;
    btn.setAttribute("aria-label", state.open ? "Close support" : "Message support");
    btn.setAttribute("aria-expanded", state.open ? "true" : "false");
    btn.innerHTML = state.open ? CLOSE_ICON : CHAT_ICON;
    // Opening it is reading them.
    if (state.open) state.unread = 0;
    paintBadge();
    if (state.open) draw(); else btn.focus();
  }

  /**
   * Collect anything the owner has replied.
   *
   * Polled rather than pushed: a websocket for a bubble that is open for two
   * minutes at a time is not worth the moving parts. Fast while the panel is
   * open, slow when it is shut — a closed bubble only needs to know whether to
   * show a dot.
   *
   * Only runs once they have actually asked something. Somebody who never
   * opened the bubble has nothing waiting, and polling for them would be a
   * request a minute for no reason.
   */
  var polling = null;

  function poll() {
    if (!state.thread.length) return;
    fetch("/api/support-replies?visitorId=" + encodeURIComponent(id), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var fresh = (d && d.replies) || [];
        if (!fresh.length) return;
        fresh.forEach(function (rep) {
          remember({ id: rep.id, text: rep.body, at: rep.createdAt, from: "us" });
        });
        if (state.open) draw(); else { state.unread += fresh.length; paintBadge(); }
      })
      .catch(function () { /* offline, or the tab is asleep — try again next tick */ });
  }

  function schedule() {
    if (polling) clearInterval(polling);
    polling = setInterval(poll, state.open ? 7000 : 45000);
  }

  btn.onclick = function () { toggle(); schedule(); poll(); };

  // A reply may have landed while they were away, so look once on arrival and
  // then keep a slow heartbeat going.
  if (state.thread.length) { poll(); }
  schedule();

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.open) toggle(false);
  });
})();
