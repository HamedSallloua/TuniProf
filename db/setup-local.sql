-- One-time setup of the LOCAL development databases (AGENT_CONTEXT section 4.1).
-- Run as the postgres superuser. Do not run on a production server.
--
--   psql -U postgres -v app_password="YourPasswordHere" -f db/setup-local.sql
--
-- Use only letters and digits in the password so it can sit safely inside DATABASE_URL.

CREATE USER tuniprof_app WITH PASSWORD :'app_password';
CREATE DATABASE tuniprof_dev OWNER tuniprof_app;
CREATE DATABASE tuniprof_test OWNER tuniprof_app;

\c tuniprof_dev
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

\c tuniprof_test
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
