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
const {
  requestForTelegramMessage, requestForVisitor, pendingRequests, approveRequest, declineRequest,
  markAnswered, declineCount, PARTNER_ID, DERIV_PROFILE, DERIV_SIGNUP, EXAMPLE_CLIENT_ID,
} = require("./_lib/ea");

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
  // A photo or a document arrives with `caption` instead of `text`. Reading
  // only `text` makes a perfectly addressed screenshot look like an empty
  // message with no recipient.
  const text = String((msg && (msg.text || msg.caption)) || "").trim();

  if (typeof chatId !== "number") return json(res, 200, { ok: true });
  // A stranger who finds the bot is not someone we want putting words in front
  // of our visitors.
  if (String(chatId) !== process.env.TELEGRAM_CHAT_ID) return json(res, 200, { ok: true });

  const repliedTo = msg.reply_to_message && msg.reply_to_message.message_id;

  // ── a decision on an EA access request ──
  //
  // Three ways to address it: swipe-reply to any message from that person,
  // name the ID after the command, or send the bare command — which is what
  // tapping /approve in the request does, since Telegram sends a tapped command
  // as its own message with nothing attached. With one request waiting the
  // bare command needs no disambiguation; with several it asks rather than
  // guessing, because approving the wrong person cannot be taken back.
  const cmd = /^\/(approve|decline)(?:@[A-Za-z0-9_]+)?\b/i.exec(text);
  if (cmd) {
    const isApprove = /^approve$/i.test(cmd[1]);
    let reason = text.slice(cmd[0].length).trim();
    let reqst = null;

    if (repliedTo) {
      reqst = await requestForTelegramMessage(repliedTo);
      // The message replied to is usually NOT the request message once a
      // conversation has run on. Same person either way — use their request.
      if (!reqst) {
        const who = await supportVisitorFor(repliedTo);
        if (who) reqst = await requestForVisitor(who.visitorId);
      }
    } else {
      const named = reason.match(/^(\S{4,64})\b/);
      const waiting = await pendingRequests(20);

      if (named) {
        reqst = waiting.find((w) => w.mt5Login === named[1]) || null;
        if (!reqst) {
          await say(chatId, `Nothing is waiting for a decision with ID <code>${named[1]}</code>.`, msg.message_id);
          return json(res, 200, { ok: true });
        }
        reason = reason.slice(named[0].length).trim();
      } else if (waiting.length === 1) {
        reqst = waiting[0];
      } else if (waiting.length > 1) {
        await say(chatId, [
          `${waiting.length} requests are waiting. Say which one:`,
          "",
          ...waiting.slice(0, 8).map((w) => `- <code>${w.mt5Login}</code> — ${w.name} (${w.email})`),
          "",
          `Send <code>/${isApprove ? "approve" : "decline"} ${waiting[0].mt5Login}</code>, or swipe-reply to the one you mean.`,
        ].join("\n"), msg.message_id);
        return json(res, 200, { ok: true });
      } else {
        await say(chatId, "Nothing is waiting for a decision right now.", msg.message_id);
        return json(res, 200, { ok: true });
      }
    }

    if (!reqst) {
      const who = repliedTo ? await supportVisitorFor(repliedTo) : null;
      await say(chatId, who
        ? [
            `${who.email || "This person"} has never sent the EA form, so there is no request to ${isApprove ? "approve" : "decline"}.`,
            "",
            "Ask them to open the bot page and fill it in — then the request lands here and this command works.",
            "",
            "They are reachable meanwhile: anything you type here WITHOUT a slash goes to them as a normal reply.",
          ].join("\n")
        : "That is not an EA access request, so there is nothing to approve. Swipe-reply to the request itself, or to anything that person sent.",
        msg.message_id);
      return json(res, 200, { ok: true });
    }

    // A decision is about the person, so it settles every open row of theirs.
    const alsoSettled = await markAnswered(reqst.visitorId);

    if (isApprove) {
      const code = await approveRequest(reqst.id);
      if (!code) {
        await say(chatId, "⚠️ Could not issue a code just now. Nothing was sent — try again in a moment.", msg.message_id);
        return json(res, 200, { ok: true });
      }
      const delivered = await recordSupportReply(reqst.visitorId, [
        `Your ID ${reqst.mt5Login} is confirmed under our community — here is your download code:`,
        "", code, "",
        "Paste it into step 4 on the bot page to unlock the download. It works only on this browser.",
      ].join("\n"));
      await say(chatId, delivered
        ? `✅ Approved. Code <code>${code}</code> sent to ${reqst.name} (${reqst.email}), ID <code>${reqst.mt5Login}</code>.${alsoSettled > 1 ? ` Their ${alsoSettled - 1} other open request${alsoSettled === 2 ? "" : "s"} left the waiting list with it.` : ""}`
        : `⚠️ Code <code>${code}</code> was issued but could not be delivered. Send it to ${reqst.email} yourself.`,
        msg.message_id);
      return json(res, 200, { ok: true });
    }

    await declineRequest(reqst.id);
    const times = await declineCount(reqst.visitorId);
    const ASK = "\"Deriv support requires a full referral URL (from domains like track.deriv.com or t.deriv.link) instead of just the partner ID to link my MT5 account. Please provide the correct partner referral link.\"";

    // A repeat decline is not the first one said again. The first is two
    // messages, because it carries two different UUIDs — theirs to check, ours
    // to quote — and in one bubble they read as the same thing. The repeat is
    // one short message: they already know to check.
    let first, second = true;
    if (times > 1) {
      first = await recordSupportReply(reqst.visitorId, [
        `We checked again and ${reqst.mt5Login} is still not showing under our team.`,
        reason, "",
        "Deriv has to add it — we cannot do it from our side. Send them both of these:",
        "",
        `Partner ID: ${PARTNER_ID}`,
        `Referral link: ${DERIV_SIGNUP}`,
        "",
        `They usually ask for the link rather than the ID, so it helps to say: ${ASK}`,
        "",
        "Reply here once they confirm and we will check again.",
      ].filter((line, i) => i !== 1 || line !== "").join("\n"));
    } else {
      first = await recordSupportReply(reqst.visitorId, [
        `We could not find ID ${reqst.mt5Login} under our community, so we cannot send a code for it yet.`,
        reason, "",
        "First, check you sent the right one. Your own client ID is on your Deriv profile — open it, copy the ID shown there, and reply here with it:",
        DERIV_PROFILE, "",
        `(It looks like ${EXAMPLE_CLIENT_ID})`,
      ].filter((line, i) => i !== 1 || line !== "").join("\n"));
      second = await recordSupportReply(reqst.visitorId, [
        "If that ID was already the right one, then your account is not under us yet — and only Deriv can move it.",
        "",
        "Ask Deriv support to place your account under this partner ID:",
        PARTNER_ID, "",
        "That is OUR partner ID, not yours — give them that one.",
        "",
        `Deriv usually want the referral link rather than the ID, so send them this too: ${DERIV_SIGNUP}`,
        "",
        `If they ask for it, say: ${ASK}`,
        "",
        "Reply here once they confirm and we will check again.",
      ].join("\n"));
    }

    await say(chatId, (first && second)
      ? `Declined. ${reqst.name} (${reqst.email}) has been told, with the partner ID and referral link.${times > 1 ? ` This is decline #${times} for them — they got the follow-up wording, not the first one again.` : ""}${alsoSettled > 1 ? ` Their ${alsoSettled - 1} other open request${alsoSettled === 2 ? "" : "s"} left the waiting list with it.` : ""}`
      : `Declined, but the message could not be delivered — tell ${reqst.email} yourself.`,
      msg.message_id);
    return json(res, 200, { ok: true });
  }

  // ── a reply to a support message: deliver it ──
  if (repliedTo && text && text[0] !== "/") {
    const who = await supportVisitorFor(repliedTo);

    if (!who) {
      await say(chatId, "That is not a support message, so there is nobody to send it to. Swipe-reply to the message from the person you want to answer.", msg.message_id);
      return json(res, 200, { ok: true });
    }

    const stored = await recordSupportReply(who.visitorId, text);
    // Answering somebody IS dealing with them: their EA request leaves the
    // waiting list. It decides nothing — /approve and /decline still work.
    const cleared = stored ? await markAnswered(who.visitorId) : 0;
    await say(
      chatId,
      stored
        ? [
            `✅ Delivered to <code>${who.visitorId}</code>. They will see it in the support window on the site${who.email ? ` — ${who.email}` : ""}.`,
            cleared ? "Their EA request is off the waiting list — you have answered them. <code>/approve</code> or <code>/decline</code> still work on it from any message of theirs." : "",
          ].filter(Boolean).join("\n")
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
      "",
      "<b>MT5 EA requests:</b> send <code>/approve</code> to issue a download code, or <code>/decline your reason</code> to turn it down. Tapping the command in the request works, and so does typing it — no reply needed while only one request is waiting. With several waiting, add the ID: <code>/approve 12345678</code>. Anybody already approved or already answered is not listed.",
    ].join("\n"));
  } else if (/^\/(help|status)\b/.test(text)) {
    await say(chatId, "Swipe-reply to a support message to answer it. For an MT5 EA request send /approve or /decline — you only need to name an ID when several are waiting. A message with no reply attached has no recipient.");
  } else {
    await say(chatId, "Nothing was sent — I could not tell who that was for. <b>Swipe-reply</b> to someone's support message to answer them.");
  }

  return json(res, 200, { ok: true });
};
