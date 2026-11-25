create table tito_private.google_oauth (
  state uuid primary key,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table tito_private.google_oauth enable row level security;

create table tito_private.google_connection (
  singleton boolean primary key default true check (singleton),
  email text not null,
  refresh_token text not null
);
alter table tito_private.google_connection enable row level security;

create function public.tito_google_begin() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare token uuid := gen_random_uuid();
begin
  perform tito_private.check_family();
  delete from tito_private.google_oauth where expires_at < now();
  insert into tito_private.google_oauth(state) values (token);
  return token;
end;
$$;

create function public.tito_google_consume(oauth_state uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  delete from tito_private.google_oauth where state = oauth_state and expires_at >= now();
  return found;
end;
$$;

create function public.tito_google_save(account_email text, account_token text) returns void
language sql security definer set search_path = ''
as $$
  insert into tito_private.google_connection(email, refresh_token)
  values (account_email, account_token)
  on conflict (singleton) do update
  set email = excluded.email, refresh_token = excluded.refresh_token;
$$;

revoke all on function public.tito_google_begin(), public.tito_google_consume(uuid),
  public.tito_google_save(text,text) from public, anon, authenticated, service_role;
grant execute on function public.tito_google_begin() to authenticated;
grant execute on function public.tito_google_consume(uuid), public.tito_google_save(text,text) to service_role;
