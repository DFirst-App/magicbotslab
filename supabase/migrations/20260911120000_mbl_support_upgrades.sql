-- SUPPORT UPGRADES — attachments both ways, and a door.
--
-- ATTACHMENTS. Pictures and documents, in both directions. "It looks wrong"
-- is a sentence a screenshot answers and a paragraph does not; a set file or a
-- log is exactly what people get asked for and then have nowhere to put. The
-- file itself lives in the `support-files` storage bucket; these columns are
-- the pointer, the sender's own name for it, and the type. A row may carry a
-- file with no text at all — a marked-up screenshot is a complete answer.
--
-- BANS. The support window and the EA form are open to anybody with the page,
-- which is the point of them. The cost is that there is no door, so this is
-- the door. A ban matches on EITHER the browser id or the email: a visitor id
-- is lost the moment somebody opens a private window, and an email is whatever
-- they typed. Together they stop the ordinary case — one person being a
-- nuisance. It is a nuisance filter, not a security boundary, and it is worth
-- being honest that anything stronger would need accounts.
--
-- Unbanning does NOT delete the row: `active` goes false and `unbanned_at` is
-- stamped. "Banned in March and let back in" is a different fact from "never
-- banned", and a deleted row claims the second. Emptying the list is a
-- separate, deliberate act (/bans clear).
--
-- RLS on, no policies — nothing here is reachable from a browser.

alter table public.mbl_support_messages
  add column if not exists attachment_url  text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text;

create table if not exists public.mbl_support_bans (
  id           uuid primary key default gen_random_uuid(),
  visitor_id   text,
  email        text,
  name         text,
  reason       text,
  active       boolean not null default true,
  banned_at    timestamptz not null default now(),
  unbanned_at  timestamptz,
  constraint mbl_support_bans_has_key check (visitor_id is not null or email is not null)
);

create index if not exists mbl_support_bans_visitor_idx
  on public.mbl_support_bans (visitor_id) where active and visitor_id is not null;
create index if not exists mbl_support_bans_email_idx
  on public.mbl_support_bans (lower(email)) where active and email is not null;
create index if not exists mbl_support_bans_recent_idx
  on public.mbl_support_bans (banned_at desc);

alter table public.mbl_support_bans enable row level security;
