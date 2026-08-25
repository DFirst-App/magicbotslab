/**
 * MAGIC BOTS LAB — the Creator Program dashboard.
 *
 * One difference from Clunoid worth stating up front: there is no separate
 * registration page. A new visitor lands on the dashboard, sees the sidebar
 * and the sections they are about to have, and joins from Home — inside the
 * thing rather than in front of it. It is the same screen before and after, so
 * nobody has to work out where they ended up.
 *
 * No framework and no build step: magicbotslab.com is a static site. State
 * lives in one object, every section is a function returning HTML, and one
 * render swaps the view. Handlers are delegated from the root, which is what
 * keeps that safe when the markup is replaced wholesale.
 */

(function () {
  "use strict";

  var M = window.MBL;
  var TOKEN_KEY = "mbl_creator_token";
  var API = "/api/creators/";

  /* ── state ─────────────────────────────────────────────────────────────── */

  var S = {
    token: "",
    me: null,             // null until loaded; false once we know there is none
    view: "home",
    busy: false,
    // The registration form, while they are filling it in.
    form: { name: "", email: "", country: "", newAccounts: false, payout: "", agreed: false },
    platforms: ["tiktok", "instagram", "youtube"],
    handles: {},
    // The post-log composer.
    log: { platforms: [], link: "", day: today() },
    calMonth: null
  };

  /* ── small helpers ─────────────────────────────────────────────────────── */

  function today() { return new Date().toISOString().slice(0, 10); }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function money(n) { n = Number(n || 0); return "$" + (n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)); }

  function fmt(d) {
    if (!d) return "—";
    var x = new Date(d);
    if (isNaN(x)) return "—";
    return x.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function icon(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
  }

  var ICONS = {
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    days: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    log: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    earnings: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
    ideas: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
    rules: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    me: '<circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>'
  };

  function toast(text, bad) {
    var host = document.getElementById("toasts");
    var el = document.createElement("div");
    el.className = "toast" + (bad ? " bad" : "");
    el.innerHTML = (bad ? "⚠ " : "✓ ") + esc(text);
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  function post(path, body) {
    return fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok, status: r.status, data: d };
      });
    });
  }

  /* ── loading ───────────────────────────────────────────────────────────── */

  function load() {
    S.token = localStorage.getItem(TOKEN_KEY) || "";
    if (!S.token) { S.me = false; render(); return Promise.resolve(); }

    return post("me", { token: S.token }).then(function (r) {
      if (r.ok && r.data && r.data.creator) {
        S.me = r.data;
        S.platforms = (r.data.handles || []).map(function (h) { return h.platform; });
        S.handles = (r.data.handles || []).reduce(function (a, h) { a[h.platform] = h.handle || ""; return a; }, {});
        if (!S.platforms.length) S.platforms = ["tiktok", "instagram", "youtube"];
      } else {
        // The token means nothing any more — do not keep pretending it does.
        localStorage.removeItem(TOKEN_KEY);
        S.token = "";
        S.me = false;
      }
      render();
    }).catch(function () { S.me = false; render(); });
  }

  /* ── the rail ──────────────────────────────────────────────────────────── */

  var SECTIONS = [
    { key: "home", label: "Home", group: "Start", icon: "home", always: true },
    { key: "days", label: "My 30 days", group: "The work", icon: "days" },
    { key: "log", label: "Post log", group: "The work", icon: "log" },
    { key: "earnings", label: "Earnings", group: "Money", icon: "earnings" },
    { key: "team", label: "Team", group: "Money", icon: "team" },
    { key: "ideas", label: "Ideas", group: "Learn", icon: "ideas", always: true },
    { key: "rules", label: "Rules", group: "Learn", icon: "rules", always: true },
    { key: "me", label: "My details", group: "Learn", icon: "me" }
  ];

  function drawRail() {
    var joined = !!S.me;
    var html = "";
    var lastGroup = "";

    SECTIONS.forEach(function (s) {
      if (s.group !== lastGroup) {
        if (lastGroup) html += "</div>";
        html += '<div class="rail-group"><div class="rail-label">' + esc(s.group) + "</div>";
        lastGroup = s.group;
      }
      var locked = !joined && !s.always;
      html += '<button class="rail-item" data-go="' + s.key + '"' +
        (S.view === s.key ? ' aria-current="true"' : "") +
        (locked ? " disabled" : "") + ">" +
        icon(ICONS[s.icon]) + "<span>" + esc(s.label) + "</span>" +
        (locked ? '<span class="tag">Join first</span>' : "") +
        "</button>";
    });
    html += "</div>";

    document.getElementById("rail").innerHTML = html;
    document.getElementById("railFoot").innerHTML = joined
      ? "Post every day. Views are not required to be paid."
      : "Join on the Home tab. You start the same day — there is nothing to wait for.";
  }

  /* ── views ─────────────────────────────────────────────────────────────── */

  var TITLES = {
    home: ["Home", "Get paid every month to post about Magic Bots Lab"],
    days: ["My 30 days", "A month is 28 days you actually posted"],
    log: ["Post log", "Log every video so your days are counted"],
    earnings: ["Earnings", "What you have made, and what is coming"],
    team: ["Team", "Bring people in and earn alongside them"],
    ideas: ["Ideas", "Formats that work, and what to say"],
    rules: ["Rules", "Short, and all of them matter"],
    me: ["My details", "Everything saves itself as you change it"]
  };

  function render() {
    drawRail();
    var t = TITLES[S.view] || TITLES.home;
    document.getElementById("viewTitle").textContent = t[0];
    document.getElementById("viewSub").textContent = t[1];

    var body =
      S.view === "days" ? viewDays()
      : S.view === "log" ? viewLog()
      : S.view === "earnings" ? viewEarnings()
      : S.view === "team" ? viewTeam()
      : S.view === "ideas" ? viewIdeas()
      : S.view === "rules" ? viewRules()
      : S.view === "me" ? viewMe()
      : viewHome();

    document.getElementById("view").innerHTML = body;
  }

  /* ── home ──────────────────────────────────────────────────────────────── */

  function viewHome() {
    if (S.me === null) return '<div class="card"><p>Loading…</p></div>';
    return S.me ? homeJoined() : homeNew();
  }

  /** What the programme is, then the form — on the same screen, in that order. */
  function homeNew() {
    var l = M.ladder(false);

    return '' +
    '<div class="grid g2" style="align-items:start">' +
      '<div class="stack">' +
        '<section class="card accent">' +
          '<div class="eyebrow">' + icon(ICONS.home) + " The whole thing in four lines</div>" +
          "<h2>Make short videos about Magic Bots Lab. Get paid every month.</h2>" +
          '<p>Post one video a day about our free trading bots on three of your own social accounts. ' +
          'At the end of the month you are paid — <b>views are not required</b>.</p>' +
          '<div class="grid g2" style="margin-top:14px">' +
            '<div class="stat"><div class="k">Accounts you already have</div><div class="v ok">' + money(M.FIRST_MONTH_EXISTING) + '</div><div class="s">for your first month</div></div>' +
            '<div class="stat"><div class="k">Brand-new accounts</div><div class="v hi2">' + money(M.FIRST_MONTH_NEW) + '</div><div class="s">first month only, while you build reach</div></div>' +
          "</div>" +
          '<p style="margin-top:12px">Every month after that pays <b>' + money(M.STEP) + ' more</b> than the one before, up to ' +
          "<b>" + money(M.CEILING) + '</b> a month. Reach ' + M.VIEWS_TARGET.toLocaleString() + ' views in a month and there is ' +
          "<b>" + money(M.VIEWS_BONUS) + "</b> on top.</p>" +
        "</section>" +

        '<section class="card">' +
          '<div class="eyebrow">' + icon(ICONS.days) + " The cadence</div>" +
          '<div class="grid g3">' +
            '<div class="stat"><div class="k">Posted days 1–14</div><div class="v hi">1</div><div class="s">video a day — a slow start builds reach and protects the account</div></div>' +
            '<div class="stat"><div class="k">Posted days 15–28</div><div class="v hi">2</div><div class="s">videos a day — same for every month after this one</div></div>' +
            '<div class="stat"><div class="k">Each video</div><div class="v hi">' + M.PLATFORMS_REQUIRED + '</div><div class="s">accounts minimum. The same video on all three is one day.</div></div>' +
          "</div>" +
          "<p style=\"margin-top:12px\">A month here means <b>" + M.QUALIFYING_DAYS + " days you actually posted</b>, not " +
          M.PROGRAM_DAYS + " dates on a calendar — " + M.PROGRAM_DAYS + " days with " + M.GRACE_DAYS +
          " grace days, counted the honest way. Miss one and the finish moves out a day. You do not lose the month.</p>" +
        "</section>" +

        '<section class="card">' +
          '<div class="eyebrow">' + icon(ICONS.earnings) + " Where it goes</div>" +
          '<div class="row">' + l.map(function (r) {
            return '<span class="pill' + (r.month === 1 ? " on" : "") + '">Month ' + r.month + " · " + money(r.usd) + "</span>";
          }).join("") + "</div>" +
          '<p style="margin-top:12px">Bring other creators in and you earn <b>' + money(M.TEAM_PER_PERSON) +
          "</b> for each one, the moment they are paid. There is no limit on how many.</p>" +
        "</section>" +
      "</div>" +

      registrationCard() +
    "</div>";
  }

  /** The form. It lives inside the dashboard, not on a page before it. */
  function registrationCard() {
    var f = S.form;
    return '' +
    '<section class="card accent" id="join">' +
      '<div class="eyebrow">' + icon(ICONS.me) + " Join and start today</div>" +
      "<h2>Register</h2>" +
      "<p>There is no approval and no waiting list. Fill this in and the rest of the dashboard opens straight away — " +
      "your month starts the day you post your first video, not today.</p>" +

      '<div class="stack" style="margin-top:14px">' +
        '<div><label class="lbl" for="f-name">Your name</label>' +
          '<input class="field" id="f-name" data-f="name" value="' + esc(f.name) + '" placeholder="Jane Doe" autocomplete="name" /></div>' +

        '<div><label class="lbl" for="f-email">Email</label>' +
          '<input class="field" id="f-email" data-f="email" type="email" value="' + esc(f.email) + '" placeholder="you@email.com" autocomplete="email" /></div>' +

        '<div><label class="lbl" for="f-country">Country</label>' +
          '<input class="field" id="f-country" data-f="country" value="' + esc(f.country) + '" list="countries" placeholder="Start typing…" autocomplete="country-name" />' +
          '<datalist id="countries">' + (window.MBL_COUNTRIES || []).map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("") + "</datalist></div>" +

        "<div>" + platformPicker() + "</div>" +

        '<div><label class="lbl">How you want to be paid <span style="text-transform:none;letter-spacing:0">— optional, change it any time</span></label>' +
          payoutPicker(f.payout, "f-payout") + "</div>" +

        '<label class="check"><input type="checkbox" data-f="newAccounts"' + (f.newAccounts ? " checked" : "") + " />" +
          "<span>I made these accounts brand new for this. <b>" + money(M.FIRST_MONTH_NEW) + "</b> for the first month instead of <b>" +
          money(M.FIRST_MONTH_EXISTING) + "</b> — we check every account ourselves before paying, so this is a starting point, not the decision.</span></label>" +

        '<label class="check"><input type="checkbox" data-f="agreed"' + (f.agreed ? " checked" : "") + " />" +
          "<span>I have read the <b>Rules</b> and I will say in every video that the bots are <b>100% free</b>.</span></label>" +

        '<button class="btn wide" data-act="register"' + (S.busy ? " disabled" : "") + ">" +
          (S.busy ? "Registering…" : "Register and start today") + "</button>" +

        '<p style="font-size:11.5px;color:var(--faint);margin:0">Nothing to pay, ever. You keep your own accounts and your own audience.</p>' +
      "</div>" +
    "</section>";
  }

  function homeJoined() {
    var c = S.me.creator;
    var p = M.progress((S.me.posts || []).map(function (x) { return x.posted_on; }));
    var t = S.me.totals || { paidUsd: 0, pendingUsd: 0 };

    var first = c.new_accounts ? M.FIRST_MONTH_NEW : M.FIRST_MONTH_EXISTING;

    return '' +
    '<div class="stack">' +
      '<section class="card accent">' +
        "<h2>" + (p.started ? "Welcome back, " + esc(c.name.split(" ")[0]) : "You are in, " + esc(c.name.split(" ")[0])) + "</h2>" +
        (p.started
          ? "<p>Day <b>" + p.postedDays + "</b> of <b>" + M.QUALIFYING_DAYS + "</b> posted days. " +
            (p.doneToday
              ? '<span class="ok">Today is done — ' + p.postedToday + " logged.</span>"
              : '<span class="warnt">Today needs ' + p.requiredToday + " video" + (p.requiredToday === 1 ? "" : "s") + ".</span>") + "</p>" +
            '<div class="bar" style="margin:10px 0 6px"><i style="width:' + p.percent + '%"></i></div>' +
            '<p style="font-size:11.5px">' + p.remaining + " more posted days to finish this month.</p>"
          : "<p>Your month has not started yet — it begins the day you log your first video. " +
            "Make one video about Magic Bots Lab, post it to your three accounts, then log it in <b>Post log</b>.</p>" +
            '<button class="btn" data-go="log">Log my first video</button>') +
      "</section>" +

      '<div class="grid g4">' +
        '<div class="stat"><div class="k">Your total earnings</div><div class="v ok">' + money(t.paidUsd) + '</div><div class="s">paid to you</div></div>' +
        '<div class="stat"><div class="k">Pending</div><div class="v warnt">' + money(t.pendingUsd) + '</div><div class="s">once this month is signed off</div></div>' +
        '<div class="stat"><div class="k">This month pays</div><div class="v hi">' + money(first) + '</div><div class="s">' + (c.new_accounts ? "brand-new accounts" : "accounts you already had") + "</div></div>" +
        '<div class="stat"><div class="k">Your team</div><div class="v hi2">' + (S.me.teamTotals ? S.me.teamTotals.members : 0) + '</div><div class="s">' + money(M.TEAM_PER_PERSON) + " each once they are paid</div></div>" +
      "</div>" +

      '<section class="card">' +
        '<div class="eyebrow">' + icon(ICONS.rules) + " What to say about Magic Bots Lab</div>" +
        "<p>Say these and you are on solid ground.</p>" +
        "<ul style=\"margin:0;padding-left:18px;color:var(--muted);font-size:13px;line-height:1.85\">" +
        M.TRUE_ABOUT.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
      "</section>" +

      (c.payout_method ? "" :
        '<section class="card warn"><h3>Choose how you want to be paid</h3>' +
        "<p>You have not picked a payout method yet. It takes one tap in <b>My details</b>, and you can change it whenever you like. " +
        "You only fill in account details when there is money to withdraw.</p>" +
        '<button class="btn sm" data-go="me">Choose it now</button></section>') +
    "</div>";
  }

  /* ── platforms + payouts ───────────────────────────────────────────────── */

  function platformPicker() {
    var chosen = S.platforms;
    var rest = M.PLATFORMS.filter(function (p) { return chosen.indexOf(p.key) < 0; });

    var rows = chosen.map(function (k) {
      var p = M.PLATFORMS.filter(function (x) { return x.key === k; })[0] || { key: k, name: k, hint: "@handle" };
      return '<div class="plat-row">' +
        '<span class="nm">' + esc(p.name) + "</span>" +
        '<input class="field" data-h="' + esc(p.key) + '" value="' + esc(S.handles[p.key] || "") + '" placeholder="' + esc(p.hint) + '" />' +
        '<button class="x" data-drop="' + esc(p.key) + '" aria-label="Remove ' + esc(p.name) + '">' + icon(ICONS.x) + "</button>" +
      "</div>";
    }).join("");

    return '<label class="lbl">Where you post — pick ' + M.PLATFORMS_REQUIRED + "</label>" +
      '<div class="plat">' + rows + "</div>" +
      '<div class="row" style="margin-top:8px">' +
        '<select class="field" style="max-width:260px" data-add="1">' +
          '<option value="">Add another platform…</option>' +
          rest.map(function (p) { return '<option value="' + esc(p.key) + '">' + esc(p.name) + "</option>"; }).join("") +
        "</select>" +
        '<span style="font-size:11.5px;color:var(--faint)">' +
          (chosen.length === M.PLATFORMS_REQUIRED
            ? "Three chosen. Post on more if you want to — three is the minimum, not a limit."
            : "You have " + chosen.length + " of " + M.PLATFORMS_REQUIRED + ".") +
        "</span>" +
      "</div>";
  }

  function payoutPicker(value, id) {
    var groups = {};
    M.PAYOUTS.forEach(function (p) { (groups[p.group] = groups[p.group] || []).push(p); });

    return '<div class="stack" id="' + id + '">' + Object.keys(groups).map(function (g) {
      return '<div><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-bottom:6px">' + esc(g) + "</div>" +
        '<div class="row">' + groups[g].map(function (p) {
          return '<button type="button" class="pill' + (value === p.key ? " on" : "") + '" data-pay="' + esc(p.key) + '">' + esc(p.label) + "</button>";
        }).join("") + "</div></div>";
    }).join("") + "</div>";
  }

  /* ── my 30 days ────────────────────────────────────────────────────────── */

  function viewDays() {
    if (!S.me) return locked();
    var posts = S.me.posts || [];
    var p = M.progress(posts.map(function (x) { return x.posted_on; }));

    // A rolling 35-day window ending today: enough to backfill a fortnight you
    // forgot, without a month picker nobody asked for.
    var cells = [];
    for (var i = 34; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var key = d.toISOString().slice(0, 10);
      cells.push({ key: key, n: d.getDate(), done: !!p.counts[key], today: key === today() });
    }

    return '' +
    '<div class="stack">' +
      '<section class="card accent">' +
        '<div class="eyebrow">' + icon(ICONS.days) + " Your calendar</div>" +
        "<p>Tick any day you posted on but did not log. <b>Untick it</b> to take it back. " +
        "This is what your month is counted from, so keep it honest — we check the accounts.</p>" +
        '<div class="cal" style="margin-top:12px">' + cells.map(function (c) {
          return '<button data-day="' + c.key + '" class="' + (c.done ? "done" : "") + (c.today ? " today" : "") +
            '" title="' + c.key + '">' + c.n + "</button>";
        }).join("") + "</div>" +
      "</section>" +

      '<div class="grid g4">' +
        '<div class="stat"><div class="k">Posted days</div><div class="v hi">' + p.postedDays + " / " + M.QUALIFYING_DAYS + "</div><div class=\"s\">this month</div></div>" +
        '<div class="stat"><div class="k">Left to finish</div><div class="v">' + p.remaining + '</div><div class="s">posted days</div></div>' +
        '<div class="stat"><div class="k">Today asks for</div><div class="v ' + (p.doneToday ? "ok" : "warnt") + '">' + p.requiredToday + '</div><div class="s">' + (p.doneToday ? "already done" : "not logged yet") + "</div></div>" +
        '<div class="stat"><div class="k">Started</div><div class="v" style="font-size:15px">' + fmt(p.firstDay) + '</div><div class="s">day 1 was your first post</div></div>' +
      "</div>" +

      '<section class="card"><div class="eyebrow">' + icon(ICONS.log) + " How the month is counted</div>" +
        "<p>Days 1–14 ask for one video. Days 15–" + M.QUALIFYING_DAYS + " ask for two. " +
        "The month ends after <b>" + M.QUALIFYING_DAYS + " days you posted</b> — miss a day and the finish moves out by a day, " +
        "which is why you cannot fall off the programme by having a bad week.</p></section>" +
    "</div>";
  }

  /* ── post log ──────────────────────────────────────────────────────────── */

  function viewLog() {
    if (!S.me) return locked();
    var posts = S.me.posts || [];
    var mine = S.platforms;

    return '' +
    '<div class="stack">' +
      '<section class="card accent">' +
        '<div class="eyebrow">' + icon(ICONS.log) + " Log a video</div>" +
        '<p>Tick the accounts it went live on. The same video on all three is <b>one day</b>, not three.</p>' +
        '<div class="row" style="margin:10px 0">' + mine.map(function (k) {
          var p = M.PLATFORMS.filter(function (x) { return x.key === k; })[0] || { key: k, name: k };
          var on = S.log.platforms.indexOf(k) >= 0;
          return '<button type="button" class="pill' + (on ? " good" : "") + '" data-lp="' + esc(k) + '">' + (on ? "✓ " : "") + esc(p.name) + "</button>";
        }).join("") + "</div>" +
        '<div class="row">' +
          '<input class="field" style="flex:1;min-width:220px" data-l="link" value="' + esc(S.log.link) + '" placeholder="Link to the video (optional)" />' +
          '<input class="field" style="max-width:170px" type="date" max="' + today() + '" data-l="day" value="' + esc(S.log.day) + '" />' +
          '<button class="btn" data-act="log"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "Saving…" : "Log it") + "</button>" +
        "</div>" +
      "</section>" +

      '<section class="card">' +
        '<div class="eyebrow">' + icon(ICONS.days) + " Everything you have logged (" + posts.length + ")</div>" +
        (posts.length === 0
          ? "<p>Nothing yet. Your month starts with the first one.</p>"
          : '<div class="tablewrap"><table class="t"><thead><tr><th>Day</th><th>Video</th><th>Where</th><th>Link</th><th></th></tr></thead><tbody>' +
            posts.map(function (x) {
              return "<tr><td>" + fmt(x.posted_on) + "</td><td>#" + x.slot + "</td><td style=\"color:var(--muted)\">" +
                esc((x.platforms || []).join(", ") || "—") + "</td><td style=\"color:var(--muted)\">" +
                (x.link ? '<a href="' + esc(x.link) + '" target="_blank" rel="noopener noreferrer" class="hi">open</a>' : "—") +
                '</td><td style="text-align:right"><button class="btn ghost sm" data-undo="' + esc(x.id) + '">Undo</button></td></tr>';
            }).join("") + "</tbody></table></div>") +
      "</section>" +
    "</div>";
  }

  /* ── earnings ──────────────────────────────────────────────────────────── */

  function viewEarnings() {
    if (!S.me) return locked();
    var rows = S.me.earnings || [];
    var t = S.me.totals || { paidUsd: 0, pendingUsd: 0 };
    var team = S.me.teamTotals || { earnedUsd: 0 };
    var c = S.me.creator;

    return '' +
    '<div class="stack">' +
      '<div class="grid g3">' +
        '<div class="stat"><div class="k">Your total earnings</div><div class="v ok">' + money(t.paidUsd) + '</div><div class="s">paid to you so far</div></div>' +
        '<div class="stat"><div class="k">Pending</div><div class="v warnt">' + money(t.pendingUsd) + '</div><div class="s">approved at the end of the month</div></div>' +
        '<div class="stat"><div class="k">From your team</div><div class="v hi2">' + money(team.earnedUsd) + '</div><div class="s">' + money(M.TEAM_PER_PERSON) + " per person, once they are paid</div></div>" +
      "</div>" +

      '<section class="card">' +
        '<div class="eyebrow">' + icon(ICONS.earnings) + " Month by month</div>" +
        (rows.length === 0
          ? "<p>Nothing here yet. Your first month appears the moment it is signed off — finish " +
            M.QUALIFYING_DAYS + " posted days and it will be waiting.</p>"
          : '<div class="tablewrap"><table class="t"><thead><tr><th>Month</th><th>Period</th><th>Base</th><th>Bonus</th><th>Team</th><th>Status</th></tr></thead><tbody>' +
            rows.map(function (e) {
              var cls = e.status === "paid" ? "ok" : e.status === "cancelled" ? "bad-t" : "warnt";
              return "<tr><td>" + e.month_number + "</td><td style=\"color:var(--muted)\">" + fmt(e.period_start) + " – " + fmt(e.period_end) +
                "</td><td>" + money(e.base_usd) + "</td><td>" + money(e.bonus_usd) + "</td><td>" + money(e.team_usd) +
                '</td><td><span class="' + cls + '">' + esc(e.status) + "</span></td></tr>";
            }).join("") + "</tbody></table></div>") +
      "</section>" +

      '<section class="card ' + (c.payout_method ? "good" : "warn") + '">' +
        "<h3>" + (c.payout_method ? "You will be paid by " + esc(payoutLabel(c.payout_method)) : "No payout method chosen yet") + "</h3>" +
        "<p>You only fill in the account details when there is money to withdraw — there is nothing to enter until then. " +
        "Change the method any time.</p>" +
        '<button class="btn sm ghost" data-go="me">Change it in My details</button>' +
      "</section>" +

      '<section class="card"><div class="eyebrow">' + icon(ICONS.earnings) + " How the amount is decided</div>" +
        "<p>Month one pays <b>" + money(M.FIRST_MONTH_EXISTING) + "</b> on accounts you already had, or <b>" + money(M.FIRST_MONTH_NEW) +
        "</b> on brand-new ones, because a new account has no reach yet. From month two everyone is on the same ladder: <b>" +
        money(M.STEP) + " more every month</b>, up to <b>" + money(M.CEILING) + "</b>. Reach <b>" + M.VIEWS_TARGET.toLocaleString() +
        " views</b> in a month and <b>" + money(M.VIEWS_BONUS) + "</b> is added on top.</p></section>" +
    "</div>";
  }

  function payoutLabel(k) {
    var p = M.PAYOUTS.filter(function (x) { return x.key === k; })[0];
    return p ? p.label : k;
  }

  /* ── team ──────────────────────────────────────────────────────────────── */

  function viewTeam() {
    if (!S.me) return locked();
    var c = S.me.creator;
    var tt = S.me.teamTotals || { members: 0, earning: 0, earnedUsd: 0, pendingUsd: 0 };
    var link = location.origin + "/?ref=" + encodeURIComponent(c.referral_code || "");

    return '' +
    '<div class="stack">' +
      '<section class="card accent">' +
        '<div class="eyebrow">' + icon(ICONS.team) + " Build a team, earn together</div>" +
        "<h2>" + money(M.TEAM_PER_PERSON) + " for every person you bring, once they are paid</h2>" +
        "<p>Share your link or just give someone your code. Whoever joins through it is on your team, and the moment " +
        "one of them gets paid you earn <b>" + money(M.TEAM_PER_PERSON) + "</b> for that person. No limit, and it never " +
        "comes out of what they earn.</p>" +
        '<div class="row" style="margin-top:12px">' +
          '<input class="field mono" style="flex:1;min-width:240px" readonly value="' + esc(link) + '" id="teamLink" />' +
          '<button class="btn" data-act="copyLink">Copy link</button>' +
          '<button class="btn ghost" data-act="copyCode">Code: ' + esc(c.referral_code || "—") + "</button>" +
        "</div>" +
      "</section>" +

      '<div class="grid g3">' +
        '<div class="stat"><div class="k">People you brought</div><div class="v hi">' + tt.members + '</div><div class="s">joined through you</div></div>' +
        '<div class="stat"><div class="k">Earned from your team</div><div class="v ok">' + money(tt.earnedUsd) + '</div><div class="s">' + tt.earning + " of them have been paid</div></div>" +
        '<div class="stat"><div class="k">Waiting on them</div><div class="v warnt">' + money(tt.pendingUsd) + '</div><div class="s">yours once they are paid</div></div>' +
      "</div>" +

      '<section class="card">' +
        '<div class="eyebrow">' + icon(ICONS.team) + " Your team (" + (S.me.team || []).length + ")</div>" +
        ((S.me.team || []).length === 0
          ? "<p>Nobody yet. Send your link to one person who would enjoy this — that is how every team starts.</p>"
          : '<div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Code</th><th>Country</th><th>Joined</th><th>Status</th><th>You earn</th></tr></thead><tbody>' +
            S.me.team.map(function (m) {
              var st = m.paid ? '<span class="ok">Paid</span>' : m.started ? '<span class="hi">Posting</span>' : '<span style="color:var(--faint)">Not started</span>';
              return "<tr><td>" + esc(m.name) + '</td><td class="mono hi">' + esc(m.code || "—") + "</td><td style=\"color:var(--muted)\">" +
                esc(m.country || "—") + "</td><td style=\"color:var(--muted)\">" + fmt(m.joined) + "</td><td>" + st + "</td><td>" +
                (m.paid ? '<span class="ok">' + money(M.TEAM_PER_PERSON) + "</span>" : "—") + "</td></tr>";
            }).join("") + "</tbody></table></div>") +
      "</section>" +

      '<section class="card">' +
        '<div class="eyebrow">' + icon(ICONS.team) + " Someone joined without your link?</div>" +
        "<p>Swap codes and connect it here. Either of you can do it — pick the right way round, because that is what " +
        "decides who gets the " + money(M.TEAM_PER_PERSON) + ". A connection is written once and cannot be changed afterwards.</p>" +
        '<div class="row">' +
          '<button type="button" class="pill on" data-dir="they_referred_me" id="dirA">They referred me</button>' +
          '<button type="button" class="pill" data-dir="i_referred_them" id="dirB">I referred them</button>' +
        "</div>" +
        '<div class="row" style="margin-top:10px">' +
          '<input class="field mono" style="max-width:200px" id="teamCode" placeholder="Their code" maxlength="12" />' +
          '<button class="btn" data-act="connect">Connect</button>' +
        "</div>" +
      "</section>" +
    "</div>";
  }

  /* ── ideas ─────────────────────────────────────────────────────────────── */

  function viewIdeas() {
    return '' +
    '<div class="stack">' +
      '<section class="card accent">' +
        '<div class="eyebrow">' + icon(ICONS.ideas) + " Before anything else</div>" +
        "<p>Take a format that is already working — another creator, a video going viral in any niche — and " +
        "<b>rebuild it yourself</b>, in your own words, twisted to tell viewers about Magic Bots Lab. " +
        "You can post about anything as long as you turn it round to us. Never re-upload someone else's footage; " +
        "copied clips are exactly what gets accounts restricted.</p>" +
      "</section>" +

      '<div class="grid g2">' + M.IDEAS.map(function (i) {
        return '<section class="card"><h3 class="hi">' + esc(i.title) + "</h3>" +
          '<div style="margin-top:8px"><div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-2)">Hook</div>' +
          '<p style="margin:2px 0 8px">' + esc(i.hook) + "</p>" +
          '<div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)">Shot</div>' +
          '<p style="margin:2px 0 8px">' + esc(i.shot) + "</p>" +
          '<div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--success)">The turn</div>' +
          '<p style="margin:2px 0 0">' + esc(i.pivot) + "</p></div></section>";
      }).join("") + "</div>" +

      '<section class="card"><div class="eyebrow">' + icon(ICONS.rules) + " What you can say</div>" +
        "<p>Say these and you are on solid ground.</p>" +
        "<ul style=\"margin:0;padding-left:18px;color:var(--muted);font-size:13px;line-height:1.85\">" +
        M.TRUE_ABOUT.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></section>" +
    "</div>";
  }

  /* ── rules ─────────────────────────────────────────────────────────────── */

  function viewRules() {
    return '' +
    '<div class="stack">' +
      '<section class="card accent"><h2>Every video must tell viewers about Magic Bots Lab</h2>' +
        "<p>A video that does not clearly tell viewers about Magic Bots Lab does not count towards your " +
        M.QUALIFYING_DAYS + " days — even if it did well. Say the name, say what it does, or show a bot running while " +
        "you explain it. You never have to be on camera. And say the bots are <b>100% FREE</b> — every video, no " +
        "exceptions. People scroll past because they assume it costs money.</p></section>" +

      '<div class="grid g2">' +
        '<section class="card good"><div class="eyebrow" style="color:var(--success)">Always do this</div>' +
          "<ul style=\"margin:0;padding-left:18px;color:var(--muted);font-size:13px;line-height:1.85\">" +
          M.DO.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></section>" +
        '<section class="card bad"><div class="eyebrow" style="color:var(--danger)">Never do this</div>' +
          "<ul style=\"margin:0;padding-left:18px;color:var(--muted);font-size:13px;line-height:1.85\">" +
          M.DONT.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
          '<p style="margin-top:10px;font-size:11.5px">Copied clips are exactly what gets social media accounts restricted or banned.</p></section>' +
      "</div>" +

      '<section class="card"><div class="eyebrow">' + icon(ICONS.days) + " How often to post</div>" +
        '<div class="grid g3">' +
          '<div class="stat"><div class="k">Posted days 1–14</div><div class="v hi">1 a day</div><div class="s">a slow start builds reach</div></div>' +
          '<div class="stat"><div class="k">Posted days 15–' + M.QUALIFYING_DAYS + '</div><div class="v hi">2 a day</div><div class="s">and every month after</div></div>' +
          '<div class="stat"><div class="k">Each video</div><div class="v hi">' + M.PLATFORMS_REQUIRED + ' accounts</div><div class="s">minimum, not a limit</div></div>' +
        "</div>" +
        "<p style=\"margin-top:12px\">Videos should be 30 seconds to 2 minutes. Get paid to post — if your video tells " +
        "people about Magic Bots Lab, it counts. Stop overthinking it and start posting.</p></section>" +
    "</div>";
  }

  /* ── my details ────────────────────────────────────────────────────────── */

  function viewMe() {
    if (!S.me) return locked();
    var c = S.me.creator;

    return '' +
    '<div class="stack">' +
      '<section class="card good"><p style="color:var(--success);margin:0;font-size:12.5px">' +
        "Everything here saves itself as you change it — there is nothing to press.</p></section>" +

      '<section class="card"><h2>What you registered with</h2>' +
        '<div class="grid g3" style="margin-top:10px">' +
          stat("Name", esc(c.name)) + stat("Email", esc(c.email)) + stat("Country", esc(c.country)) +
          stat("Registered", fmt(c.created_at)) + stat("First post", c.first_post_at ? fmt(c.first_post_at) : "Not started") +
          stat("Your code", esc(c.referral_code || "—")) +
        "</div>" +
        '<p style="margin-top:10px;font-size:11.5px;color:var(--faint)">Name, email and country are fixed at registration. Message us if one of them is wrong.</p>' +
      "</section>" +

      '<section class="card"><h2>How you want to be paid</h2>' +
        "<p>Pick where the money should go. <b>You only fill in the account details when you have earnings to " +
        "withdraw</b> — there is nothing to enter until then.</p>" +
        payoutPicker(c.payout_method || "", "me-payout") +
      "</section>" +

      '<section class="card"><h2>Where you post</h2>' +
        "<p>" + M.PLATFORMS_REQUIRED + " platforms, yours to choose — remove one to swap in another. Paste the link to " +
        "each profile or just type the handle, either works. All " + M.PLATFORMS_REQUIRED + " must be filled in and " +
        "correct before you can be paid, because this is what we check your posts against.</p>" +
        '<div style="margin-top:10px">' + platformPicker() + "</div>" +
      "</section>" +

      '<section class="card"><h2>Are these accounts brand new?</h2>' +
        "<p>This only changes your first month: accounts you already had pay <b>" + money(M.FIRST_MONTH_EXISTING) +
        "</b>, accounts made new for this pay <b>" + money(M.FIRST_MONTH_NEW) + "</b>, because they have no reach yet. " +
        "From month two everyone is on the same ladder.</p>" +
        '<label class="check"><input type="checkbox" data-me="newAccounts"' + (c.new_accounts ? " checked" : "") + " />" +
        "<span>I made these accounts brand new for this.</span></label>" +
        '<p style="margin-top:10px;font-size:11.5px;color:var(--faint)">Ticked this by mistake? It does not matter. ' +
        "<b>We check every account ourselves before we pay you</b>, so what is set here never decides it on its own.</p>" +
      "</section>" +
    "</div>";
  }

  function stat(k, v) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v" style="font-size:14px;font-weight:600;word-break:break-word">' + v + "</div></div>";
  }

  function locked() {
    return '<section class="card warn"><h2>Join first</h2>' +
      "<p>This part opens the moment you register. It takes under a minute and you start the same day.</p>" +
      '<button class="btn" data-go="home">Go to the form</button></section>';
  }

  /* ── actions ───────────────────────────────────────────────────────────── */

  function register() {
    var f = S.form;
    if (!f.agreed) return toast("Tick the box to say you have read the rules.", true);
    if (S.platforms.length !== M.PLATFORMS_REQUIRED) return toast("Choose exactly " + M.PLATFORMS_REQUIRED + " platforms.", true);

    for (var i = 0; i < S.platforms.length; i++) {
      if (!(S.handles[S.platforms[i]] || "").trim()) return toast("Add your account link or handle for all three.", true);
    }

    S.busy = true; render();

    var ref = new URLSearchParams(location.search).get("ref") || localStorage.getItem("mbl_ref") || "";

    post("register", {
      name: f.name, email: f.email, country: f.country,
      newAccounts: f.newAccounts, payoutMethod: f.payout,
      platforms: S.platforms, handles: S.handles, refCode: ref
    }).then(function (r) {
      S.busy = false;
      if (!r.ok) { render(); return toast((r.data && r.data.error) || "Could not register you.", true); }
      localStorage.setItem(TOKEN_KEY, r.data.token);
      S.token = r.data.token;
      toast("You are in. Post your first video and your month starts.");
      S.view = "home";
      return load();
    }).catch(function () { S.busy = false; render(); toast("Could not reach us just now.", true); });
  }

  function saveProfile(patch, quiet) {
    return post("profile", Object.assign({ token: S.token }, patch)).then(function (r) {
      if (!r.ok) { toast((r.data && r.data.error) || "Could not save that.", true); return false; }
      if (!quiet) toast("Saved.");
      return load().then(function () { return true; });
    }).catch(function () { toast("Could not reach us just now.", true); return false; });
  }

  function logPost() {
    if (!S.log.platforms.length) return toast("Tick the accounts you posted it on.", true);
    S.busy = true; render();
    post("posts", { token: S.token, action: "log", day: S.log.day, platforms: S.log.platforms, link: S.log.link })
      .then(function (r) {
        S.busy = false;
        if (!r.ok) { render(); return toast((r.data && r.data.error) || "Could not log that.", true); }
        S.log = { platforms: [], link: "", day: today() };
        toast("Logged. That day is counted.");
        return load();
      }).catch(function () { S.busy = false; render(); toast("Could not reach us just now.", true); });
  }

  function toggleDay(day, on) {
    if (on) {
      // Untick: remove every post logged on that day, after asking — this is
      // the one control here that destroys something.
      if (!confirm("Remove everything logged on " + day + "? This cannot be undone.")) return;
      var ids = (S.me.posts || []).filter(function (p) { return p.posted_on === day; }).map(function (p) { return p.id; });
      var chain = Promise.resolve();
      ids.forEach(function (id) { chain = chain.then(function () { return post("posts", { token: S.token, action: "undo", postId: id }); }); });
      chain.then(function () { toast("Day removed."); return load(); });
      return;
    }
    post("posts", { token: S.token, action: "backfill", days: [day] }).then(function (r) {
      if (!r.ok) return toast((r.data && r.data.error) || "Could not add that day.", true);
      toast("Day added to your calendar.");
      return load();
    });
  }

  /* ── events, delegated from the root ───────────────────────────────────── */

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-go],[data-act],[data-drop],[data-pay],[data-lp],[data-undo],[data-day],[data-dir]");
    if (!el) return;

    if (el.dataset.go) { S.view = el.dataset.go; render(); document.getElementById("view").focus(); return; }

    if (el.dataset.drop) {
      S.platforms = S.platforms.filter(function (k) { return k !== el.dataset.drop; });
      delete S.handles[el.dataset.drop];
      if (S.me) saveProfile({ platforms: S.platforms }, true);
      render();
      return;
    }

    if (el.dataset.pay) {
      if (S.me) { saveProfile({ payoutMethod: el.dataset.pay }); }
      else { S.form.payout = el.dataset.pay; render(); toast(payoutLabel(el.dataset.pay) + " chosen."); }
      return;
    }

    if (el.dataset.lp) {
      var k = el.dataset.lp;
      var i = S.log.platforms.indexOf(k);
      if (i < 0) S.log.platforms.push(k); else S.log.platforms.splice(i, 1);
      render();
      return;
    }

    if (el.dataset.undo) {
      if (!confirm("Undo this video? It stops counting towards your month, and you cannot get it back.")) return;
      post("posts", { token: S.token, action: "undo", postId: el.dataset.undo }).then(function (r) {
        if (!r.ok) return toast((r.data && r.data.error) || "Could not undo that.", true);
        toast("Undone.");
        return load();
      });
      return;
    }

    if (el.dataset.day) { toggleDay(el.dataset.day, el.classList.contains("done")); return; }

    if (el.dataset.dir) {
      document.getElementById("dirA").classList.toggle("on", el.dataset.dir === "they_referred_me");
      document.getElementById("dirB").classList.toggle("on", el.dataset.dir === "i_referred_them");
      document.getElementById("dirA").dataset.chosen = el.dataset.dir === "they_referred_me" ? "1" : "";
      return;
    }

    var act = el.dataset.act;
    if (act === "register") return register();
    if (act === "log") return logPost();

    if (act === "copyLink" || act === "copyCode") {
      var c = S.me.creator;
      var value = act === "copyLink" ? location.origin + "/?ref=" + c.referral_code : c.referral_code;
      navigator.clipboard.writeText(value).then(
        function () { toast(act === "copyLink" ? "Link copied — put it in your bio." : "Code copied."); },
        function () { toast("Could not copy — select it and copy by hand.", true); }
      );
      return;
    }

    if (act === "connect") {
      var code = (document.getElementById("teamCode").value || "").trim().toUpperCase();
      var dir = document.getElementById("dirA").classList.contains("on") ? "they_referred_me" : "i_referred_them";
      if (code.length < 4) return toast("Type their code first.", true);
      post("team", { token: S.token, code: code, direction: dir }).then(function (r) {
        if (!r.ok) return toast((r.data && r.data.error) || "Could not connect that.", true);
        toast(dir === "they_referred_me" ? "You are now on " + r.data.name + "'s team" : r.data.name + " is now on your team");
        return load();
      });
    }
  });

  document.addEventListener("input", function (e) {
    var el = e.target;

    if (el.dataset.f) {
      S.form[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value;
      return; // no re-render: it would take the cursor out of the field
    }
    if (el.dataset.l) { S.log[el.dataset.l] = el.value; return; }

    if (el.dataset.h) {
      S.handles[el.dataset.h] = el.value;
      if (S.me) {
        clearTimeout(el._t);
        // A pause, because this one is typed rather than clicked.
        el._t = setTimeout(function () {
          var patch = {}; patch[el.dataset.h] = el.value;
          saveProfile({ handles: patch }, true);
        }, 900);
      }
    }
  });

  document.addEventListener("change", function (e) {
    var el = e.target;

    if (el.dataset.add && el.value) {
      if (S.platforms.length >= M.PLATFORMS_REQUIRED) {
        toast("Remove one first — " + M.PLATFORMS_REQUIRED + " at a time.", true);
        el.value = "";
        return;
      }
      S.platforms.push(el.value);
      if (S.me && S.platforms.length === M.PLATFORMS_REQUIRED) saveProfile({ platforms: S.platforms }, true);
      render();
      return;
    }

    if (el.dataset.me === "newAccounts") {
      saveProfile({ newAccounts: el.checked });
      return;
    }

    if (el.dataset.f === "newAccounts" || el.dataset.f === "agreed") {
      S.form[el.dataset.f] = el.checked;
    }
  });

  /* ── start ─────────────────────────────────────────────────────────────── */

  // Somebody arriving on a creator's link: remember the code even if they read
  // for ten minutes before joining.
  var ref = new URLSearchParams(location.search).get("ref");
  if (ref) { try { localStorage.setItem("mbl_ref", ref.toUpperCase()); } catch (e) {} }

  render();
  load();
})();
