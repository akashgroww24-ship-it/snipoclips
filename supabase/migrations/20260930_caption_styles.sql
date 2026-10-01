-- Additive caption preset storage; clip.edit JSON keeps legacy styles valid.
create table if not exists public.caption_styles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  style jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists caption_styles_user_created_idx on public.caption_styles(user_id,created_at desc);
create unique index if not exists caption_styles_one_default_idx on public.caption_styles(user_id) where is_default;
alter table public.caption_styles enable row level security;
create policy "caption styles read own" on public.caption_styles for select to authenticated using ((select auth.uid())=user_id);
create policy "caption styles insert own" on public.caption_styles for insert to authenticated with check ((select auth.uid())=user_id);
create policy "caption styles update own" on public.caption_styles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "caption styles delete own" on public.caption_styles for delete to authenticated using ((select auth.uid())=user_id);
grant select,insert,update,delete on public.caption_styles to authenticated;
