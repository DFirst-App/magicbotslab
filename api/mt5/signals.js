/**
 * LIVE SIGNALS — for the General MT5 page AND for the EA on every terminal.
 *
 * The EA whitelists https://magicbotslab.com/ in WebRequest and polls this
 * address for its signals as CSV (format=csv); the page reads the same feed as
 * JSON. Both come from the engine behind this site: one server-side fetch,
 * passed through with a short cache so a page left open and a hundred
 * terminals polling do not each hit the engine on their own.
 *
 * The CSV is the EA's contract and is passed through byte for byte apart from
 * the first comment line, which names the feed. The EA reads ts= and the caps
 * from the comment lines, so those are never touched. The cache here (25s) plus
 * the engine's own is well inside the EA's 180-second staleness guard.
 */

const { json } = require("../_lib/db");

const ENGINE = process.env.MT5_SIGNAL_ENGINE || "https://www.clunoid.com/api/deriv/mt5/signals";
const PROFILES = new Set(["conservative", "moderate", "aggressive"]);

let cache = new Map();

module.exports = async (req, res) => {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });

  const url = new URL(req.url, "http://x");
  const profile = url.searchParams.get("profile") || "aggressive";
  if (!PROFILES.has(profile)) return json(res, 400, { error: "invalid profile" });
  const categories = (url.searchParams.get("categories") || "forex,volatility")
    .split(",").filter((c) => /^[a-z_]+$/.test(c)).join(",") || "forex,volatility";

  const csv = url.searchParams.get("format") === "csv";
  const key = `${profile}:${categories}:${csv ? "csv" : "json"}`;
  const hit = cache.get(key);

  const sendCsv = (text) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(text);
  };

  if (hit && Date.now() - hit.at < 25000) {
    res.setHeader("Cache-Control", "no-store");
    return csv ? sendCsv(hit.data) : json(res, 200, hit.data);
  }

  try {
    const r = await fetch(`${ENGINE}?profile=${profile}&categories=${categories}${csv ? "&format=csv" : ""}`, { cache: "no-store" });
    if (csv) {
      const text = await r.text();
      if (!r.ok) throw new Error(`engine ${r.status}`);
      // Only the feed's name on the first line changes; ts= and caps stay put.
      const named = text.replace(/^#\s*\S+\s+mt5\b/, "# magicbotslab mt5");
      cache.set(key, { at: Date.now(), data: named });
      return sendCsv(named);
    }
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `engine ${r.status}`);
    cache.set(key, { at: Date.now(), data });
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, data);
  } catch (e) {
    if (hit) return csv ? sendCsv(hit.data) : json(res, 200, hit.data);
    console.error("[mt5] signals unavailable:", e);
    if (csv) { res.statusCode = 502; res.setHeader("Content-Type", "text/plain"); return res.end(""); }
    return json(res, 502, { error: "Couldn't load signals." });
  }
};
