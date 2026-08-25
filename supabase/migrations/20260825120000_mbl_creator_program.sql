-- ═══════════════════════════════════════════════════════════════════════════
-- MAGIC BOTS LAB — the Creator Program.
--
-- Creators make short videos about Magic Bots Lab, post them on their own
-- accounts, and get paid monthly. This is the whole store behind that.
--
-- Every table has RLS ON and NO POLICIES, which is deny-all. Nothing here is
-- reachable from a browser, by design: magicbotslab.com is a static site, so
-- the only thing that touches these tables is the serverless functions under
-- /api, holding the service role key. A creator is identified by a secret
-- token minted at registration and kept by their browser — there is no Magic
-- Bots Lab account to sign in to, and there does not need to be.
--
-- Names are prefixed mbl_ because this project shares a Supabase project with
-- Clunoid. Same database, different product, no possibility of collision.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the creator ────────────────────────────────────────────────────────────
create table if not exists public.mbl_creators (
  id            uuid primary key default gen_random_uuid(),

  name          text not null,
  email         text not null,
  country       text not null,

  -- Brand-new accounts pay less in month one because they have no reach yet.
  -- We verify this ourselves before paying, so the creator's own tick is a
  -- starting point rather than the decision.
  new_accounts  boolean not null default false,

  status        text not null default 'active',   -- active | paused | removed
  payout_method text,                             -- usdt | paypal | mpesa | …

  -- Registration is not day 1. The first confirmed post is.
  started_at    timestamptz not null default now(),
  first_post_at timestamptz,

  -- The secret this browser presents to read and write its own row.
  access_token  text not null,

  -- Team: who they brought, and who brought them.
  referral_code text,
  referred_by   uuid references public.mbl_creators(id) on delete set null,

  note          text,                             -- internal only
  created_at    timestamptz not null default now()
);

-- One seat per person, however they capitalise their email.
create unique index if not exists mbl_creators_email_key
  on public.mbl_creators (lower(email));

create unique index if not exists mbl_creators_token_key
  on public.mbl_creators (access_token);

create unique index if not exists mbl_creators_referral_code_key
  on public.mbl_creators (referral_code) where referral_code is not null;

create index if not exists mbl_creators_referred_by_idx
  on public.mbl_creators (referred_by) where referred_by is not null;

-- Bringing yourself in is not a team.
alter table public.mbl_creators
  drop constraint if exists mbl_creators_no_self_referral;
alter table public.mbl_creators
  add constraint mbl_creators_no_self_referral
  check (referred_by is null or referred_by <> id);

-- ── the accounts they post on ──────────────────────────────────────────────
create table if not exists public.mbl_creator_handles (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.mbl_creators(id) on delete cascade,
  platform   text not null,      -- tiktok | instagram | youtube | facebook | …
  handle     text,               -- null until they fill it in
  created_at timestamptz not null default now(),
  unique (creator_id, platform)
);

-- The same social account cannot hold two seats in the programme.
create unique index if not exists mbl_creator_handles_platform_handle_key
  on public.mbl_creator_handles (platform, handle) where handle is not null;

create index if not exists mbl_creator_handles_creator_idx
  on public.mbl_creator_handles (creator_id);

-- ── what they posted ───────────────────────────────────────────────────────
create table if not exists public.mbl_creator_posts (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.mbl_creators(id) on delete cascade,

  posted_on  date not null,
  slot       smallint not null default 1 check (slot between 1 and 2),
  platforms  text[] not null default '{}',
  link       text,

  created_at timestamptz not null default now(),
  unique (creator_id, posted_on, slot)
);

create index if not exists mbl_creator_posts_creator_idx
  on public.mbl_creator_posts (creator_id, posted_on desc);

-- ── what they have earned ──────────────────────────────────────────────────
-- Called earnings rather than payouts: what a creator wants to see is what
-- they have made, not what our finance process calls it.
create table if not exists public.mbl_creator_earnings (
  id           uuid primary key default gen_random_uuid(),
  creator_id   uuid not null references public.mbl_creators(id) on delete cascade,

  month_number integer not null,
  period_start date not null,
  period_end   date not null,

  base_usd     numeric(10,2) not null default 0,
  bonus_usd    numeric(10,2) not null default 0,   -- the 10k-views bonus
  team_usd     numeric(10,2) not null default 0,   -- $20 per paid team member

  status       text not null default 'scheduled',  -- scheduled | requested | paid | cancelled
  requested_at timestamptz,
  paid_at      timestamptz,
  method       text,
  reference    text,
  note         text,

  created_at   timestamptz not null default now(),
  unique (creator_id, month_number)
);

create index if not exists mbl_creator_earnings_creator_idx
  on public.mbl_creator_earnings (creator_id, month_number);

-- ── a short, unmistakable team code ────────────────────────────────────────
-- No 0/O or 1/I: these get read aloud and typed by hand.
create or replace function public.mbl_creator_new_code() returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text;
  i int;
begin
  loop
    out := '';
    for i in 1..6 loop
      out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.mbl_creators where referral_code = out);
  end loop;
  return out;
end;
$$;

alter table public.mbl_creators
  alter column referral_code set default public.mbl_creator_new_code();

update public.mbl_creators
   set referral_code = public.mbl_creator_new_code()
 where referral_code is null;

-- ── deny everything from the browser ───────────────────────────────────────
alter table public.mbl_creators          enable row level security;
alter table public.mbl_creator_handles   enable row level security;
alter table public.mbl_creator_posts     enable row level security;
alter table public.mbl_creator_earnings  enable row level security;
