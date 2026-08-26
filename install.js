/**
 * "Install app" — Magic Bots Lab.
 *
 * Installing is a browser feature, not a page feature, and every browser
 * exposes it differently. This does the honest version of all three cases:
 *
 *   Chrome, Edge, Samsung, Opera (Android and desktop)
 *     They fire `beforeinstallprompt`. We catch it, keep it, and show a button
 *     that calls it. This is the only case where a click really installs.
 *
 *   iOS and iPadOS — any browser
 *     There is no `beforeinstallprompt` on iOS. Installing is Share → Add to
 *     Home Screen, and nothing a page does can trigger it, so the button opens
 *     short instructions rather than pretending to install.
 *
 *   Firefox desktop, and anything else
 *     No install path at all, so no button. Offering one that cannot work is
 *     worse than offering nothing.
 *
 * Already installed? Nothing renders. Dismissed? Hidden for 30 days — somebody
 * who has said no does not need asking again on their next visit.
 *
 * Self-mounting and dependency-free, so any page can carry it with one script
 * tag and no markup of its own.
 */
(function () {
  "use strict";

  var SNOOZE_KEY = "mbl_install_snoozed";
  var SNOOZE_MS = 30 * 86400000;

  function snoozed() {
    try { return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0); } catch (e) { return false; }
  }
  function snooze() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch (e) {}
  }

  /** Inside an installed window there is nothing left to offer. */
  function installed() {
    var standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    return !!standalone || navigator.standalone === true;
  }

  function isApple() {
    var ua = navigator.userAgent;
    // iPadOS 13+ reports itself as a Mac, so the touch check is what catches it.
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  if (installed() || snoozed()) return;

  var deferred = null;
  var btn = null;

  function makeButton() {
    if (btn) return;
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "install-btn";
    btn.setAttribute("aria-label", "Install Magic Bots Lab");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg><span>Install app</span>';
    btn.onclick = onClick;
    document.body.appendChild(btn);
  }

  function remove() {
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    btn = null;
  }

  function onClick() {
    if (isApple()) { howTo(); return; }
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.then(function (choice) {
      // The event is single-use either way.
      deferred = null;
      if (choice.outcome !== "accepted") snooze();
      remove();
    });
  }

  /** iOS cannot be prompted, so it gets told instead. */
  function howTo() {
    var wrap = document.createElement("div");
    wrap.className = "install-how";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "How to install");
    wrap.innerHTML =
      '<div class="install-card">' +
        '<div class="install-head"><h3>Add Magic Bots Lab to your home screen</h3>' +
          '<button type="button" class="install-x" aria-label="Close">' +
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        "</div>" +
        "<p>iPhone and iPad do not let a website install itself, so it takes two taps in Safari.</p>" +
        '<ol class="install-steps">' +
          '<li><i><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V3M8 7l4-4 4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg></i>' +
            "Tap the <b>Share</b> button at the bottom of Safari.</li>" +
          '<li><i><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></i>' +
            "Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>" +
        "</ol>" +
        '<button type="button" class="install-later">Not now</button>' +
      "</div>";

    function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    wrap.onclick = function (e) { if (e.target === wrap) close(); };
    wrap.querySelector(".install-x").onclick = close;
    wrap.querySelector(".install-later").onclick = function () { snooze(); close(); remove(); };
    document.body.appendChild(wrap);
  }

  // iOS gets the button straight away - there is no event coming.
  if (isApple()) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", makeButton);
    else makeButton();
    return;
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    // Without this Chrome shows its own mini-infobar instead of letting us
    // choose the moment.
    e.preventDefault();
    deferred = e;
    makeButton();
  });

  window.addEventListener("appinstalled", function () { deferred = null; remove(); });
})();
