begin;

create function tito_private.normalized_name(value text)
returns text language sql immutable strict set search_path = ''
as $$
  select btrim(regexp_replace(lower(regexp_replace(normalize(value, NFKD),
    U&'[\0300-\036F]', '', 'g')), '[^[:alnum:]]+', ' ', 'g'));
$$;

alter table tito_private.bookings add column companions text[] not null default '{}';

create table tito_private.attendees (
  name_key text primary key,
  slot_id bigint not null references tito_private.bookings(slot_id) on delete cascade
);
alter table tito_private.attendees enable row level security;
create index attendees_slot_id_idx on tito_private.attendees(slot_id);

insert into tito_private.attendees (name_key, slot_id)
select tito_private.normalized_name(visitor), slot_id from tito_private.bookings;

drop function public.reserve_slot(bigint, text, int);
create function public.reserve_slot(requested_slot bigint, visitor_name text, companion_names text[])
returns table (day date, start_time time, guests int, cancel_code uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  selected_slot tito_private.slots%rowtype;
  new_code uuid;
  party_size int := 1 + cardinality(companion_names);
  attendee_keys text[];
begin
  select array_agg(tito_private.normalized_name(person) order by tito_private.normalized_name(person))
  into attendee_keys
  from unnest(array[visitor_name] || companion_names) as names(person);
  if party_size is null or party_size not between 1 and 4 or exists (
    select from unnest(array[visitor_name] || companion_names) as names(person)
    where person is null or char_length(person) > 100
      or tito_private.normalized_name(person) !~ '^[[:alpha:]]+[[:alnum:]]*( [[:alpha:]]+[[:alnum:]]*)+$'
  ) then
    raise exception 'invalid_guest_names';
  end if;

  select * into selected_slot from tito_private.slots s
  where s.id = requested_slot and s.is_open
    and s.day + s.start_time > now() at time zone 'America/Sao_Paulo'
  for update;
  if not found then raise exception 'slot_unavailable'; end if;

  insert into tito_private.bookings as b (slot_id, visitor, guests, companions)
  values (requested_slot, btrim(visitor_name), party_size, companion_names)
  on conflict (slot_id) do nothing
  returning b.code into new_code;
  if not found then raise exception 'slot_unavailable'; end if;

  begin
    insert into tito_private.attendees (name_key, slot_id)
    select name_key, requested_slot from unnest(attendee_keys) as names(name_key) order by name_key;
  exception when unique_violation then
    raise exception 'guest_already_booked';
  end;

  return query select selected_slot.day, selected_slot.start_time, party_size, new_code;
end;
$$;

drop function public.family_schedule();
create function public.family_schedule()
returns table (day date, start_time time, visitor text, guests int, companions text[])
language plpgsql security definer set search_path = ''
as $$
begin
  perform tito_private.check_family();
  return query
  select s.day, s.start_time, b.visitor, b.guests, b.companions
  from tito_private.slots s join tito_private.bookings b on s.id = b.slot_id
  order by s.day, s.start_time;
end;
$$;

revoke all on function public.reserve_slot(bigint, text, text[]), public.family_schedule()
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_slot(bigint, text, text[]) to anon, authenticated;
grant execute on function public.family_schedule() to authenticated;
commit;
