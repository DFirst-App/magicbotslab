const { select, readBody, json, guard, findCreator, dbFailed } = require("../_lib/db");

/**
 * ME — everything the dashboard draws, in one call.
 *
 * The creator, their accounts, what they have posted, what they have earned,
 * and their team. One round trip rather than five, because this is the first
 * thing that happens on every page load and a dashboard that arrives in pieces
 * feels broken even when it is not.
 */

/** $20 for each person you brought, once that person has been paid. */
const TEAM_PER_PERSON_USD = 20;

module.exports = async (req, res) => {
  if (!guard(req, res)) return;

  const { token } = await readBody(req);
  let creator;
  try { creator = await findCreator(token); }
  catch (e) { return dbFailed(res, e); }
  if (!creator) return json(res, 404, { error: "No creator found." });

  const id = creator.id;

  const [handles, posts, earnings, team] = await Promise.all([
    select("mbl_creator_handles", `select=platform,handle&creator_id=eq.${id}&order=platform`),
    select("mbl_creator_posts", `select=id,posted_on,slot,platforms,link,created_at&creator_id=eq.${id}&order=posted_on.desc,slot.desc`),
    select("mbl_creator_earnings", `select=*&creator_id=eq.${id}&order=month_number`),
    // Their team: name, country and code are theirs to see; nothing else is.
    select("mbl_creators", `select=name,country,referral_code,first_post_at,created_at,id&referred_by=eq.${id}&order=created_at`),
  ]);

  const earningRows = earnings.ok && Array.isArray(earnings.data) ? earnings.data : [];
  const teamRows = team.ok && Array.isArray(team.data) ? team.data : [];

  // Which of the people they brought have actually been paid — that is what
  // turns a team member into $20.
  let paidIds = [];
  if (teamRows.length) {
    const ids = teamRows.map((m) => m.id).join(",");
    const paid = await select("mbl_creator_earnings", `select=creator_id&status=eq.paid&creator_id=in.(${ids})`);
    if (paid.ok && Array.isArray(paid.data)) paidIds = [...new Set(paid.data.map((r) => r.creator_id))];
  }

  const num = (v) => Number(v || 0);
  const totals = earningRows.reduce(
    (acc, e) => {
      const amount = num(e.base_usd) + num(e.bonus_usd) + num(e.team_usd);
      if (e.status === "paid") acc.paidUsd += amount;
      else if (e.status !== "cancelled") acc.pendingUsd += amount;
      return acc;
    },
    { paidUsd: 0, pendingUsd: 0 },
  );

  const members = teamRows.map((m) => ({
    name: m.name,
    country: m.country,
    code: m.referral_code,
    joined: m.created_at,
    started: !!m.first_post_at,
    paid: paidIds.includes(m.id),
  }));

  const earning = members.filter((m) => m.paid).length;

  return json(res, 200, {
    ok: true,
    creator,
    handles: handles.ok && handles.data ? handles.data : [],
    posts: posts.ok && posts.data ? posts.data : [],
    earnings: earningRows,
    totals,
    team: members,
    teamTotals: {
      members: members.length,
      earning,
      perPersonUsd: TEAM_PER_PERSON_USD,
      earnedUsd: earning * TEAM_PER_PERSON_USD,
      pendingUsd: (members.length - earning) * TEAM_PER_PERSON_USD,
    },
    serverTime: new Date().toISOString(),
  });
};
