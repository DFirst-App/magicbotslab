const { select, update, trim, readBody, json, guard, findCreator, dbFailed } = require("../_lib/db");

/**
 * TEAM — connecting two creators who missed the link.
 *
 * Somebody joins, then realises a friend told them about this and never used
 * their link. Either of them can fix it here, but they have to say which way
 * round it goes, because that is what decides who gets the $20.
 *
 * A connection is written once and never rewritten. Letting it be changed
 * later would let two people trade a code back and forth after one of them
 * has been paid.
 */

module.exports = async (req, res) => {
  if (!guard(req, res)) return;

  const body = await readBody(req);
  let me;
  // Without derivAccess a device that has no valid token of its own can load
  // the dashboard (me.js accepts it) but every action here would fail with
  // "no creator found" - exactly the dead end it was added to prevent.
  try { me = await findCreator(body.token, body.derivAccess); }
  catch (e) { return dbFailed(res, e); }
  if (!me) return json(res, 404, { error: "No creator found." });

  const code = trim(body.code).toUpperCase();
  const direction = trim(body.direction) || "they_referred_me";

  if (!/^[A-Z0-9]{4,12}$/.test(code)) return json(res, 400, { error: "That code does not look right." });
  if (code === me.referral_code) return json(res, 400, { error: "That is your own code." });

  const found = await select("mbl_creators", `select=id,name,referred_by&referral_code=eq.${encodeURIComponent(code)}&limit=1`);
  const other = found.ok && found.data && found.data[0] ? found.data[0] : null;
  if (!other) return json(res, 404, { error: "No one has that code." });

  if (direction === "they_referred_me") {
    if (me.referred_by) return json(res, 409, { error: "You are already on someone's team." });
    // They cannot be on your team and you on theirs.
    if (other.referred_by === me.id) return json(res, 409, { error: "They are already on your team." });

    const saved = await update("mbl_creators", `id=eq.${me.id}&referred_by=is.null`, { referred_by: other.id });
    if (!saved.ok || !saved.data || !saved.data.length) {
      return json(res, 409, { error: "That could not be connected. You may already be on a team." });
    }
    return json(res, 200, { ok: true, name: other.name });
  }

  if (direction === "i_referred_them") {
    if (other.referred_by) return json(res, 409, { error: "They are already on someone's team." });
    if (me.referred_by === other.id) return json(res, 409, { error: "You are already on their team." });

    const saved = await update("mbl_creators", `id=eq.${other.id}&referred_by=is.null`, { referred_by: me.id });
    if (!saved.ok || !saved.data || !saved.data.length) {
      return json(res, 409, { error: "That could not be connected. They may already be on a team." });
    }
    return json(res, 200, { ok: true, name: other.name });
  }

  return json(res, 400, { error: "Say which way round it goes." });
};
