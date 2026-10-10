-- Atomic folder deletion with a durable media cleanup queue. Server only.
create table if not exists public.folder_media_cleanup (
 id uuid primary key default gen_random_uuid(), user_id uuid not null,
 paths jsonb not null, created_at timestamptz not null default now()
);
alter table public.folder_media_cleanup enable row level security;
revoke all on public.folder_media_cleanup from public, anon, authenticated;
grant select, insert, delete on public.folder_media_cleanup to service_role;
create or replace function public.delete_owned_folder(p_job_id uuid, p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare j public.jobs%rowtype; clip_row record; paths jsonb := '[]'::jsonb; n integer := 0; item jsonb;
begin
 select * into j from public.jobs where id=p_job_id and user_id=p_user_id for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if j.status not in ('done','error') then return jsonb_build_object('error','busy'); end if;
 if exists(select 1 from public.social_publications s join public.clips c on c.id=s.clip_id where c.job_id=p_job_id and s.status in ('queued','uploading','processing','publishing','uncertain'))
 or exists(select 1 from public.youtube_uploads s join public.clips c on c.id=s.clip_id where c.job_id=p_job_id and s.status='uploading') then return jsonb_build_object('error','publishing'); end if;
 for clip_row in select * from public.clips where job_id=p_job_id for update loop
  if clip_row.user_id <> p_user_id then raise exception 'Folder ownership mismatch'; end if;
  n := n+1;
  paths := paths || jsonb_build_array(clip_row.storage_path,clip_row.master_path,clip_row.edit->'studioLatest'->>'path') || coalesce(clip_row.edit->'studioExports','[]'::jsonb);
  for item in select value from jsonb_array_elements(coalesce(clip_row.edit->'studioAssets','[]'::jsonb)) loop
   paths := paths || jsonb_build_array(item->>'path');
  end loop;
 end loop;
 -- Only media inside this user's namespace can enter the cleanup queue.
 select coalesce(jsonb_agg(distinct value),'[]'::jsonb) into paths from jsonb_array_elements_text(paths) where value like p_user_id::text || '/%';
 insert into public.folder_media_cleanup(user_id,paths) values(p_user_id,paths);
 delete from public.jobs where id=p_job_id and user_id=p_user_id;
 return jsonb_build_object('deleted',true,'clips',n);
end $$;
revoke all on function public.delete_owned_folder(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_owned_folder(uuid,uuid) to service_role;
