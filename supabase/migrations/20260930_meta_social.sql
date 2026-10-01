-- Apply after schema.sql. Only the server's service-role client may read or write
-- these tables: even encrypted token columns never enter the browser Data API.
create table public.social_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('instagram','facebook')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists social_oauth_expiry_idx on public.social_oauth_states(expires_at);

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('instagram','facebook')),
  external_id text not null,
  display_name text not null,
  enc_access text not null,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'connected' check (status in ('connected','reconnect_required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,provider,external_id)
);
create index if not exists social_accounts_user_idx on public.social_accounts(user_id,created_at desc);

create table public.social_publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  clip_id uuid not null references public.clips(id) on delete cascade,
  idempotency_key text not null,
  caption text not null default '',
  status text not null default 'queued' check (status in ('queued','preparing','uploading','processing','publishing','published','failed','uncertain')),
  remote_container_id text,
  remote_post_id text,
  permalink text,
  error_code text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,idempotency_key)
);
create index if not exists social_publications_user_idx on public.social_publications(user_id,created_at desc);
create index if not exists social_publications_work_idx on public.social_publications(status,next_attempt_at,lease_until);

alter table public.social_oauth_states enable row level security;
alter table public.social_accounts enable row level security;
alter table public.social_publications enable row level security;
revoke all on public.social_oauth_states,public.social_accounts,public.social_publications from public,anon,authenticated;
grant all on public.social_oauth_states,public.social_accounts,public.social_publications to service_role;

-- Atomic claim prevents two web instances from publishing the same queued job.
create function public.claim_social_publication()
returns setof public.social_publications
language sql security invoker set search_path = public
as $$
  update public.social_publications p
  set lease_until = now() + interval '2 minutes',
      updated_at = now(),
      attempts = case when p.status = 'queued' then p.attempts + 1 else p.attempts end,
      status = case when p.status = 'queued' then 'preparing' else p.status end
  where p.id = (
    select id from public.social_publications
    where status in ('queued','processing') and next_attempt_at <= now()
      and (lease_until is null or lease_until < now())
    order by next_attempt_at,created_at for update skip locked limit 1
  )
  returning p.*;
$$;
revoke all on function public.claim_social_publication() from public,anon,authenticated;
grant execute on function public.claim_social_publication() to service_role;
