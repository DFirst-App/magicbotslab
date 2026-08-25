/**
 * MAGIC BOTS LAB — everything the Creator Program says, and the maths behind it.
 *
 * Kept apart from the interface so the wording can be edited without touching
 * behaviour, and so the numbers exist in exactly one place. If the money is
 * wrong here it is wrong everywhere, which is the correct way round.
 */

window.MBL = (function () {
  "use strict";

  /* ── the money ─────────────────────────────────────────────────────────── */

  /** Accounts you already had. A brand-new account starts at $50 instead. */
  var FIRST_MONTH_EXISTING = 100;
  var FIRST_MONTH_NEW = 50;

  /** Every month after the first pays $50 more, up to the ceiling. */
  var STEP = 50;
  var CEILING = 750;

  /** Paid on top, once, when a month's videos reach 10,000 views. */
  var VIEWS_BONUS = 500;
  var VIEWS_TARGET = 10000;

  /** Per person you bring, once they have been paid. */
  var TEAM_PER_PERSON = 20;

  /* ── the cadence ───────────────────────────────────────────────────────── */

  var PROGRAM_DAYS = 30;
  var GRACE_DAYS = 2;
  /** A month is 28 days you actually posted — not 30 dates on a calendar. */
  var QUALIFYING_DAYS = PROGRAM_DAYS - GRACE_DAYS;
  var PACE_CHANGE_DAY = 15;
  var PLATFORMS_REQUIRED = 3;

  /** How many videos a given posted-day asks for. */
  function requiredOn(postedDay) {
    if (postedDay < 1) return 0;
    return postedDay < PACE_CHANGE_DAY ? 1 : 2;
  }

  /** What month N pays, before the bonus. */
  function monthBase(monthNumber, newAccounts) {
    if (monthNumber <= 1) return newAccounts ? FIRST_MONTH_NEW : FIRST_MONTH_EXISTING;
    var v = FIRST_MONTH_EXISTING + (monthNumber - 1) * STEP;
    return Math.min(v, CEILING);
  }

  /** The first six months, for the ladder people want to see before joining. */
  function ladder(newAccounts) {
    var out = [];
    for (var m = 1; m <= 6; m++) out.push({ month: m, usd: monthBase(m, newAccounts) });
    return out;
  }

  /* ── what is true about Magic Bots Lab ─────────────────────────────────── */

  var TRUE_ABOUT = [
    "All the trading bots are 100% FREE — say this in every video, it is a rule.",
    "They are fully automated — you pick a bot and it places the trades.",
    "The bots stop by themselves once the profit target for the run is reached.",
    "Easy to set up. The Deriv bots run in your browser, nothing to install.",
    "For MetaTrader 5 there are free Expert Advisors you download — any MT5 broker works.",
    "Trade from anywhere, at any time.",
    "They run at the weekend too — crypto and synthetic indices stay open."
  ];

  var DO = [
    "Post every day. Views are not required for you to be paid.",
    "Want the $500 bonus? Half the videos you post in a month need 10,000 views each.",
    "Tell viewers about Magic Bots Lab in every video — say the name out loud.",
    "Say the bots are 100% FREE. Every video, no exceptions.",
    "Post the same video to all three of your accounts — that counts as one day.",
    "Use your own voice, or a realistic AI voice. Both are fine.",
    "Faceless is fine. A screen recording with a voice over it works.",
    "English or a language widely spoken in your country — either works.",
    "Log every video here so your days are counted."
  ];

  var DONT = [
    "Do not re-upload a video you already posted on another day.",
    "Do not re-upload somebody else's footage. Take the idea, rebuild it yourself.",
    "Do not hide or delete your posts before you have been paid. We check that every video is still live."
  ];

  var IDEAS = [
    {
      title: "The free-bot reveal",
      hook: "\"I found a trading bot that costs nothing and I still do not believe it.\"",
      shot: "Screen recording of you opening Magic Bots Lab and starting a bot.",
      pivot: "\"It is called Magic Bots Lab. Every bot is 100% free — you pick one and it places the trades for you.\""
    },
    {
      title: "Set it and walk away",
      hook: "\"I set this up in 40 seconds and then went to make tea.\"",
      shot: "Start a bot, cut away, come back to the finished run.",
      pivot: "\"It stops by itself once the profit target for the run is hit. That is the part I like.\""
    },
    {
      title: "Weekend trading",
      hook: "\"Everyone says the market is closed on Sunday. Mine is not.\"",
      shot: "Bot running on synthetic indices with the weekend date visible.",
      pivot: "\"Magic Bots Lab runs on crypto and synthetic indices — those stay open at the weekend.\""
    },
    {
      title: "Nothing to install",
      hook: "\"No download. No software. It runs in the browser tab.\"",
      shot: "Open the site on a phone, start a Deriv bot.",
      pivot: "\"The Deriv bots run in your browser. For MT5 there are free Expert Advisors you download instead.\""
    },
    {
      title: "Your broker, your money",
      hook: "\"I did not send anyone my money to do this.\"",
      shot: "Show the bot connecting to your own broker account.",
      pivot: "\"It runs on your own account. Magic Bots Lab is free and it never holds your funds.\""
    },
    {
      title: "The 3am test",
      hook: "\"It traded while I was asleep. Here is what I woke up to.\"",
      shot: "Night shot, then the morning trade list.",
      pivot: "\"Fully automated — from anywhere, any time. All the bots are free.\""
    },
    {
      title: "Explaining it to a friend",
      hook: "\"My friend asked what I have been doing on my phone all week.\"",
      shot: "Two-shot or voice over a screen recording.",
      pivot: "\"I showed her Magic Bots Lab. You pick a bot, it trades, it stops at the target. Costs nothing.\""
    },
    {
      title: "MT5 in one minute",
      hook: "\"Free Expert Advisor, any MT5 broker, one minute to set up.\"",
      shot: "Drag the EA onto a chart, enable algo trading.",
      pivot: "\"Magic Bots Lab gives the EAs away. Any MetaTrader 5 broker works.\""
    }
  ];

  /* Five platforms, each with its own mark. Nothing here is listed unless we
     have the real logo for it — a made-up glyph next to a real one looks like
     a fake, and this is the screen people decide to trust us on. */
  var PLATFORMS = [
    { key: "tiktok", name: "TikTok", logo: "logos/tiktok.svg", hint: "@handle or paste your link" },
    { key: "instagram", name: "Instagram Reels", logo: "logos/instagram.svg", hint: "@handle or paste your link" },
    { key: "youtube", name: "YouTube Shorts", logo: "logos/youtube.svg", hint: "@channel or paste your link" },
    { key: "facebook", name: "Facebook Reels", logo: "logos/facebook.svg", hint: "Page name or paste your link" },
    { key: "snapchat", name: "Snapchat Spotlight", logo: "logos/snapchat.svg", hint: "@username or paste your link" }
  ];

  var PAYOUTS = [
    { key: "mpesa", label: "M-Pesa", group: "Mobile money", logo: "logos/mpesa.svg" },
    { key: "paypal", label: "PayPal", group: "Online", logo: "logos/paypal.svg" },
    { key: "wise", label: "Wise", group: "Online", logo: "logos/wise.svg" },
    { key: "payoneer", label: "Payoneer", group: "Online", logo: "logos/payoneer.svg" },
    { key: "venmo", label: "Venmo", group: "Online", logo: "logos/venmo.svg" },
    { key: "cashapp", label: "Cash App", group: "Online", logo: "logos/cashapp.svg" },
    { key: "usdt", label: "USDT (Tether)", group: "Crypto", logo: "logos/tether.svg" }
  ];

  /* ── progress ──────────────────────────────────────────────────────────── */

  /**
   * Where a creator is, counted in days they actually posted.
   *
   * `days` is a list of YYYY-MM-DD strings, one per logged video, so a day with
   * two videos appears twice. Everything below is derived from the set of
   * distinct days — missing one moves the finish out by a day rather than
   * losing the month.
   */
  function progress(days) {
    var unique = Object.keys((days || []).reduce(function (a, d) { a[d] = 1; return a; }, {})).sort();
    var postedDays = unique.length;

    var counts = (days || []).reduce(function (a, d) { a[d] = (a[d] || 0) + 1; return a; }, {});
    var qualifying = 0;
    for (var i = 0; i < unique.length; i++) {
      if ((counts[unique[i]] || 0) >= requiredOn(i + 1)) qualifying++;
    }

    var today = new Date().toISOString().slice(0, 10);
    var postedToday = counts[today] || 0;
    var need = requiredOn(postedDays + (postedToday ? 0 : 1));

    return {
      started: postedDays > 0,
      firstDay: unique[0] || null,
      postedDays: postedDays,
      qualifying: qualifying,
      remaining: Math.max(0, QUALIFYING_DAYS - postedDays),
      percent: Math.min(100, Math.round((postedDays / QUALIFYING_DAYS) * 100)),
      postedToday: postedToday,
      requiredToday: need,
      doneToday: postedToday >= need,
      days: unique,
      counts: counts
    };
  }

  return {
    FIRST_MONTH_EXISTING: FIRST_MONTH_EXISTING,
    FIRST_MONTH_NEW: FIRST_MONTH_NEW,
    STEP: STEP,
    CEILING: CEILING,
    VIEWS_BONUS: VIEWS_BONUS,
    VIEWS_TARGET: VIEWS_TARGET,
    TEAM_PER_PERSON: TEAM_PER_PERSON,
    PROGRAM_DAYS: PROGRAM_DAYS,
    GRACE_DAYS: GRACE_DAYS,
    QUALIFYING_DAYS: QUALIFYING_DAYS,
    PACE_CHANGE_DAY: PACE_CHANGE_DAY,
    PLATFORMS_REQUIRED: PLATFORMS_REQUIRED,
    requiredOn: requiredOn,
    monthBase: monthBase,
    ladder: ladder,
    progress: progress,
    TRUE_ABOUT: TRUE_ABOUT,
    DO: DO,
    DONT: DONT,
    IDEAS: IDEAS,
    PLATFORMS: PLATFORMS,
    PAYOUTS: PAYOUTS
  };
})();
