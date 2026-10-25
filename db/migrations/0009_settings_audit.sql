-- Key/value settings edited by the admin (spec 7: settings) and the audit log of admin
-- actions (spec 6, invariant: every admin action leaves a row).

CREATE TABLE settings (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]+$'),
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Hourly rate bounds of the profile form (spec 4.2: 5 to 300 DT, configurable), in millimes.
INSERT INTO settings (key, value) VALUES
  ('profile.rate_min_millimes', '5000'),
  ('profile.rate_max_millimes', '300000')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (btrim(action) <> ''),
  target_type text NOT NULL,
  target_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id, created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);
