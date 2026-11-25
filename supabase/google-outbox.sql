create extension if not exists pg_cron;
create extension if not exists pg_net;

create table tito_private.google_worker_secret (
  key uuid primary key default gen_random_uuid()
);
insert into tito_private.google_worker_secret default values;
alter table tito_private.google_worker_secret enable row level security;

create table tito_private.google_outbox (
  id bigint generated always as identity primary key,
  booking_id uuid not null,
  action text not null check (action in ('confirmed','changed','cancelled')),
  day date not null,
  start_time time not null,
  guests int not null,
  names text[] not null,
  calendar_done boolean not null default false,
  mail_sent boolean not null default false,
  retry_at timestamptz not null default now(),
  lease uuid
);
alter table tito_private.google_outbox enable row level security;

create function tito_private.queue_google_visit() returns trigger
language plpgsql set search_path = '' as $$
declare b tito_private.bookings;
begin
  if tg_op = 'UPDATE' and old.slot_id = new.slot_id then return null; end if;
  b := case when tg_op = 'DELETE' then old else new end;
  insert into tito_private.google_outbox(booking_id,action,day,start_time,guests,names)
  select b.code, case tg_op when 'INSERT' then 'confirmed' when 'UPDATE' then 'changed' else 'cancelled' end,
    s.day,s.start_time,b.guests,array[b.visitor] || b.companions from tito_private.slots s where s.id = b.slot_id;
  return null;
end;
$$;
create trigger queue_google_visit after insert or update or delete on tito_private.bookings
for each row execute function tito_private.queue_google_visit();

create function public.tito_google_claim(worker_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job tito_private.google_outbox;
begin
  if not exists(select from tito_private.google_worker_secret where key=worker_key) then
    raise exception 'worker_access_denied' using errcode='42501';
  end if;
  select * into job from tito_private.google_outbox q
    where not q.mail_sent and q.retry_at <= now()
      and not exists(select from tito_private.google_outbox prev where prev.booking_id=q.booking_id and prev.id<q.id and not prev.mail_sent)
    order by q.id limit 1 for update skip locked;
  if not found then return null; end if;
  update tito_private.google_outbox set retry_at=now()+interval '2 minutes',lease=gen_random_uuid()
    where id=job.id returning * into job;
  return to_jsonb(job);
end;
$$;

create function public.tito_google_progress(job_id bigint, job_lease uuid, mailed boolean)
returns void language sql security definer set search_path = '' as $$
  update tito_private.google_outbox set calendar_done=true,mail_sent=mailed, names=case when mailed then array[]::text[] else names end
  where id=job_id and lease=job_lease;
$$;

revoke all on function public.tito_google_claim(uuid), public.tito_google_progress(bigint,uuid,boolean) from public,anon,authenticated;
grant execute on function public.tito_google_claim(uuid), public.tito_google_progress(bigint,uuid,boolean) to service_role;

create function tito_private.kick_google_worker() returns void
language plpgsql set search_path = '' as $$
begin
  perform net.http_post(
    'https://hlhlwkxobecoelnvylvy.supabase.co/functions/v1/tito-google/process',
    headers := jsonb_build_object('Content-Type','application/json','x-tito-worker',w.key),
    timeout_milliseconds := 55000
  )
  from tito_private.google_worker_secret w
  where exists(select from tito_private.google_outbox where not mail_sent and retry_at <= now());
end;
$$;
select cron.schedule('tito-google-outbox','* * * * *','select tito_private.kick_google_worker()');

alter table tito_private.attendees drop constraint attendees_slot_id_fkey,
  add foreign key (slot_id) references tito_private.bookings(slot_id) on update cascade on delete cascade;

create function public.reschedule_visit(reservation_code uuid, requested_slot bigint)
returns table (day date, start_time time, guests int)
language plpgsql security definer set search_path = '' as $$
declare original tito_private.bookings; target tito_private.slots;
begin
  select b.* into original from tito_private.bookings b join tito_private.slots s on s.id=b.slot_id
    where b.code=reservation_code and s.day+s.start_time > now() at time zone 'America/Sao_Paulo' for update of b;
  if not found then raise exception 'reservation_unavailable'; end if;
  select * into target from tito_private.slots s where s.id=requested_slot and s.is_open
    and s.day+s.start_time > now() at time zone 'America/Sao_Paulo' for update;
  if not found or target.id=original.slot_id then raise exception 'slot_unavailable'; end if;
  begin
    update tito_private.bookings set slot_id=target.id where code=reservation_code;
  exception when unique_violation then
    raise exception 'slot_unavailable';
  end;
  return query select target.day,target.start_time,original.guests;
end;
$$;
revoke all on function public.reschedule_visit(uuid,bigint) from public,anon,authenticated;
grant execute on function public.reschedule_visit(uuid,bigint) to anon,authenticated;
