alter table tito_private.google_connection add column calendar_id text;
create function public.tito_google_worker_config() returns jsonb language sql security definer set search_path = '' as $$
select to_jsonb(c) from tito_private.google_connection c where singleton;
$$;
create function public.tito_google_set_calendar(target text) returns void language sql security definer set search_path = '' as $$
update tito_private.google_connection set calendar_id=target where singleton;
$$;
revoke all on function public.tito_google_worker_config(), public.tito_google_set_calendar(text) from public,anon,authenticated;
grant execute on function public.tito_google_worker_config(), public.tito_google_set_calendar(text) to service_role;
