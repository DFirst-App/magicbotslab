/**
 * MAGIC BOTS LAB — Share & invite.
 *
 * A creator earns $20 for every person they bring who gets paid, but almost
 * nobody sends a link unless something puts one in their hand. So two things
 * live here.
 *
 * The **daily prompt**: once a day, when they open Team, a panel opens with a
 * message ready to copy and one ask — send it to ten people. Once a day and
 * not once a visit, because the second time in an hour it is nagging.
 *
 * The **copy chooser**: pressing share asks what they actually want. Most
 * people want the message — a bare link in a chat gets ignored — but somebody
 * filling in a bio needs the link on its own, and guessing wrong wastes their
 * time either way.
 *
 * Whatever sits at the top of the list is the message. Starred if they starred
 * one, otherwise a random pick that visit, so fifty creators do not all send
 * the identical paragraph into the same group chat.
 */

window.MBLShare = (function () {
  "use strict";

  var FAVES_KEY = "mbl_invite_faves";
  var SEEN_KEY = "mbl_invite_prompt_day";
  var TARGET_PEOPLE = 10;

  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  function readFaves() {
    try {
      var v = JSON.parse(localStorage.getItem(FAVES_KEY) || "[]");
      return Array.isArray(v) ? v.filter(function (k) { return typeof k === "string"; }) : [];
    } catch (e) { return []; }
  }

  function writeFaves(list) {
    try { localStorage.setItem(FAVES_KEY, JSON.stringify(list)); } catch (e) {}
  }

  // Shuffled once per page load, so with nothing starred the top message
  // differs between creators and between days.
  var shuffle = (window.MBL_INVITES || []).map(function (v) { return v.key; })
    .sort(function () { return Math.random() - 0.5; });

  /** Starred first, in the order they were starred; then this visit's order. */
  function ordered() {
    var faves = readFaves();
    var rank = function (k) {
      var i = faves.indexOf(k);
      return i >= 0 ? -1000 + i : shuffle.indexOf(k);
    };
    return (window.MBL_INVITES || []).slice().sort(function (a, b) { return rank(a.key) - rank(b.key); });
  }

  function toggleFave(key) {
    var f = readFaves();
    var next = f.indexOf(key) >= 0 ? f.filter(function (k) { return k !== key; }) : [key].concat(f);
    writeFaves(next);
    return next;
  }

  function copy(text, okMsg) {
    return navigator.clipboard.writeText(text).then(
      function () { if (window.MBL_TOAST) window.MBL_TOAST(okMsg); return true; },
      function () { if (window.MBL_TOAST) window.MBL_TOAST("Could not copy — select it and copy by hand.", true); return false; }
    );
  }

  /* ── the dialog ────────────────────────────────────────────────────────── */

  var el = null;

  function close() {
    if (!el) return;
    el.remove();
    el = null;
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) { if (e.key === "Escape") close(); }

  function card(v, link, featured, faves) {
    var starred = faves.indexOf(v.key) >= 0;
    return '<div class="inv-card' + (featured ? " featured" : "") + '">' +
      '<div class="inv-head">' +
        '<span class="inv-label">' + (featured ? "Ready to send" : esc(v.label)) + "</span>" +
        '<button type="button" class="inv-star' + (starred ? " on" : "") + '" data-star="' + esc(v.key) + '" ' +
          'aria-label="' + (starred ? "Unstar" : "Star") + " " + esc(v.label) + '" title="Star this one to keep it at the top">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="' + (starred ? "currentColor" : "none") +
          '" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z"/></svg>' +
        "</button>" +
        '<button type="button" class="inv-copy" data-copymsg="' + esc(v.key) + '">Copy</button>' +
      "</div>" +
      '<pre class="inv-body">' + esc(v.body(link)) + "</pre>" +
    "</div>";
  }

  /**
   * @param link   the creator's own share link
   * @param mode   "daily" for the once-a-day nudge, "chooser" when they pressed share
   */
  function open(link, mode) {
    close();
    var faves = readFaves();
    var list = ordered();
    var top = list[0];
    if (!top) return;

    el = document.createElement("div");
    el.className = "inv-overlay";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Share and invite");

    el.innerHTML =
      '<div class="inv-panel">' +
        '<button type="button" class="inv-close" data-close="1" aria-label="Close">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
        "</button>" +

        (mode === "daily"
          ? '<div class="inv-hero">' +
              "<h3>Send this to " + TARGET_PEOPLE + " people today</h3>" +
              "<p>Every person who joins on your link and gets paid earns you <b>$20</b> — and it never comes out of " +
              "what they make. Ten messages is about five minutes. Pick the version that sounds like you.</p>" +
            "</div>"
          : '<div class="inv-hero"><h3>What do you want to copy?</h3></div>') +

        card(top, link, true, faves) +

        '<button type="button" class="inv-more" data-more="1">All versions' +
          '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
        "</button>" +

        '<div class="inv-all" hidden>' +
          '<p class="inv-hint">Star the one that sounds like you and it moves to the top.</p>' +
          list.slice(1).map(function (v) { return card(v, link, false, faves); }).join("") +
        "</div>" +

        '<button type="button" class="inv-linkonly" data-copylink="1">' +
          '<span class="inv-linkonly-t">Just the link</span>' +
          '<span class="inv-linkonly-v">' + esc(link) + "</span>" +
          '<span class="inv-linkonly-s">For your bio.</span>' +
        "</button>" +

        (mode === "daily"
          ? '<button type="button" class="inv-done" data-close="1">Done — I have sent it</button>'
          : "") +
      "</div>";

    document.body.appendChild(el);
    document.addEventListener("keydown", onKey);

    el.addEventListener("click", function (e) {
      if (e.target === el) { close(); return; }

      var closeBtn = e.target.closest("[data-close]");
      if (closeBtn) { close(); return; }

      var more = e.target.closest("[data-more]");
      if (more) {
        var all = el.querySelector(".inv-all");
        all.hidden = !all.hidden;
        more.classList.toggle("open", !all.hidden);
        more.firstChild.nodeValue = all.hidden ? "All versions" : "Hide other versions";
        return;
      }

      var star = e.target.closest("[data-star]");
      if (star) {
        toggleFave(star.dataset.star);
        // Reopen so the starred one is where it belongs — at the top.
        open(link, mode);
        if (window.MBL_TOAST) window.MBL_TOAST("Saved. That one is at the top now.");
        return;
      }

      var cm = e.target.closest("[data-copymsg]");
      if (cm) {
        var v = (window.MBL_INVITES || []).filter(function (x) { return x.key === cm.dataset.copymsg; })[0];
        if (v) copy(v.body(link), "Message copied — paste and send").then(function () { close(); });
        return;
      }

      if (e.target.closest("[data-copylink]")) {
        copy(link, "Link copied — put it in your bio").then(function () { close(); });
      }
    });

    if (mode === "daily") markSeen();
  }

  /* ── once a day ────────────────────────────────────────────────────────── */

  function todayKey() { return new Date().toISOString().slice(0, 10); }

  function shouldPrompt() {
    try { return localStorage.getItem(SEEN_KEY) !== todayKey(); } catch (e) { return false; }
  }

  function markSeen() {
    try { localStorage.setItem(SEEN_KEY, todayKey()); } catch (e) {}
  }

  return {
    open: open,
    shouldPrompt: shouldPrompt,
    markSeen: markSeen,
    target: TARGET_PEOPLE
  };
})();
