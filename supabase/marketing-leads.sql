create table if not exists public.marketing_leads (
 id uuid primary key default gen_random_uuid(),
 email text not null unique check (email = lower(btrim(email)) and length(email) <= 254),
 source_path text not null default '/',
 consent_version text not null,
 consent_text text not null,
 created_at timestamptz not null default now()
);
alter table public.marketing_leads enable row level security;
revoke all on public.marketing_leads from public, anon, authenticated;
grant select, insert, update, delete on public.marketing_leads to service_role;
create index if not exists marketing_leads_created_idx on public.marketing_leads(created_at desc);
comment on table public.marketing_leads is 'Unverified email sign-ups with explicit consent. Server-only access; no automated email delivery.';
