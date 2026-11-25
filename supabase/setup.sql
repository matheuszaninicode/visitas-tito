begin;

create schema if not exists tito_private;
revoke all on schema tito_private from public;

create table tito_private.family (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table tito_private.slots (
  id bigint generated always as identity primary key,
  day date not null,
  start_time time not null,
  is_open boolean not null,
  unique (day, start_time)
);
create table tito_private.bookings (
  slot_id bigint primary key references tito_private.slots(id),
  visitor text not null check (char_length(visitor) between 1 and 100),
  guests int not null check (guests between 1 and 4),
  code uuid not null unique default gen_random_uuid()
);

alter table tito_private.family enable row level security;
alter table tito_private.slots enable row level security;
alter table tito_private.bookings enable row level security;

create function public.available_slots()
returns table (slot_id bigint, day date, start_time time)
language sql security definer set search_path = ''
as $$
  select s.id, s.day, s.start_time
  from tito_private.slots s
  where s.is_open
    and s.day + s.start_time > now() at time zone 'America/Sao_Paulo'
    and not exists (select 1 from tito_private.bookings b where b.slot_id = s.id)
  order by s.day, s.start_time;
$$;

create function public.reserve_slot(requested_slot bigint, visitor_name text, group_size int)
returns table (day date, start_time time, guests int, cancel_code uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  selected_slot tito_private.slots%rowtype;
  new_code uuid;
begin
  select * into selected_slot from tito_private.slots s
  where s.id = requested_slot and s.is_open
    and s.day + s.start_time > now() at time zone 'America/Sao_Paulo'
  for update;
  if not found then raise exception 'slot_unavailable'; end if;

  insert into tito_private.bookings as b (slot_id, visitor, guests)
  values (requested_slot, btrim(visitor_name), group_size)
  on conflict (slot_id) do nothing
  returning b.code into new_code;
  if not found then raise exception 'slot_unavailable'; end if;
  return query select selected_slot.day, selected_slot.start_time, group_size, new_code;
end;
$$;

create function public.lookup_visit(reservation_code uuid)
returns table (day date, start_time time, guests int)
language sql security definer set search_path = ''
as $$
  select s.day, s.start_time, b.guests
  from tito_private.bookings b join tito_private.slots s on s.id = b.slot_id
  where b.code = reservation_code;
$$;

create function public.cancel_visit(reservation_code uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  delete from tito_private.bookings where code = reservation_code;
  return found;
end;
$$;

create function tito_private.check_family()
returns void language plpgsql set search_path = ''
as $$
begin
  if not exists (select 1 from tito_private.family where user_id = auth.uid()) then
    raise exception 'family_access_required' using errcode = '42501';
  end if;
end;
$$;

create function public.family_schedule()
returns table (day date, start_time time, visitor text, guests int)
language plpgsql security definer set search_path = ''
as $$
begin
  perform tito_private.check_family();
  return query
  select s.day, s.start_time, b.visitor, b.guests
  from tito_private.slots s join tito_private.bookings b on s.id = b.slot_id
  order by s.day, s.start_time;
end;
$$;

create function public.manage_day(visit_day date, open_for_booking boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform tito_private.check_family();
  if visit_day is null or not isfinite(visit_day) or visit_day < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'invalid_visit_day';
  end if;

  insert into tito_private.slots (day, start_time, is_open)
  select visit_day, time '13:00' + step * interval '30 minutes', open_for_booking
  from generate_series(0, 5) as steps(step)
  on conflict (day, start_time) do update set is_open = excluded.is_open;
end;
$$;

revoke all on function public.available_slots(), public.reserve_slot(bigint, text, int),
  public.lookup_visit(uuid), public.cancel_visit(uuid), public.family_schedule(),
  public.manage_day(date, boolean) from public, anon, authenticated, service_role;
grant execute on function public.available_slots(), public.reserve_slot(bigint, text, int),
  public.lookup_visit(uuid), public.cancel_visit(uuid) to anon, authenticated;
grant execute on function public.family_schedule(), public.manage_day(date, boolean) to authenticated;

commit;
