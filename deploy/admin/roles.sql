-- Read-only runtime roles. Run as a migration superuser in the target database.
-- Replace CHANGE_ME with a generated password; store it only in /etc/bencao-admin/env.

-- 1) Nakama database (run inside the nakama DB, after nakama_views.sql).
create role bencao_admin_ro_nakama login password 'CHANGE_ME';
grant connect on database nakama to bencao_admin_ro_nakama;
grant usage on schema public to bencao_admin_ro_nakama;
grant select on admin_v_users, admin_v_player_state, admin_v_runs,
                admin_v_storage_feedback, admin_v_storage_telemetry
  to bencao_admin_ro_nakama;
alter role bencao_admin_ro_nakama set default_transaction_read_only = on;

-- 2) bencao-auth database (run inside bencao_auth, after auth_views.sql).
create role bencao_admin_ro_auth login password 'CHANGE_ME';
grant connect on database bencao_auth to bencao_admin_ro_auth;
grant usage on schema public to bencao_admin_ro_auth;
grant select on admin_v_accounts, admin_v_playtime, admin_v_realname_requests, admin_v_deletions
  to bencao_admin_ro_auth;
alter role bencao_admin_ro_auth set default_transaction_read_only = on;

-- 3) Console-owned database (run inside bencao_admin).
create role bencao_admin_app login password 'CHANGE_ME';
grant connect on database bencao_admin to bencao_admin_app;
grant usage on schema public to bencao_admin_app;
grant select, insert, update, delete on all tables in schema public to bencao_admin_app;
grant usage, select on all sequences in schema public to bencao_admin_app;
alter default privileges in schema public grant select, insert, update, delete on tables to bencao_admin_app;
alter default privileges in schema public grant usage, select on sequences to bencao_admin_app;
