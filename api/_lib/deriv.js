/**
 * MAGIC BOTS LAB — proving who somebody is by their Deriv account.
 *
 * A creator on a second device has no token, and their email is already taken,
 * so without this they are stuck on an error for something they did nothing
 * wrong to cause. The way out is the one thing that follows them between
 * devices: the Deriv account they connected.
 *
 * The important part is that the browser is never believed. It sends the Deriv
 * ACCESS TOKEN it holds, and we ask Deriv which accounts that token reaches.
 * Anyone can type an account id; only the real owner has a working token for
 * one. So this is authentication, not a lookup.
 */

const APP_ID = "338udJBKn1EbT7Tc29Snv";
const REST_BASE = "https://api.derivws.com";

/** Every real options account this access token can reach, lowercased. */
async function derivAccountIds(accessToken) {
  const token = typeof accessToken === "string" ? accessToken.trim() : "";
  if (token.length < 20) return [];

  try {
    const res = await fetch(`${REST_BASE}/trading/v1/options/accounts`, {
      headers: { Authorization: `Bearer ${token}`, "Deriv-App-ID": APP_ID },
      // Never serve a cached answer for something used as identity.
      cache: "no-store",
    });
    if (!res.ok) return [];

    const json = await res.json().catch(() => null);
    const rows = (json && json.data) || [];

    return rows
      // Demo accounts are handed out freely and prove nothing about a person.
      .filter((a) => !/demo|virtual/i.test(a.account_type || "") && !/^vr/i.test(a.account_id || ""))
      .map((a) => String(a.account_id || "").trim().toLowerCase())
      .filter(Boolean);
  } catch (e) {
    console.error("[mbl] deriv identity lookup failed:", e);
    return [];
  }
}

/** The one stored against a creator: their first real options account. */
async function primaryDerivId(accessToken) {
  const ids = await derivAccountIds(accessToken);
  return ids[0] || null;
}

module.exports = { derivAccountIds, primaryDerivId };
