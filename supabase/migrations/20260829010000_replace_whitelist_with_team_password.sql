create extension if not exists pgcrypto with schema extensions;

create table if not exists public.team_access (
  id smallint primary key default 1,
  password_hash text not null,
  updated_at timestamptz not null default now(),
  constraint team_access_single_row check (id = 1),
  constraint team_access_password_is_bcrypt check (password_hash like '$2%')
);

comment on table public.team_access is
  'The bcrypt hash of the shared Steam Radar team password. Only the service role may access it.';

alter table public.team_access enable row level security;
revoke all on table public.team_access from anon, authenticated;

create or replace function public.verify_team_password(candidate_password text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_access
    where id = 1
      and password_hash = extensions.crypt(candidate_password, password_hash)
  );
$$;

revoke all on function public.verify_team_password(text) from public, anon, authenticated;
grant execute on function public.verify_team_password(text) to service_role;

drop table if exists public.access_whitelist;

-- Set or rotate the shared password from the SQL editor after applying this migration:
-- insert into public.team_access (id, password_hash, updated_at)
-- values (1, extensions.crypt('REPLACE_WITH_A_LONG_RANDOM_PASSWORD', extensions.gen_salt('bf', 12)), now())
-- on conflict (id) do update
-- set password_hash = excluded.password_hash, updated_at = excluded.updated_at;
