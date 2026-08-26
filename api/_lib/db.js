/**
 * MAGIC BOTS LAB — the only thing that touches the database.
 *
 * magicbotslab.com is a static site, so there is no server to hide a secret in
 * — except here. These functions run on Vercel with the Supabase service role
 * key, and the tables they read have RLS on with no policies, so this file is
 * the entire surface between a browser and the data. Nothing is trusted that
 * arrives in a request body except after it has been through `trim` and a
 * check below.
 *
 * No dependencies on purpose. PostgREST is a REST API and `fetch` is built in;
 * pulling in a client library would mean a build step on a site that does not
 * have one.
 */

const URL_BASE = process.env.SUPABASE_URL || "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/** Configured or not — checked once per request so failures are legible. */
function configured() {
  return !!(URL_BASE && KEY);
}

const headers = (extra) => ({
  apikey: KEY,
  Authorization: "Bearer " + KEY,
  "Content-Type": "application/json",
  ...extra,
});

/**
 * One PostgREST call. Returns { ok, status, data, error }.
 * `error.code` carries Postgres's own code — 23505 is a unique violation, which
 * is how "that account is already registered" is detected rather than guessed.
 */
async function rest(path, init = {}) {
  const res = await fetch(URL_BASE + "/rest/v1/" + path, {
    ...init,
    headers: headers(init.headers),
    cache: "no-store",
  });

  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }

  if (!res.ok) return { ok: false, status: res.status, data: null, error: body || { message: text } };
  return { ok: true, status: res.status, data: body, error: null };
}

const select = (table, query) => rest(`${table}?${query}`, { method: "GET" });

const insert = (table, row, prefer = "return=representation") =>
  rest(table, { method: "POST", headers: { Prefer: prefer }, body: JSON.stringify(row) });

const update = (table, query, patch) =>
  rest(`${table}?${query}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });

const upsert = (table, row, onConflict) =>
  rest(`${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });

const remove = (table, query) => rest(`${table}?${query}`, { method: "DELETE" });

/* ── the small amount of validation everything shares ────────────────────── */

const MAX = 120;
const trim = (v) => (typeof v === "string" ? v.trim().slice(0, MAX) : "");
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim());
const isToken = (v) => typeof v === "string" && /^[a-f0-9]{32,64}$/.test(v);

/**
 * Reduce whatever someone pastes to one canonical handle, so the uniqueness
 * index actually catches one person taking two seats:
 *
 *   https://www.tiktok.com/@JaneDoe?lang=en  ->  janedoe
 *   @JaneDoe                                 ->  janedoe
 */
function normaliseHandle(v) {
  let s = trim(v);
  if (!s) return null;

  s = s.split(/[?#]/)[0];
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  s = s.replace(/^(m|web)\./i, "");
  s = s.replace(/^(tiktok|instagram|facebook|fb|youtube|youtu\.be|snapchat)\.com\//i, "");
  s = s.replace(/^(channel|c|user|@)\//i, "");
  s = s.replace(/\/+$/, "");
  s = s.replace(/^@/, "");
  s = s.split("/").filter(Boolean).pop() || s;

  return s.toLowerCase().slice(0, 80) || null;
}

/** A token this browser keeps. 48 hex characters of real randomness. */
function newToken() {
  return require("crypto").randomBytes(24).toString("hex");
}

/* ── request plumbing ────────────────────────────────────────────────────── */

/** Vercel parses JSON bodies, but not always — be certain either way. */
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

const json = (res, status, body) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(body));
};

/**
 * Every route is POST-only and same-origin. Answering OPTIONS keeps a browser
 * from tripping over a preflight it should never need to send.
 */
function guard(req, res, methods = ["POST"]) {
  if (req.method === "OPTIONS") { res.status(204).end(); return false; }
  if (!methods.includes(req.method)) { json(res, 405, { error: "Method not allowed." }); return false; }
  if (!configured()) {
    console.error("[mbl] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
    json(res, 503, { error: "Not available right now." });
    return false;
  }
  return true;
}

/** The columns a creator is ever shown about themselves. */
const CREATOR_FIELDS =
  "id,name,email,country,new_accounts,status,payout_method,started_at,first_post_at,referral_code,referred_by,deriv_loginid,created_at";

/**
 * Find the creator behind a token.
 *
 * Returns the row, or null when the token means nothing — but THROWS when the
 * database itself is unreachable or the schema is missing. Those are not the
 * same thing, and quietly returning null for both is how "the migration was
 * never run" ends up looking like "your token expired" for a week.
 */
async function findCreator(token, derivAccess) {
  if (isToken(token)) {
    const r = await select("mbl_creators", `select=${CREATOR_FIELDS}&access_token=eq.${encodeURIComponent(token)}&limit=1`);

    if (!r.ok) {
      const err = new Error((r.error && r.error.message) || "database unavailable");
      err.dbCode = r.error && r.error.code;
      throw err;
    }
    if (Array.isArray(r.data) && r.data[0]) return r.data[0];
  }

  // No token, or one this browser has never had — the second-device case. Ask
  // Deriv which accounts the caller's own access token reaches, then look for a
  // creator recorded against one of them. Possession of a working token is the
  // proof; an account id on its own would not be.
  if (typeof derivAccess === "string" && derivAccess.trim().length > 20) {
    const { derivAccountIds } = require("./deriv");
    const ids = await derivAccountIds(derivAccess);
    if (ids.length) {
      const list = ids.map((x) => `"${x}"`).join(",");
      const r2 = await select("mbl_creators", `select=${CREATOR_FIELDS}&deriv_loginid=in.(${list})&limit=1`);
      if (r2.ok && Array.isArray(r2.data) && r2.data[0]) return r2.data[0];
    }
  }

  return null;
}

/**
 * Remember which Deriv account this is, so the same person is recognised on
 * their next device. Verified against Deriv rather than taken from the body,
 * and only ever written once — a creator cannot move their claim to another
 * account later.
 */
async function rememberDerivAccount(creator, derivAccess) {
  if (!creator || creator.deriv_loginid) return;
  if (typeof derivAccess !== "string" || derivAccess.trim().length <= 20) return;

  const { primaryDerivId } = require("./deriv");
  const id = await primaryDerivId(derivAccess);
  if (!id) return;

  await update("mbl_creators", `id=eq.${creator.id}&deriv_loginid=is.null`, { deriv_loginid: id });
}

/** The creator's own key, handed back when they were found some other way. */
async function tokenFor(creatorId) {
  const r = await select("mbl_creators", `select=access_token&id=eq.${creatorId}&limit=1`);
  return r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0].access_token : null;
}

/**
 * Turn a thrown database error into an honest response. PGRST205 means the
 * table is not there, which is a deployment problem and not the caller's
 * fault, so it says so rather than blaming their token.
 */
function dbFailed(res, e) {
  console.error("[mbl] database error:", e && e.dbCode, e && e.message);
  if (e && e.dbCode === "PGRST205") {
    return json(res, 503, { error: "The Creator Program is not finished being set up. Please try again shortly." });
  }
  return json(res, 503, { error: "Not available right now. Please try again in a minute." });
}


/* ── support threads ──────────────────────────────────────────────────────
 * The join between a visitor and the Telegram message their question became.
 * There is no account behind a support conversation: the only thing naming the
 * person is the random id their own browser minted, and the only thing tying
 * the owner's answer to them is the id of the message they replied to.
 *
 * Every one of these degrades quietly. Support is what people reach for when
 * something is already broken, so a database that is unreachable must never
 * turn the support form into a second failure — the message still reaches
 * Telegram, the reply just cannot be routed back on its own.
 */

const SUPPORT = "mbl_support_messages";

async function recordSupportInbound(m) {
  if (!m.visitorId) return;
  const r = await insert(SUPPORT, {
    visitor_id: m.visitorId,
    direction: "in",
    body: String(m.body || "").slice(0, 4000),
    tg_message_id: m.tgMessageId || null,
    email: m.email || null,
    name: m.name || null,
    source: m.source || null,
    page: m.page || null,
  });
  if (!r.ok) console.error("[mbl] could not record inbound support:", r.error);
}

/** Which visitor does this Telegram message belong to? Null when the owner
 *  replied to something that was never a support message — a normal thing to
 *  do, not an error. */
async function supportVisitorFor(tgMessageId) {
  const r = await select(SUPPORT, `select=visitor_id,email&tg_message_id=eq.${encodeURIComponent(tgMessageId)}&limit=1`);
  if (!r.ok) { console.error("[mbl] support reply lookup failed:", r.error); return null; }
  const row = r.data && r.data[0];
  return row ? { visitorId: row.visitor_id, email: row.email || null } : null;
}

/** Park the owner's reply for the visitor to collect. */
async function recordSupportReply(visitorId, body) {
  const r = await insert(SUPPORT, {
    visitor_id: visitorId,
    direction: "out",
    body: String(body || "").slice(0, 4000),
  });
  if (!r.ok) console.error("[mbl] could not record support reply:", r.error);
  return r.ok;
}

/** Everything waiting for this visitor, oldest first, marked as collected.
 *  Marking happens here rather than on a second call because the bubble has
 *  already drawn them by the time it could confirm, and showing an answer twice
 *  is worse than an optimistic delivery receipt. */
async function collectSupportReplies(visitorId) {
  if (!visitorId) return [];
  const r = await select(
    SUPPORT,
    `select=id,body,created_at&visitor_id=eq.${encodeURIComponent(visitorId)}&direction=eq.out&seen_at=is.null&order=created_at.asc&limit=20`,
  );
  if (!r.ok) { console.error("[mbl] collect failed:", r.error); return []; }
  const rows = r.data || [];
  if (!rows.length) return [];

  const ids = rows.map((x) => x.id).join(",");
  const marked = await update(SUPPORT, `id=in.(${ids})`, { seen_at: new Date().toISOString() });
  if (!marked.ok) console.error("[mbl] could not mark seen:", marked.error);

  return rows.map((x) => ({ id: x.id, body: x.body, createdAt: x.created_at }));
}


/** What has already been said to this person, oldest first.
 *
 *  Attached to their next message so the answer can be written without
 *  remembering them. With enough people asking at once, the difference between
 *  "who is this and what did I tell them" and simply reading down the screen is
 *  the difference between support that works and support that stalls. */
async function supportHistory(visitorId, limit) {
  if (!visitorId) return [];
  const r = await select(
    SUPPORT,
    `select=direction,body,created_at&visitor_id=eq.${encodeURIComponent(visitorId)}&order=created_at.desc&limit=${limit || 10}`,
  );
  if (!r.ok) { console.error("[mbl] support history failed:", r.error); return []; }
  // Newest-first so the LIMIT keeps the most recent, then reversed so it reads
  // like a conversation.
  return (r.data || []).reverse().map(function (x) {
    return { from: x.direction === "out" ? "us" : "them", body: x.body, at: x.created_at };
  });
}

module.exports = {
  rest, select, insert, update, upsert, remove,
  trim, isEmail, isToken, normaliseHandle, newToken,
  readBody, json, guard, findCreator, rememberDerivAccount, tokenFor, dbFailed, CREATOR_FIELDS, configured,
  recordSupportInbound, supportVisitorFor, recordSupportReply, collectSupportReplies, supportHistory,
};
