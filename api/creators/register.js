const {
  select, insert, upsert, trim, isEmail, normaliseHandle, newToken,
  readBody, json, guard, dbFailed, CREATOR_FIELDS,
} = require("../_lib/db");

/**
 * REGISTER — a creator joins, and starts the same day.
 *
 * There is no approval queue and no waiting: the row is created active. What
 * has NOT started is the clock, because that begins at the first confirmed
 * post, not at registration — somebody who signs up and disappears for a week
 * has not lost a week.
 *
 * The response carries the access token, which is the only thing that will
 * ever identify this person again. The browser keeps it.
 */

const PLATFORMS_REQUIRED = 3;

module.exports = async (req, res) => {
  if (!guard(req, res)) return;

  const body = await readBody(req);

  const name = trim(body.name);
  const email = trim(body.email).toLowerCase();
  const country = trim(body.country);
  const platforms = Array.isArray(body.platforms) ? body.platforms.map(trim).filter(Boolean) : [];
  const handles = body.handles && typeof body.handles === "object" ? body.handles : {};
  const payoutMethod = trim(body.payoutMethod).toLowerCase();
  const newAccounts = body.newAccounts === true;
  const refCode = trim(body.refCode).toUpperCase();

  if (name.length < 2) return json(res, 400, { error: "Tell us your name." });
  if (!isEmail(email)) return json(res, 400, { error: "That email does not look right." });
  if (!country) return json(res, 400, { error: "Pick your country." });

  const picked = [...new Set(platforms)];
  if (picked.length !== PLATFORMS_REQUIRED) {
    return json(res, 400, { error: `Choose exactly ${PLATFORMS_REQUIRED} platforms to post on.` });
  }

  // Handles are optional here. Somebody joining on their phone may not have
  // their profile links to hand, and making them go and find three of them is
  // how a registration gets abandoned. They are required before the first post
  // is logged instead — which is the point they actually start to matter,
  // because that is when we begin checking the accounts.
  const cleaned = {};
  for (const p of picked) {
    const h = normaliseHandle(handles[p]);
    if (h) cleaned[p] = h;
  }

  // Already registered? Say so plainly rather than creating a second seat.
  const existing = await select("mbl_creators", `select=id&email=eq.${encodeURIComponent(email)}&limit=1`);

  // A failed lookup is not "no match" — if the schema is missing, say so here
  // rather than letting the insert fail with something nobody can read.
  if (!existing.ok) return dbFailed(res, Object.assign(new Error("lookup failed"), { dbCode: existing.error && existing.error.code }));

  if (existing.data && existing.data.length) {
    return json(res, 409, { error: "You are already registered with that email. Open your dashboard on the device you signed up on." });
  }

  // Whoever brought them, if they arrived on somebody's link.
  let referredBy = null;
  if (/^[A-Z0-9]{4,12}$/.test(refCode)) {
    const owner = await select("mbl_creators", `select=id&referral_code=eq.${encodeURIComponent(refCode)}&limit=1`);
    if (owner.ok && owner.data && owner.data[0]) referredBy = owner.data[0].id;
  }

  const token = newToken();
  const created = await insert("mbl_creators", {
    name, email, country,
    new_accounts: newAccounts,
    payout_method: payoutMethod || null,
    access_token: token,
    referred_by: referredBy,
  });

  if (!created.ok) {
    if (created.error && created.error.code === "23505") {
      return json(res, 409, { error: "You are already registered with that email." });
    }
    console.error("[mbl] register failed:", created.error);
    return json(res, 500, { error: "Could not register you just now. Please try again." });
  }

  const creator = Array.isArray(created.data) ? created.data[0] : created.data;

  // The handles, in their own table so one account cannot hold two seats.
  // A row per chosen platform either way: the handle is filled in later.
  const rows = picked.map((p) => ({ creator_id: creator.id, platform: p, handle: cleaned[p] || null }));
  const saved = await upsert("mbl_creator_handles", rows, "creator_id,platform");

  if (!saved.ok) {
    // A clash here means somebody else already registered that account. The
    // creator row would otherwise sit there orphaned and block their email.
    await require("../_lib/db").remove("mbl_creators", `id=eq.${creator.id}`);
    if (saved.error && saved.error.code === "23505") {
      return json(res, 409, { error: "One of those accounts is already registered by another creator." });
    }
    console.error("[mbl] handles failed:", saved.error);
    return json(res, 500, { error: "Could not save your accounts. Please try again." });
  }

  const full = await select("mbl_creators", `select=${CREATOR_FIELDS}&id=eq.${creator.id}&limit=1`);

  return json(res, 200, {
    ok: true,
    token,
    creator: full.ok && full.data ? full.data[0] : null,
  });
};
