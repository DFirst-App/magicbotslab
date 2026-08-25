const {
  select, insert, update, remove, trim,
  readBody, json, guard, findCreator, dbFailed,
} = require("../_lib/db");

/**
 * POSTS — logging a video, and the clock that starts with the first one.
 *
 * Three actions, chosen by `action`:
 *
 *   log    — a video went live today (or on a day they are backfilling)
 *   undo   — that was a mistake
 *   backfill — tick the days they posted on but forgot to log
 *
 * The first successful log is what sets first_post_at, and therefore day 1.
 * Registration does not. Somebody who joins on a Monday and posts on a Friday
 * has a month that ends four days later, which is the honest way to count it.
 */

const MAX_SLOTS = 2;

/** Dates are handled as plain YYYY-MM-DD — no timezone can shift a day. */
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const today = () => new Date().toISOString().slice(0, 10);

module.exports = async (req, res) => {
  if (!guard(req, res)) return;

  const body = await readBody(req);
  let creator;
  try { creator = await findCreator(body.token); }
  catch (e) { return dbFailed(res, e); }
  if (!creator) return json(res, 404, { error: "No creator found." });

  const id = creator.id;
  const action = trim(body.action) || "log";

  /* ── undo ──────────────────────────────────────────────────────────────── */
  if (action === "undo") {
    const postId = trim(body.postId);
    if (!/^[0-9a-f-]{36}$/i.test(postId)) return json(res, 400, { error: "Nothing to undo." });

    const gone = await remove("mbl_creator_posts", `id=eq.${postId}&creator_id=eq.${id}`);
    if (!gone.ok) return json(res, 500, { error: "Could not undo that. Please try again." });

    // If they undid the only post they ever logged, the clock has not started
    // after all. Leaving first_post_at set would run a month they never began.
    const left = await select("mbl_creator_posts", `select=posted_on&creator_id=eq.${id}&order=posted_on&limit=1`);
    const earliest = left.ok && left.data && left.data[0] ? left.data[0].posted_on : null;
    await update("mbl_creators", `id=eq.${id}`, { first_post_at: earliest ? earliest + "T00:00:00Z" : null });

    return json(res, 200, { ok: true, undone: true });
  }

  /* ── backfill ──────────────────────────────────────────────────────────── */
  if (action === "backfill") {
    const days = Array.isArray(body.days) ? body.days.filter(isDay).slice(0, 60) : [];
    if (!days.length) return json(res, 400, { error: "Pick the days you posted on." });

    const now = today();
    if (days.some((d) => d > now)) return json(res, 400, { error: "You cannot tick a day that has not happened yet." });

    // One row per day, slot 1 — a backfilled day counts as a day they posted,
    // not as a claim about how many videos went out on it.
    const rows = days.map((d) => ({ creator_id: id, posted_on: d, slot: 1, platforms: [] }));
    const saved = await insert("mbl_creator_posts", rows, "resolution=ignore-duplicates,return=representation");
    if (!saved.ok) {
      console.error("[mbl] backfill failed:", saved.error);
      return json(res, 500, { error: "Could not save those days. Please try again." });
    }

    await startClock(id, creator, days.slice().sort()[0]);
    return json(res, 200, { ok: true, added: Array.isArray(saved.data) ? saved.data.length : 0 });
  }

  /* ── log ───────────────────────────────────────────────────────────────── */
  const day = isDay(body.day) ? body.day : today();
  if (day > today()) return json(res, 400, { error: "You cannot log a day that has not happened yet." });

  const platforms = Array.isArray(body.platforms) ? [...new Set(body.platforms.map(trim).filter(Boolean))] : [];
  if (!platforms.length) return json(res, 400, { error: "Tick the accounts you posted it on." });

  const link = trim(body.link) || null;

  // Which slot: the first free one that day.
  const same = await select("mbl_creator_posts", `select=slot&creator_id=eq.${id}&posted_on=eq.${day}`);
  const used = new Set((same.ok && same.data ? same.data : []).map((p) => p.slot));
  let slot = 0;
  for (let i = 1; i <= MAX_SLOTS; i++) if (!used.has(i)) { slot = i; break; }
  if (!slot) return json(res, 409, { error: "You have already logged two videos for that day." });

  const saved = await insert("mbl_creator_posts", { creator_id: id, posted_on: day, slot, platforms, link });
  if (!saved.ok) {
    if (saved.error && saved.error.code === "23505") {
      return json(res, 409, { error: "That one is already logged." });
    }
    console.error("[mbl] log failed:", saved.error);
    return json(res, 500, { error: "Could not log that. Please try again." });
  }

  await startClock(id, creator, day);

  return json(res, 200, { ok: true, post: Array.isArray(saved.data) ? saved.data[0] : saved.data });
};

/**
 * Day 1 is the earliest day they have posted on — including one they only just
 * backfilled, which can be earlier than the day they first pressed the button.
 */
async function startClock(id, creator, day) {
  const current = creator.first_post_at ? String(creator.first_post_at).slice(0, 10) : null;
  if (current && current <= day) return;
  await update("mbl_creators", `id=eq.${id}`, { first_post_at: day + "T00:00:00Z" });
}
