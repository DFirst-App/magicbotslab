const {
  select, update, upsert, remove, trim, normaliseHandle,
  readBody, json, guard, findCreator, dbFailed,
} = require("../_lib/db");

/**
 * PROFILE — the things a creator is allowed to change about themselves.
 *
 * Platforms, handles, how they want to be paid, and whether the accounts are
 * brand new. Not their name, email, country or dates: letting the browser
 * rewrite those would let somebody move their own start date, and the whole
 * programme is measured from it.
 *
 * Every field is optional. The dashboard saves as you type, so most calls here
 * carry exactly one thing.
 */

const PLATFORMS_REQUIRED = 3;
const PAYOUT_METHODS = ["usdt", "paypal", "skrill", "venmo", "cashapp", "mpesa", "wise", "payoneer"];

module.exports = async (req, res) => {
  if (!guard(req, res)) return;

  const body = await readBody(req);
  let creator;
  // Without derivAccess a device that has no valid token of its own can load
  // the dashboard (me.js accepts it) but every action here would fail with
  // "no creator found" - exactly the dead end it was added to prevent.
  try { creator = await findCreator(body.token, body.derivAccess); }
  catch (e) { return dbFailed(res, e); }
  if (!creator) return json(res, 404, { error: "No creator found." });

  const id = creator.id;

  // ── which platforms they post on ─────────────────────────────────────────
  if (Array.isArray(body.platforms)) {
    const picked = [...new Set(body.platforms.map(trim).filter(Boolean))];
    if (picked.length !== PLATFORMS_REQUIRED) {
      return json(res, 400, { error: `Choose exactly ${PLATFORMS_REQUIRED} platforms to post on.` });
    }

    // Drop the ones they removed, keeping the handles they already gave for
    // the ones they kept — retyping a handle you never changed is a small
    // insult the interface does not need to make.
    const list = picked.map((p) => `"${p}"`).join(",");
    await remove("mbl_creator_handles", `creator_id=eq.${id}&platform=not.in.(${list})`);
    await upsert("mbl_creator_handles", picked.map((p) => ({ creator_id: id, platform: p })), "creator_id,platform");
  }

  // ── the handles themselves ───────────────────────────────────────────────
  if (body.handles && typeof body.handles === "object") {
    const chosen = await select("mbl_creator_handles", `select=platform&creator_id=eq.${id}`);
    const allowed = new Set((chosen.ok && chosen.data ? chosen.data : []).map((h) => h.platform));

    for (const [platform, raw] of Object.entries(body.handles)) {
      // Silently ignore a handle for a platform they are not posting on rather
      // than storing something the dashboard will never show them.
      if (!allowed.has(platform)) continue;

      const saved = await upsert(
        "mbl_creator_handles",
        { creator_id: id, platform, handle: normaliseHandle(raw) },
        "creator_id,platform",
      );

      if (!saved.ok) {
        if (saved.error && saved.error.code === "23505") {
          return json(res, 409, { error: "That account is already registered by another creator." });
        }
        console.error("[mbl] handle save failed:", saved.error);
        return json(res, 500, { error: "Could not save that. Please try again." });
      }
    }
  }

  // ── the row itself ───────────────────────────────────────────────────────
  const patch = {};

  if (typeof body.newAccounts === "boolean") patch.new_accounts = body.newAccounts;

  if (body.payoutMethod !== undefined) {
    const m = trim(body.payoutMethod).toLowerCase();
    if (!PAYOUT_METHODS.includes(m)) return json(res, 400, { error: "Pick one of the payout methods listed." });
    patch.payout_method = m;
  }

  if (Object.keys(patch).length) {
    const saved = await update("mbl_creators", `id=eq.${id}`, patch);
    if (!saved.ok) {
      console.error("[mbl] profile save failed:", saved.error);
      return json(res, 500, { error: "Could not save that. Please try again." });
    }
  }

  return json(res, 200, { ok: true });
};
