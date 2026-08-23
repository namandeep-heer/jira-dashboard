-- Jira Dashboard Supabase schema
-- Run this in Supabase SQL Editor before enabling cloud persistence.

create table if not exists public.dashboard_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_state enable row level security;

drop policy if exists "Users can read their dashboard state" on public.dashboard_state;
create policy "Users can read their dashboard state"
  on public.dashboard_state for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their dashboard state" on public.dashboard_state;
create policy "Users can insert their dashboard state"
  on public.dashboard_state for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their dashboard state" on public.dashboard_state;
create policy "Users can update their dashboard state"
  on public.dashboard_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Anonymous sign-ins use the authenticated role. Keep the existing permissive
-- operation policies above and add this restrictive owner boundary so every
-- anonymous or permanent user can access only their own row.
drop policy if exists "Dashboard state owner boundary" on public.dashboard_state;
create policy "Dashboard state owner boundary"
  on public.dashboard_state as restrictive for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_dashboard_state_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dashboard_state_updated_at on public.dashboard_state;
create trigger dashboard_state_updated_at
  before update on public.dashboard_state
  for each row execute function public.set_dashboard_state_updated_at();

comment on table public.dashboard_state is
  'Per-user Jira Dashboard state, including credentials, settings, configuration, synced cache, and logs.';

-- Shared workspace state: every authenticated or anonymous user sees the same row.
create table if not exists public.shared_dashboard_state (
  id integer primary key default 1 check (id = 1),
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.shared_dashboard_state enable row level security;

drop policy if exists "Authenticated users can read shared dashboard state" on public.shared_dashboard_state;
create policy "Authenticated users can read shared dashboard state"
  on public.shared_dashboard_state for select to authenticated
  using (true);

drop policy if exists "Authenticated users can insert shared dashboard state" on public.shared_dashboard_state;
create policy "Authenticated users can insert shared dashboard state"
  on public.shared_dashboard_state for insert to authenticated
  with check (id = 1);

drop policy if exists "Authenticated users can update shared dashboard state" on public.shared_dashboard_state;
create policy "Authenticated users can update shared dashboard state"
  on public.shared_dashboard_state for update to authenticated
  using (true)
  with check (id = 1);

drop trigger if exists shared_dashboard_state_updated_at on public.shared_dashboard_state;
create trigger shared_dashboard_state_updated_at
  before update on public.shared_dashboard_state
  for each row execute function public.set_dashboard_state_updated_at();

-- Preserve the newest existing state when moving from the old per-user table.
insert into public.shared_dashboard_state (id, state)
select 1, state
from public.dashboard_state
order by updated_at desc
limit 1
on conflict (id) do nothing;

comment on table public.shared_dashboard_state is
  'Shared Jira Dashboard state visible to all authenticated users.';

-- Dashboard roles. The first administrator must be seeded after email registration
-- creates the user, using the email configured in config/.env.
create table if not exists public.dashboard_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

alter table public.dashboard_members enable row level security;

create or replace function public.is_dashboard_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.dashboard_members
    where user_id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "Members can read their role" on public.dashboard_members;
create policy "Members can read their role"
  on public.dashboard_members for select to authenticated
  using (user_id = auth.uid() or public.is_dashboard_admin());

drop policy if exists "Admins can manage members" on public.dashboard_members;
create policy "Admins can manage members"
  on public.dashboard_members for all to authenticated
  using (public.is_dashboard_admin())
  with check (public.is_dashboard_admin());

drop trigger if exists on_auth_user_created_dashboard_member on auth.users;
drop function if exists public.handle_new_dashboard_user();

create table if not exists public.user_jira_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  jira_url text not null,
  jira_email text not null,
  jira_token_ciphertext text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_jira_credentials add column if not exists jira_token_ciphertext text;
alter table public.user_jira_credentials drop column if exists jira_token;

alter table public.user_jira_credentials enable row level security;

drop policy if exists "Users can read their Jira credentials" on public.user_jira_credentials;
create policy "Users can read their Jira credentials"
  on public.user_jira_credentials for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their Jira credentials" on public.user_jira_credentials;
create policy "Users can insert their Jira credentials"
  on public.user_jira_credentials for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their Jira credentials" on public.user_jira_credentials;
create policy "Users can update their Jira credentials"
  on public.user_jira_credentials for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Only admins may create or update shared dashboard data.
drop policy if exists "Authenticated users can insert shared dashboard state" on public.shared_dashboard_state;
create policy "Authenticated users can insert shared dashboard state"
  on public.shared_dashboard_state for insert to authenticated
  with check (id = 1 and public.is_dashboard_admin());

drop policy if exists "Authenticated users can update shared dashboard state" on public.shared_dashboard_state;
create policy "Authenticated users can update shared dashboard state"
  on public.shared_dashboard_state for update to authenticated
  using (public.is_dashboard_admin())
  with check (id = 1 and public.is_dashboard_admin());

-- Optional hardening for the selected database-row credential strategy:
-- Restrict direct table access to authenticated users through the policies above.
-- For production, prefer moving Jira credentials to an Edge Function secret.
