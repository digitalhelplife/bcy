-- bencao_admin: console-owned database. No PII beyond pseudonymous IDs and admin credential hashes.
-- Apply with: psql "$ADMIN_DATABASE_URL" -f backend/admin/sql/0001_admin.sql

create table if not exists games (
  id text primary key,
  name text not null,
  stage text not null default 'S0',
  timezone text not null default 'Asia/Shanghai'
);
insert into games (id, name, stage, timezone)
values ('bencaoyou', '本草小游记', 'S0', 'Asia/Shanghai')
on conflict (id) do nothing;

create table if not exists admin_users (
  id uuid primary key,
  username text unique not null,
  password_hash text not null,
  role text not null check (role in ('owner','ops','support','reviewer','viewer')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED')),
  totp_secret text,
  totp_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text,
  last_login_at timestamptz
);

create table if not exists admin_sessions (
  id uuid primary key,
  user_id uuid not null references admin_users(id) on delete cascade,
  token_hash text unique not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip_hash text,
  user_agent_hash text,
  revoked_at timestamptz
);
create index if not exists admin_sessions_user on admin_sessions (user_id, created_at desc);

create table if not exists admin_audit (
  id bigserial primary key,
  actor_id uuid,
  actor_name text,
  action text not null,
  target_type text,
  target_id text,
  outcome text not null,
  ip_hash text,
  metadata_redacted jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created on admin_audit (created_at desc);
create index if not exists admin_audit_actor on admin_audit (actor_id, created_at desc);
create index if not exists admin_audit_action on admin_audit (action, created_at desc);

create table if not exists feedback_state (
  game_id text not null default 'bencaoyou',
  owner_id text not null,
  storage_key text not null,
  status text not null default 'NEW' check (status in ('NEW','IN_PROGRESS','RESOLVED','ARCHIVED')),
  assignee_id uuid,
  note text,
  updated_at timestamptz not null default now(),
  primary key (game_id, owner_id, storage_key)
);
create index if not exists feedback_state_status on feedback_state (game_id, status, updated_at desc);

create table if not exists metric_daily (
  game_id text not null default 'bencaoyou',
  day date not null,
  metric text not null,
  value numeric not null,
  source text not null,
  computed_at timestamptz not null default now(),
  primary key (game_id, day, metric)
);

create table if not exists metric_cohort (
  game_id text not null default 'bencaoyou',
  cohort_day date not null,
  offset_day int not null check (offset_day between 0 and 30),
  cohort_size int not null,
  active_count int not null,
  primary key (game_id, cohort_day, offset_day)
);

create table if not exists promo_channels (
  id uuid primary key,
  game_id text not null default 'bencaoyou',
  code text unique not null,
  name text not null,
  platform text,
  status text not null default 'ACTIVE',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists promo_campaigns (
  id uuid primary key,
  game_id text not null default 'bencaoyou',
  channel_id uuid not null references promo_channels(id) on delete cascade,
  name text not null,
  start_day date,
  end_day date,
  budget_cents bigint,
  landing_url text,
  notes text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

create table if not exists promo_links (
  id uuid primary key,
  game_id text not null default 'bencaoyou',
  campaign_id uuid not null references promo_campaigns(id) on delete cascade,
  code text unique not null,
  url text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists promo_clicks_daily (
  game_id text not null default 'bencaoyou',
  day date not null,
  channel_id uuid,
  campaign_id uuid,
  link_id uuid,
  clicks int not null default 0,
  primary key (game_id, day, link_id)
);

create table if not exists promo_imports (
  id uuid primary key,
  game_id text not null default 'bencaoyou',
  filename text not null,
  file_hash text not null,
  imported_by text,
  imported_at timestamptz not null default now(),
  row_count int not null default 0,
  unique (game_id, file_hash)
);

create table if not exists promo_report_rows (
  id bigserial primary key,
  import_id uuid not null references promo_imports(id) on delete cascade,
  day date not null,
  channel_id uuid,
  campaign_id uuid,
  impressions bigint,
  clicks bigint,
  spend_cents bigint
);
create index if not exists promo_report_rows_day on promo_report_rows (day desc);
