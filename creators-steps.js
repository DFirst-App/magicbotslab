/**
 * MAGIC BOTS LAB — the three steps that turn a bot run into a post.
 *
 * Record it, talk over it, edit it. Kept in its own file because it is words,
 * not behaviour: the wording gets edited far more often than the bot does, and
 * neither should be able to break the other.
 *
 * Exposes markup only. The page that hosts it decides where it goes.
 */

window.MBLSteps = (function () {
  "use strict";

  var VOICE_SRC = "creators/blake-voice-example.mp3";

  /** Openers that give somebody a first line instead of a blank stare. */
  var STARTERS = [
    "You have probably never seen a trading bot actually place a trade. This one is running by itself — and it is 100% free.",
    "Everyone says trading bots are a scam. Watch this one work, then decide. I use this, it costs nothing.",
    "I used to sit and watch charts all day. Now I use this instead — free bots that trade for you.",
    "This took me 90 seconds to set up. I use Magic Bots Lab and every bot on it is free.",
    "If you have MetaTrader 5, you can do this today. Free Expert Advisors, any broker.",
    "Nobody explains what a synthetic index is, so watch a free bot trade one and I will tell you."
  ];

  var esc = function (v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  function icon(path, size) {
    var n = size || 15;
    return '<svg viewBox="0 0 24 24" width="' + n + '" height="' + n +
      '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none">' + path + "</svg>";
  }

  function card(n, title, lead, tips, extra) {
    return '<section class="step">' +
      '<header class="step-head"><span class="step-n">' + n + "</span>" +
        "<h4>" + esc(title) + "</h4></header>" +
      '<p class="step-lead">' + lead + "</p>" +
      (extra || "") +
      '<ul class="tips">' + tips.map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul>" +
    "</section>";
  }

  function html() {
    var voice =
      '<div class="voice-box">' +
        '<div class="voice-head">' +
          icon('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>', 16) +
          "<span>Hear an AI voice-over</span>" +
          '<button class="secondary-btn" type="button" data-act="voice" style="margin-left:auto;padding:7px 13px;font-size:12.5px">Download</button>' +
        "</div>" +
        '<audio controls preload="none" src="' + VOICE_SRC + '"></audio>' +
        '<p class="voice-note">Made with a free AI voice tool. Using one is allowed — nobody has to be on camera or use their own voice.</p>' +
      "</div>" +
      '<p class="step-sub">Openers that work:</p>' +
      '<ul class="tips quotes">' + STARTERS.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";

    return '<div class="steps">' +
      card(1, "Record your screen",
        'Start the bot above and record it trading. <b>20 to 40 seconds is plenty</b> — enough to see a few trades land and the bot stop itself at the target.',
        [
          "<b>On a phone:</b> swipe down for the control centre and tap Screen Record. On iPhone, add it in Settings → Control Centre first.",
          "<b>On a computer:</b> Windows — <b>Win + Alt + R</b>. Mac — <b>Shift + Cmd + 5</b>.",
          "Record in <b>portrait</b> if you can. Sideways video gets less reach on every platform."
        ]) +

      card(2, "Talk over it",
        'A silent screen recording is not a video. Say what people are looking at, and say the name. <b>Your own voice or a realistic AI voice — both are fine.</b>',
        [], voice) +

      card(3, "Edit it",
        'Put the recording and the voice together in whatever you already use — <b>CapCut</b> is free and does all of this on a phone. VN and InShot work too.',
        [
          "Add <b>captions</b>. Most people watch with the sound off, and CapCut writes them for you.",
          "Cut the first second. Start on the trade, not on you lining up the shot.",
          "Say <b>Magic Bots Lab</b> out loud, and say the bots are <b>100% free</b>. That is a rule, not a tip.",
          "Export at 1080p and post the same video to all three of your accounts."
        ]) +
    "</div>";
  }

  /** Downloading the sample under a name unique to each download. */
  function downloadVoice() {
    var code = Math.random().toString(36).slice(2, 7).toUpperCase();
    var a = document.createElement("a");
    a.href = VOICE_SRC;
    a.download = "blake-magicbotslab-" + code + ".mp3";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return a.download;
  }

  return { html: html, downloadVoice: downloadVoice, VOICE_SRC: VOICE_SRC };
})();
