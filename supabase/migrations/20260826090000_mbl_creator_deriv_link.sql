-- ═══════════════════════════════════════════════════════════════════════════
-- MAGIC BOTS LAB — remembering a creator on their other device.
--
-- A creator is identified by a token their browser keeps, which is fine until
-- they pick up a phone instead of a laptop. There is nothing to sign in to, so
-- the second device knows nothing about them — and trying to register again
-- only tells them the email is taken. That is a dead end for somebody who has
-- done nothing wrong.
--
-- The way out is the one thing that follows them between devices: the Deriv
-- account they connected. We record its id here, and a device presenting a
-- WORKING Deriv access token for that same account is handed their creator
-- token back. Possession of a live token is the proof — an account id typed by
-- a browser proves nothing and is never trusted on its own.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.mbl_creators
  add column if not exists deriv_loginid text;

comment on column public.mbl_creators.deriv_loginid is
  'Deriv options account id, lowercased. Recorded the first time a creator opens the dashboard with Deriv connected, and used to recognise them on another device.';

-- One creator per Deriv account: two people cannot claim the same one.
create unique index if not exists mbl_creators_deriv_loginid_key
  on public.mbl_creators (deriv_loginid)
  where deriv_loginid is not null;
