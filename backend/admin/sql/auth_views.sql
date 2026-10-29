-- Read-only views over the bencao-auth database. Apply to the auth database.
-- No phone, pi, name, birth month or ID number is exposed.

create or replace view admin_v_accounts as
select
  user_id::text as user_id,
  realname_status,
  account_status,
  created_at,
  updated_at,
  deleted_at
from auth_accounts;

create or replace view admin_v_playtime as
select
  user_id::text as user_id,
  started_at,
  last_at,
  closed
from playtime_sessions;

create or replace view admin_v_realname_requests as
select
  user_id::text as user_id,
  request_status,
  submitted_at,
  result_at
from realname_requests;

create or replace view admin_v_deletions as
select
  user_id::text as user_id,
  request_id::text as request_id,
  completed_at
from account_deletions;
