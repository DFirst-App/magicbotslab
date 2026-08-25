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
  "id,name,email,country,new_accounts,status,payout_method,started_at,first_post_at,referral_code,referred_by,created_at";

/**
 * Find the creator behind a token.
 *
 * Returns the row, or null when the token means nothing — but THROWS when the
 * database itself is unreachable or the schema is missing. Those are not the
 * same thing, and quietly returning null for both is how "the migration was
 * never run" ends up looking like "your token expired" for a week.
 */
async function findCreator(token) {
  if (!isToken(token)) return null;

  const r = await select("mbl_creators", `select=${CREATOR_FIELDS}&access_token=eq.${encodeURIComponent(token)}&limit=1`);

  if (!r.ok) {
    const err = new Error((r.error && r.error.message) || "database unavailable");
    err.dbCode = r.error && r.error.code;
    throw err;
  }

  return Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
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

module.exports = {
  rest, select, insert, update, upsert, remove,
  trim, isEmail, isToken, normaliseHandle, newToken,
  readBody, json, guard, findCreator, dbFailed, CREATOR_FIELDS, configured,
};
