/**
 * The support bot answering when you talk to it.
 *
 * It only ever needed to send. But a bot that sits silent when you press Start
 * is indistinguishable from one that is broken, so it says the wiring is live,
 * and otherwise says plainly that replies to creators go by email rather than
 * from that chat.
 *
 * Telegram posts here from the open internet, so the shared secret it was
 * registered with is checked on every call, and only the owner's own chat gets
 * a reply at all.
 */

const { readBody, json } = require("./_lib/db");

const API = "https://api.telegram.org";

async function say(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`${API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => { /* nothing useful to do about it here */ });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  // 200, not 401: a wrong caller should learn nothing, and Telegram must not
  // start retrying a delivery that was never ours.
  if (!secret || req.headers["x-telegram-bot-api-secret-token"] !== secret) return json(res, 200, { ok: true });

  const update = await readBody(req);
  const chatId = update && update.message && update.message.chat ? update.message.chat.id : null;
  const text = String((update && update.message && update.message.text) || "").trim();

  if (typeof chatId !== "number") return json(res, 200, { ok: true });
  if (String(chatId) !== process.env.TELEGRAM_CHAT_ID) return json(res, 200, { ok: true });

  if (/^\/start\b/.test(text)) {
    await say(chatId, [
      "<b>Magic Bots Lab support is connected.</b>",
      "",
      "Messages from the support bubble on magicbotslab.com will arrive here.",
      "",
      "Each one starts with the sender's email — reply to them from your email, not from this chat. Nothing you type here reaches anyone.",
    ].join("\n"));
  } else {
    await say(chatId, "Nothing you send here goes anywhere — reply by email instead, using the address at the top of their message.");
  }

  return json(res, 200, { ok: true });
};
