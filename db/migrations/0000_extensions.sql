-- Extensions required by the spec (AGENT_CONTEXT section 4 and 7).
-- pgcrypto: hashing and random values. btree_gist: the no-overlap rule on sessions.
-- pg_trgm: fast partial-match search on student names and phone numbers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
