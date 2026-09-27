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
  clips_total int,                                   -- selected clip count for job progress
  error       text,
  folder_name text,                                  -- optional display name for this job's clips
  created_at  timestamptz not null default now()
);
-- Safe for installations created before folders could be renamed.
alter table public.jobs add column if not exists folder_name text;
alter table public.jobs add column if not exists clips_total int;
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

-- ---------- private, 30-day admin analytics ----------
alter table public.jobs add column if not exists source_minutes numeric;
create index if not exists jobs_created_retention_idx on public.jobs(created_at);
create index if not exists clips_created_retention_idx on public.clips(created_at);
create index if not exists music_uses_created_retention_idx on public.music_uses(created_at);
create index if not exists user_music_tracks_created_retention_idx on public.user_music_tracks(created_at);

create table if not exists public.site_visits (
  day date not null default (now() at time zone 'utc')::date,
  visitor_hash text not null,
  path text not null,
  views integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (day, visitor_hash, path)
);
create index if not exists site_visits_day_idx on public.site_visits(day);
alter table public.site_visits enable row level security;
revoke all on public.site_visits from anon, authenticated;

create table if not exists public.user_activity_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  active_seconds integer not null default 0,
  sessions integer not null default 0,
  primary key (user_id, day)
);
create index if not exists user_activity_daily_day_idx on public.user_activity_daily(day);
alter table public.user_activity_daily enable row level security;
revoke all on public.user_activity_daily from anon, authenticated;

create table if not exists public.retention_runs (
  id bigint generated always as identity primary key,
  finished_at timestamptz not null default now(),
  clips_removed integer not null default 0,
  tracks_removed integer not null default 0,
  analytics_removed integer not null default 0,
  status text not null,
  error text
);
alter table public.retention_runs enable row level security;
revoke all on public.retention_runs from anon, authenticated;

create or replace function public.record_site_visit(p_hash text, p_path text)
returns void language sql security invoker set search_path = '' as $$
  insert into public.site_visits(visitor_hash,path) values (p_hash,p_path)
  on conflict (day,visitor_hash,path) do update
  set views=public.site_visits.views+1,last_seen_at=now();
$$;
revoke all on function public.record_site_visit(text,text) from public, anon, authenticated;
grant execute on function public.record_site_visit(text,text) to service_role;

create or replace function public.record_user_activity_day(p_user uuid, p_seconds integer, p_session integer)
returns void language sql security invoker set search_path = '' as $$
  insert into public.user_activity_daily(user_id,active_seconds,sessions)
  values (p_user, greatest(0,least(p_seconds,45)), greatest(0,least(p_session,1)))
  on conflict (user_id,day) do update
  set active_seconds=public.user_activity_daily.active_seconds+excluded.active_seconds,
      sessions=public.user_activity_daily.sessions+excluded.sessions;
$$;
revoke all on function public.record_user_activity_day(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.record_user_activity_day(uuid,integer,integer) to service_role;

create or replace function public.admin_analytics_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'uniqueVisitors30', (select count(distinct visitor_hash) from public.site_visits where day >= (now() at time zone 'utc')::date-29),
      'pageViews30', (select coalesce(sum(views),0) from public.site_visits where day >= (now() at time zone 'utc')::date-29),
      'visitorsToday', (select count(distinct visitor_hash) from public.site_visits where day = (now() at time zone 'utc')::date),
      'activeUsers30', (select count(distinct user_id) from public.user_activity_daily where day >= (now() at time zone 'utc')::date-29),
      'activeMinutes30', (select coalesce(round(sum(active_seconds)::numeric/60,1),0) from public.user_activity_daily where day >= (now() at time zone 'utc')::date-29),
      'editActions30', (select count(*) from public.user_activity_events where created_at >= now()-interval '30 days' and path like '/api/clips/%/restyle' and status_code between 200 and 299),
      'clipsEdited30', (select count(distinct substring(path from '/api/clips/([^/]+)/restyle$')) from public.user_activity_events where created_at >= now()-interval '30 days' and path like '/api/clips/%/restyle' and status_code between 200 and 299),
      'clipsCreated30', (select count(*) from public.clips where created_at >= now()-interval '30 days'),
      'sourceMinutes30', (select coalesce(round(sum(source_minutes),1),0) from public.jobs where created_at >= now()-interval '30 days'),
      'jobsStarted30', (select count(*) from public.jobs where created_at >= now()-interval '30 days'),
      'jobsFailed30', (select count(*) from public.jobs where created_at >= now()-interval '30 days' and status='error'),
      'accountsTotal', (select count(*) from public.profiles),
      'accountsNew30', (select count(*) from public.profiles where created_at >= now()-interval '30 days')
    ),
    'days', (select coalesce(jsonb_agg(jsonb_build_object(
      'day',d.day::date, 'visitors',(select count(distinct visitor_hash) from public.site_visits where day=d.day::date),
      'views',(select coalesce(sum(views),0) from public.site_visits where day=d.day::date),
      'clips',(select count(*) from public.clips where created_at >= d.day and created_at < d.day+interval '1 day'),
      'edits',(select count(*) from public.user_activity_events where created_at >= d.day and created_at < d.day+interval '1 day' and path like '/api/clips/%/restyle' and status_code between 200 and 299),
      'activeMinutes',(select coalesce(round(sum(active_seconds)::numeric/60,1),0) from public.user_activity_daily where day=d.day::date)
    ) order by d.day),'[]'::jsonb)
    from generate_series((now() at time zone 'utc')::date-29,(now() at time zone 'utc')::date,interval '1 day') as d(day)),
    'pages', (select coalesce(jsonb_agg(jsonb_build_object('path',p.path,'views',p.views,'visitors',p.visitors) order by p.views desc),'[]'::jsonb)
      from (select path,sum(views) views,count(distinct visitor_hash) visitors from public.site_visits
        where day >= (now() at time zone 'utc')::date-29 group by path order by views desc limit 8) p)
  );
$$;
revoke all on function public.admin_analytics_snapshot() from public, anon, authenticated;
grant execute on function public.admin_analytics_snapshot() to service_role;

create or replace function public.delete_old_empty_jobs(p_cutoff timestamptz)
returns integer language plpgsql security invoker set search_path = '' as $$
declare removed integer;
begin
  delete from public.jobs j where j.created_at < p_cutoff and j.status <> 'processing'
    and not exists (select 1 from public.clips c where c.job_id=j.id);
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.delete_old_empty_jobs(timestamptz) from public, anon, authenticated;
grant execute on function public.delete_old_empty_jobs(timestamptz) to service_role;

create or replace function public.refresh_presence_30_day_rollups(p_cutoff date)
returns void language sql security invoker set search_path = '' as $$
  update public.user_presence p set
    active_seconds = coalesce((select sum(a.active_seconds) from public.user_activity_daily a where a.user_id=p.user_id and a.day >= p_cutoff),0),
    session_count = coalesce((select sum(a.sessions) from public.user_activity_daily a where a.user_id=p.user_id and a.day >= p_cutoff),0),
    first_seen_at = greatest(p.first_seen_at,p_cutoff::timestamptz)
  where p.last_seen_at >= p_cutoff::timestamptz;
$$;
revoke all on function public.refresh_presence_30_day_rollups(date) from public, anon, authenticated;
grant execute on function public.refresh_presence_30_day_rollups(date) to service_role;
