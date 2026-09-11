/**
 * LIVE SIGNALS for the General MT5 page — fetched from the clunoid.com engine.
 *
 * The EA itself asks clunoid.com for its signals as it trades, so the page
 * shows the same feed the bot acts on. That endpoint does not answer browsers
 * on other origins, so this proxies it: one server-side fetch, passed through
 * with a short cache so a page left open does not hit the engine every minute
 * from every visitor.
 *
 * Nothing is reshaped. What the engine says is what the page shows, and what
 * the EA on the person's terminal will act on.
 */

const { json } = require("../_lib/db");

const ENGINE = "https://www.clunoid.com/api/deriv/mt5/signals";
const PROFILES = new Set(["conservative", "moderate", "aggressive"]);

let cache = new Map();

module.exports = async (req, res) => {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });

  const url = new URL(req.url, "http://x");
  const profile = url.searchParams.get("profile") || "aggressive";
  if (!PROFILES.has(profile)) return json(res, 400, { error: "invalid profile" });
  const categories = (url.searchParams.get("categories") || "forex,volatility")
    .split(",").filter((c) => /^[a-z_]+$/.test(c)).join(",") || "forex,volatility";

  const key = `${profile}:${categories}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 25000) {
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, hit.data);
  }

  try {
    const r = await fetch(`${ENGINE}?profile=${profile}&categories=${categories}`, { cache: "no-store" });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `engine ${r.status}`);
    cache.set(key, { at: Date.now(), data });
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, data);
  } catch (e) {
    if (hit) return json(res, 200, hit.data);
    console.error("[mt5] signals unavailable:", e);
    return json(res, 502, { error: "Couldn't load signals." });
  }
};
