-- ============================================================
--  Snipoclips — Supabase schema
--  Run this in Supabase → SQL Editor (once).
-- ============================================================

-- ---------- profiles (one per auth user) ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  plan          text    not null default 'free',        -- free | single | half | full
  clips_used    int     not null default 0,             -- clips made this period
  minutes_used  numeric not null default 0,             -- input video-minutes processed this period (cost scales with this, not clips)
  period_start  date    not null default current_date,
  created_at    timestamptz not null default now()
);

-- MIGRATION for installs created before minute-based quotas existed
-- (safe to re-run; only adds the column if it is missing):
alter table public.profiles add column if not exists minutes_used numeric not null default 0;

-- auto-create a profile when a user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- jobs ----------
create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source_url  text,
  status      text not null default 'queued',         -- queued | processing | done | error
  stage       text,
  clips_count int default 0,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists jobs_user_idx on public.jobs(user_id, created_at desc);

-- ---------- clips ----------
create table if not exists public.clips (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text,
  score        int,
  storage_path text not null,
  start_sec    numeric,
  end_sec      numeric,
  created_at   timestamptz not null default now()
);
create index if not exists clips_user_idx on public.clips(user_id, created_at desc);

-- ============================================================
--  Row-Level Security: users can only read their OWN rows.
--  The server uses the service-role key, which bypasses RLS,
--  so all writes happen server-side after auth + quota checks.
-- ============================================================
alter table public.profiles enable row level security;
alter table public.jobs     enable row level security;
alter table public.clips    enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "own jobs" on public.jobs;
create policy "own jobs" on public.jobs     for select using (auth.uid() = user_id);
drop policy if exists "own clips" on public.clips;
create policy "own clips" on public.clips    for select using (auth.uid() = user_id);

-- ============================================================
--  Storage buckets (private). Create in Supabase → Storage,
--  or run these. Clips are served via short-lived signed URLs.
-- ============================================================
insert into storage.buckets (id, name, public) values ('uploads','uploads', false) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('clips','clips', false)     on conflict do nothing;

-- ============================================================
--  Feature 5: YouTube connection + upload tracking
--  OAuth tokens are stored ENCRYPTED (AES-256-GCM, see lib/secretbox.js).
--  The service-role server is the only writer; users read their own rows.
-- ============================================================
create table if not exists public.youtube_accounts (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  channel_id     text,
  channel_title  text,
  channel_thumb  text,
  enc_access     text,           -- encrypted access token
  enc_refresh    text,           -- encrypted refresh token
  expiry         timestamptz,    -- access-token expiry
  scope          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.youtube_uploads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  clip_id     uuid not null references public.clips(id) on delete cascade,
  video_id    text,                                    -- YouTube video id once uploaded
  status      text not null default 'queued',          -- queued | uploading | done | error
  error       text,
  attempts    int  not null default 0,
  privacy     text default 'private',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists yt_uploads_user_idx on public.youtube_uploads(user_id, created_at desc);
create index if not exists yt_uploads_clip_idx on public.youtube_uploads(clip_id);

alter table public.youtube_accounts enable row level security;
alter table public.youtube_uploads  enable row level security;
drop policy if exists "own yt account" on public.youtube_accounts;
create policy "own yt account" on public.youtube_accounts for select using (auth.uid() = user_id);
drop policy if exists "own yt uploads" on public.youtube_uploads;
create policy "own yt uploads" on public.youtube_uploads  for select using (auth.uid() = user_id);
