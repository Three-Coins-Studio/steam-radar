create table if not exists public.search_cache (
  cache_key text primary key,
  response jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.search_cache enable row level security;

revoke all on table public.search_cache from anon, authenticated;
grant all on table public.search_cache to service_role;

create index if not exists search_cache_expires_at_idx
  on public.search_cache (expires_at);

comment on table public.search_cache is
  'Server-only cache for normalized YouTube and Twitch search responses.';
