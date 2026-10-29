-- Read-only views over the Nakama database. Apply to the Nakama database (not bencao_admin).
-- The admin service connects with a role that has SELECT only and default_transaction_read_only=on.
-- Nakama 3.x stores `storage.value` as BYTEA containing UTF-8 JSON.

create or replace view admin_v_users as
select
  id::text as id,
  coalesce(custom_id, '') as custom_id,
  username,
  create_time,
  update_time
from users;

create or replace view admin_v_player_state as
select
  owner_id::text as owner_id,
  key,
  convert_from(value, 'UTF8')::jsonb as value,
  update_time
from storage
where collection = 'game_player' and key = 'state';

create or replace view admin_v_runs as
select
  owner_id::text as owner_id,
  key,
  convert_from(value, 'UTF8')::jsonb as value,
  update_time
from storage
where collection = 'game_runs';

create or replace view admin_v_storage_feedback as
select
  owner_id::text as owner_id,
  key,
  convert_from(value, 'UTF8')::jsonb as value,
  update_time
from storage
where collection = 'game_feedback';

create or replace view admin_v_storage_telemetry as
select
  owner_id::text as owner_id,
  key,
  convert_from(value, 'UTF8')::jsonb as value,
  update_time
from storage
where collection = 'game_telemetry';
