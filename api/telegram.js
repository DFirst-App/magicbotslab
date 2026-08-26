/**
 * The support bot, and the way back to the person who asked.
 *
 * Support messages arrive in Telegram. To answer one, swipe-reply to it: the
 * reply is delivered to that visitor in the support bubble on the site, usually
 * within seconds. Telegram tells us which message was replied to, and that id
 * is what identifies the visitor — so the swipe is not a nicety, it IS the
 * addressing. A message typed into the chat without replying to anything has no
 * recipient, and the bot says so rather than swallowing it.
 *
 * Telegram posts here from the open internet, so the shared secret it was
 * registered with is checked on every call, and only the owner's own chat is
 * listened to at all.
 */

const { readBody, json, supportVisitorFor, recordSupportReply } = require("./_lib/db");

const API = "https://api.telegram.org";

async function say(chatId, text, replyTo) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const payload = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyTo) { payload.reply_to_message_id = replyTo; payload.allow_sending_without_reply = true; }
  await fetch(`${API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => { /* nothing useful to do about it here */ });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  // 200, not 401: a wrong caller should learn nothing, and Telegram must not
  // start retrying a delivery that was never ours.
  if (!secret || req.headers["x-telegram-bot-api-secret-token"] !== secret) return json(res, 200, { ok: true });

  const update = await readBody(req);
  const msg = (update && update.message) || null;
  const chatId = msg && msg.chat ? msg.chat.id : null;
  const text = String((msg && msg.text) || "").trim();

  if (typeof chatId !== "number") return json(res, 200, { ok: true });
  // A stranger who finds the bot is not someone we want putting words in front
  // of our visitors.
  if (String(chatId) !== process.env.TELEGRAM_CHAT_ID) return json(res, 200, { ok: true });

  // ── a reply to a support message: deliver it ──
  const repliedTo = msg.reply_to_message && msg.reply_to_message.message_id;
  if (repliedTo && text && text[0] !== "/") {
    const who = await supportVisitorFor(repliedTo);

    if (!who) {
      await say(chatId, "That is not a support message, so there is nobody to send it to. Swipe-reply to the message from the person you want to answer.", msg.message_id);
      return json(res, 200, { ok: true });
    }

    const stored = await recordSupportReply(who.visitorId, text);
    await say(
      chatId,
      stored
        ? `✅ Delivered to <code>${who.visitorId}</code>. They will see it in the support window on the site${who.email ? ` — ${who.email}` : ""}.`
        : "⚠️ Could not deliver that just now. Nothing was sent — try again in a moment.",
      msg.message_id,
    );
    return json(res, 200, { ok: true });
  }

  // ── commands and stray messages ──
  if (/^\/start\b/.test(text)) {
    await say(chatId, [
      "<b>Magic Bots Lab support is connected.</b>",
      "",
      "Messages from the support bubble on magicbotslab.com arrive here.",
      "",
      "<b>To answer someone, swipe-reply to their message.</b> Your reply appears in their support window on the site within seconds.",
      "",
      "Typing here without replying to a message sends it nowhere — there is no way to tell who it was meant for.",
    ].join("\n"));
  } else if (/^\/(help|status)\b/.test(text)) {
    await say(chatId, "Swipe-reply to a support message to answer it. The reply is delivered to that person on the site. A message with no reply attached has no recipient.");
  } else {
    await say(chatId, "Nothing was sent — I could not tell who that was for. <b>Swipe-reply</b> to someone's support message to answer them.");
  }

  return json(res, 200, { ok: true });
};
