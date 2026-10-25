// Idempotent schema for bencao-auth (doc 06 §8.1). All timestamps are timestamptz (UTC).
// No column stores an ID-card number, a real name, a plaintext phone number, an SMS code or a ticket.
export const SCHEMA = `
create table if not exists auth_accounts (
  user_id uuid primary key,
  phone_ciphertext text,
  phone_lookup_hash text unique,
  pi_ciphertext text,
  birth_ym text,
  realname_status text not null default 'UNVERIFIED' check (realname_status in ('UNVERIFIED','PENDING','VERIFIED_ADULT','VERIFIED_MINOR')),
  account_status text not null default 'ACTIVE' check (account_status in ('ACTIVE','DELETE_PENDING','DELETED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table if not exists sms_challenges (
  id bigserial primary key,
  phone_lookup_hash text not null,
  ip_hash text,
  code_hash text not null,
  expires_at timestamptz not null,
  attempt_count int not null default 0,
  sent_at timestamptz not null default now(),
  consumed_at timestamptz
);
create index if not exists sms_challenges_phone on sms_challenges (phone_lookup_hash, sent_at desc);
create index if not exists sms_challenges_ip on sms_challenges (ip_hash, sent_at desc);
create table if not exists realname_requests (
  ai uuid primary key,
  user_id uuid not null,
  request_status text not null check (request_status in ('PENDING','VERIFIED','FAILED')),
  birth_ym text,
  submitted_at timestamptz not null default now(),
  queried_at timestamptz,
  result_at timestamptz
);
create index if not exists realname_requests_user on realname_requests (user_id, submitted_at desc);
create table if not exists ticket_jti (
  jti_hash text primary key,
  user_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create table if not exists playtime_sessions (
  id bigserial primary key,
  user_id uuid not null,
  started_at timestamptz not null,
  last_at timestamptz not null,
  closed boolean not null default false
);
create index if not exists playtime_sessions_user on playtime_sessions (user_id, last_at desc);
create table if not exists behavior_outbox (
  event_id uuid primary key,
  user_id uuid not null,
  kind text not null check (kind in ('online','offline')),
  occurred_at timestamptz not null,
  attempts int not null default 0,
  status text not null default 'PENDING',
  sent_at timestamptz,
  unique (user_id, kind, occurred_at)
);
create table if not exists account_deletions (
  user_id uuid not null,
  request_id uuid not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create table if not exists audit_log (
  id bigserial primary key,
  trace_id text not null,
  actor_hash text,
  action text not null,
  outcome text not null,
  created_at timestamptz not null default now(),
  metadata_redacted jsonb
);
create table if not exists runtime_config (
  id int primary key check (id = 1),
  config jsonb not null,
  version int not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);
create table if not exists runtime_config_history (
  version int primary key,
  config jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  note text
);
`
