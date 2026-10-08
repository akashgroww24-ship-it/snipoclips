-- Only the authenticated server-side admin API may call this aggregation.
create or replace function public.admin_operations(p_days integer default 30, p_user uuid default null)
returns jsonb language sql stable security invoker set search_path=public as $$
with e as (
 select *, coalesce(metadata->>'clipId',substring(path from '/(?:studio|clips)/([^/]+)')) as clip_key
 from user_activity_events where created_at >= now()-make_interval(days=>least(30,greatest(1,p_days))) and (p_user is null or user_id=p_user)
), metrics as (
 select user_id,
 count(distinct clip_key) filter(where event_type='studio_export_done' or (event_type='api_action' and status_code between 200 and 299 and path ~ '/clips/[^/]+/(edit|restyle)$')) as edited_reels,
 count(distinct clip_key) filter(where event_type='api_action' and status_code between 200 and 299 and path ~ '/studio/[^/]+/draft$') as draft_reels,
 count(*) filter(where event_type='studio_export_done') as exports_done,
 count(*) filter(where event_type='studio_export_failed') as exports_failed,
 count(*) filter(where event_type='studio_open') as editor_opens,
 count(*) filter(where event_type='api_action' and status_code>=400 and path not like '%heartbeat%') as failed_requests
 from e group by user_id
), j as (select * from jobs where created_at>=now()-make_interval(days=>least(30,greatest(1,p_days))) and (p_user is null or user_id=p_user)),
stages as (select status,stage,count(*) as jobs from j group by status,stage),
daily as (
 select d::date as day,
 (select count(*) from j where created_at::date=d::date) as jobs_started,
 (select count(*) from j where created_at::date=d::date and status in ('done','completed','success')) as jobs_done,
 (select count(*) from e where created_at::date=d::date and event_type='studio_export_done') as exports_done,
 (select count(*) from e where created_at::date=d::date and event_type='studio_export_failed') as exports_failed,
 (select coalesce(sum(active_seconds),0) from user_activity_daily where day=d::date and (p_user is null or user_id=p_user)) as active_seconds
 from generate_series(current_date-(least(30,greatest(1,p_days))-1),current_date,interval '1 day') d
)
select jsonb_build_object(
 'days',least(30,greatest(1,p_days)), 'updatedAt',now(),
 'summary',jsonb_build_object('editedReels',coalesce((select sum(edited_reels) from metrics),0),'draftReels',coalesce((select sum(draft_reels) from metrics),0),'exportsDone',coalesce((select sum(exports_done) from metrics),0),'exportsFailed',coalesce((select sum(exports_failed) from metrics),0),'editorOpens',coalesce((select sum(editor_opens) from metrics),0),'failedRequests',coalesce((select sum(failed_requests) from metrics),0),'jobsStarted',(select count(*) from j),'jobsDone',(select count(*) from j where status in ('done','completed','success')),'jobsFailed',(select count(*) from j where status in ('error','failed')),'jobsOpen',(select count(*) from j where status not in ('done','completed','success','error','failed')),'activeSeconds',(select coalesce(sum(active_seconds),0) from user_activity_daily where day>=current_date-(least(30,greatest(1,p_days))-1) and (p_user is null or user_id=p_user)),'onlineUsers',(select count(*) from user_presence where last_heartbeat_at>now()-interval '90 seconds' and (p_user is null or user_id=p_user))),
 'users',coalesce((select jsonb_agg(metrics) from metrics),'[]'::jsonb),
 'stages',coalesce((select jsonb_agg(stages) from stages),'[]'::jsonb),
 'daily',coalesce((select jsonb_agg(daily order by day) from daily),'[]'::jsonb),
 'workflows',coalesce((select jsonb_agg(x) from (select id,user_id,status,stage,clips_count,clips_total,source_minutes,error,created_at from j order by created_at desc limit 100) x),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(x) from (select user_id,event_type,action,status_code,metadata,created_at from e where event_type in ('workflow_stage','studio_export_started','studio_export_done','studio_export_failed') order by created_at desc limit 100) x),'[]'::jsonb)
);
$$;
revoke all on function public.admin_operations(integer,uuid) from public,anon,authenticated;
grant execute on function public.admin_operations(integer,uuid) to service_role;
