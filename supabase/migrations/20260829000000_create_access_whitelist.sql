create table if not exists public.access_whitelist (
  email text primary key,
  added_at timestamptz not null default now(),
  constraint access_whitelist_email_is_normalized check (email = lower(trim(email))),
  constraint access_whitelist_email_is_valid check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

comment on table public.access_whitelist is
  'Email addresses approved to use Steam Radar. Only the service role may read this table.';

alter table public.access_whitelist enable row level security;
revoke all on table public.access_whitelist from anon, authenticated;

-- Add approved addresses as an administrator, for example:
-- insert into public.access_whitelist (email) values ('teammate@example.com');
