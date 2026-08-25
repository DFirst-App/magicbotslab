# Creator Program — what it is and how to switch it on

`creators.html` is the whole thing: a dashboard a visitor lands on, joins from,
and then works out of. There is no separate registration page — the form lives
on the Home tab, and the sections around it are visible but locked until they
register, so nobody has to guess what they are signing up to.

## The parts

| File | What it is |
|---|---|
| `creators.html` | The shell — rail, top bar, and the view the JS fills |
| `creators.css` | Design tokens shared with the trading dashboard, plus the rail |
| `creators.js` | State, the eight views, and every action |
| `creators-content.js` | The money, the cadence, the rules, the ideas — the wording lives here |
| `creators-countries.js` | The country list for the picker |
| `creators-support.js` | The support bubble |
| `api/creators/*.js` | Register, me, profile, posts, team |
| `api/support.js` | Support messages |
| `api/telegram.js` | The bot answering when you press Start |
| `api/_lib/db.js` | The only thing that talks to the database |
| `supabase/migrations/` | The schema (already applied) |

## The money

| | |
|---|---|
| First month, accounts you already had | **$100** |
| First month, brand-new accounts | **$50** |
| Every month after | **+$50**, up to **$750** |
| 10,000 views in a month | **+$500** |
| Per person you bring, once they are paid | **$20** |

A month is **28 days the creator actually posted** — 30 days with 2 grace days.
Posted days 1–14 want one video a day; 15–28 want two. Three accounts minimum
per video; the same video on all three counts as one day.

## What you must set

The database is done. Two things are not, because they live in accounts this
machine cannot reach.

### 1. Environment variables on Vercel

Project → Settings → Environment Variables. Add all five to **Production,
Preview and Development**, then redeploy. None of them may be prefixed
`NEXT_PUBLIC_`.

```
SUPABASE_URL=https://fgxjscoirazdkckcyory.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<the service_role key from Supabase → Project Settings → API>
TELEGRAM_BOT_TOKEN=<the @magicbotslabbot token from BotFather>
TELEGRAM_CHAT_ID=<your numeric Telegram id>
TELEGRAM_WEBHOOK_SECRET=<any long random string>
```

`SUPABASE_URL` and the service role key come from the **Clunoid App** Supabase
project — the same project, with `mbl_`-prefixed tables. The service role key
bypasses every row-level rule, so it belongs only here, never in a page.

### 2. Press Start on the bot

Open `t.me/magicbotslabbot` in Telegram and press **Start**. Telegram will not
let a bot message you until you have. Then register the webhook once, so the
bot answers instead of sitting silent:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" -H "Content-Type: application/json" -d "{\"url\":\"https://magicbotslab.com/api/telegram\",\"secret_token\":\"<TELEGRAM_WEBHOOK_SECRET>\",\"allowed_updates\":[\"message\"]}"
```

## Checking it works

```bash
curl -X POST https://magicbotslab.com/api/support -H "Content-Type: application/json" -d "{\"name\":\"Test\",\"email\":\"you@example.com\",\"message\":\"testing the support bubble\"}"
```

`{"ok":true}` and a message on your phone means support is live. Then open
`/creators.html` and register — if the dashboard appears, everything is wired.

## Security

Every `mbl_` table has row-level security on with **no policies**, which denies
everything. Nothing reaches them from a browser: the only door is the functions
under `/api`, and they hold the key. A creator is identified by a secret token
minted at registration and kept in their own browser — there is no account to
sign in to, and no password to lose.
