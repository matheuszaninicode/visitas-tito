create function public.family_schedule_with_ids()
returns table (day date, start_time time, visitor text, guests int, companions text[], booking_ref text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform tito_private.check_family();
  return query
  select s.day, s.start_time, b.visitor, b.guests, b.companions, md5(b.code::text)
  from tito_private.bookings b join tito_private.slots s on s.id = b.slot_id
  order by s.day, s.start_time;
end;
$$;
create function public.family_cancel_visit(booking_ref text, visit_day date, visit_time time)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform tito_private.check_family();
  delete from tito_private.bookings b using tito_private.slots s
  where b.slot_id = s.id and md5(b.code::text) = booking_ref
    and s.day = visit_day and s.start_time = visit_time;
  return found;
end;
$$;
revoke all on function public.family_schedule_with_ids(), public.family_cancel_visit(text,date,time) from public, anon, authenticated;
grant execute on function public.family_schedule_with_ids(), public.family_cancel_visit(text,date,time) to authenticated;