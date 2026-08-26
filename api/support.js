/**
 * MAGIC BOTS LAB — support, from anywhere on the site to a phone.
 *
 * A creator stuck at eleven at night will not compose an email. They will type
 * one line into a box if there is a box. The answer comes back into that same
 * box — the owner swipe-replies in Telegram and it appears here. Where the
 * message lands on our side is not something they need to think about, and
 * nothing user-facing names it.
 *
 * This is a public endpoint, so it is a spam target. Two cheap defences: a
 * per-IP cooldown and a hard cap on length. The counters live in memory and
 * reset when the function goes cold — enough to stop a script hammering it,
 * not a claim to be more than that.
 */

const { readBody, json, recordSupportInbound, supportHistory } = require("./_lib/db");

const API = "https://api.telegram.org";
const COOLDOWN_MS = 20_000;
const MAX_PER_HOUR = 12;
const MAX_MESSAGE = 4000;

const seen = new Map();

function limited(ip) {
  const now = Date.now();
  const b = seen.get(ip) || { last: 0, count: 0, windowStart: now };

  if (now - b.windowStart > 3_600_000) { b.count = 0; b.windowStart = now; }
  if (now - b.last < COOLDOWN_MS) return "Give it a moment before sending another.";
  if (b.count >= MAX_PER_HOUR) return "That is a lot of messages. Try again a little later.";

  b.last = now; b.count += 1;
  seen.set(ip, b);

  if (seen.size > 5000) for (const [k, v] of seen) if (now - v.last > 3_600_000) seen.delete(k);
  return null;
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim());
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const esc = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");


/* Telegram's ceiling is 4096; leave room for the header and the new message. */
const HISTORY_BUDGET = 2200;
const LINE_CAP = 320;

/** Short and relative - an exact timestamp is noise when triaging. */
function when(iso) {
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.round(hrs / 24) + "d ago";
}

/**
 * The conversation so far, rendered for a phone screen.
 *
 * Oldest at the top so it reads downward, each turn labelled, and trimmed from
 * the OLDEST end when too long - the recent turns are the ones that explain the
 * message you are about to answer.
 */
function renderHistory(history) {
  if (!history || !history.length) return "";
  const out = [];
  let budget = HISTORY_BUDGET;

  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    const who = h.from === "us" ? "↩️ <b>You</b>" : "💬 <b>Them</b>";
    const body = h.body.length > LINE_CAP ? h.body.slice(0, LINE_CAP) + "…" : h.body;
    const line = who + " · " + when(h.at) + "\n" + esc(body);
    if (line.length > budget) { out.unshift("<i>…earlier messages not shown</i>"); break; }
    budget -= line.length;
    out.unshift(line);
  }

  return [
    "<b>─── Conversation so far (" + history.length + ") ───</b>",
    "",
    out.join("\n\n"),
    "",
    "<b>─── New message ───</b>",
  ].join("\n");
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const stop = limited(ip);
  if (stop) return json(res, 429, { error: stop });

  const body = await readBody(req);

  const message = str(body.message, MAX_MESSAGE + 1);
  const email = str(body.email, 200).toLowerCase();
  const name = str(body.name, 120);

  if (message.length < 2) return json(res, 400, { error: "Write your message first." });
  if (message.length > MAX_MESSAGE) return json(res, 400, { error: "That message is too long." });
  if (!isEmail(email)) return json(res, 400, { error: "Add the email address we should reply to." });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.error("[mbl] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set");
    return json(res, 502, { error: "We could not send that just now. Please try again in a minute." });
  }

  // The reply address leads, and is tappable — Telegram linkifies a mailto.
  // What we have already said to this person. Fetched BEFORE the new message is
  // recorded, so it is the conversation up to now and never includes itself.
  // A failure here costs context, not delivery - the message still goes.
  const history = await supportHistory(str(body.visitorId, 16));

  // Three blocks, blank line between each. filter(Boolean) drops the absent
  // optional fields, which is what it was for - but it was also eating the ""
  // separators, so the header ran straight into the message.
  const header = [
    `<b>${esc(str(body.source, 60) || "Magic Bots Lab")}</b>`,
    `<b>Reply to:</b> <a href="mailto:${esc(email)}">${esc(email)}</a>`,
    name ? `<b>Name:</b> ${esc(name)}` : "",
    str(body.country, 80) ? `<b>Country:</b> ${esc(str(body.country, 80))}` : "",
    str(body.page, 200) ? `<b>Page:</b> ${esc(str(body.page, 200))}` : "",
    str(body.visitorId, 16) ? `<b>Person:</b> <code>${esc(str(body.visitorId, 16))}</code>` : "",
  ].filter(Boolean).join("\n");

  const lines = [header, renderHistory(history), esc(message)].filter(Boolean);

  let messageId = null;
  try {
    const r = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: lines.join("\n\n"), parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) {
      console.error("[mbl] telegram refused:", r.status, await r.text().catch(() => ""));
      return json(res, 502, { error: "We could not send that just now. Please try again in a minute." });
    }
    const j = await r.json().catch(() => null);
    messageId = j && j.result && typeof j.result.message_id === "number" ? j.result.message_id : null;
  } catch (e) {
    console.error("[mbl] telegram unreachable:", e);
    return json(res, 502, { error: "We could not send that just now. Please try again in a minute." });
  }

  // Remember which Telegram message this became, so a swipe-reply to it can be
  // routed back to this person. Awaited but never fatal: the message has
  // already arrived, and failing now would tell them it had not. The cost of a
  // failure here is that one answer has to go by email instead.
  await recordSupportInbound({
    visitorId: str(body.visitorId, 16),
    body: message,
    tgMessageId: messageId,
    email,
    name,
    source: str(body.source, 60),
    page: str(body.page, 200),
  });

  return json(res, 200, { ok: true, email });
};
