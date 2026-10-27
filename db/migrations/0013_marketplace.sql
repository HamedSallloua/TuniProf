-- Public marketplace (spec 3.2, 3.4, 7): contact reveals, profile reports, search indexes.

-- Every click on "Voir les coordonnées" (spec 3.4). No phone number and no network address is
-- stored here: only a hash that stands for the anonymous browser, so a teacher's metric
-- ("12 reveals this week") and the abuse limits work without tracking people.
-- 'view' and 'whatsapp' are allowed by the spec's table; the site writes 'reveal' for now.
CREATE TABLE contact_events (
  id           bigserial PRIMARY KEY,
  teacher_id   uuid NOT NULL REFERENCES teacher_profiles (user_id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  type         text NOT NULL CHECK (type IN ('view', 'reveal', 'whatsapp')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_events_teacher_idx ON contact_events (teacher_id, type, created_at);

-- "Signaler ce profil" (spec 3.4). The admin screen that handles reports comes at M11.
CREATE TABLE reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   uuid NOT NULL REFERENCES teacher_profiles (user_id) ON DELETE CASCADE,
  reason       text NOT NULL CHECK (reason IN ('wrong_info', 'inappropriate', 'suspected_fraud', 'other')),
  note         text CHECK (note IS NULL OR char_length(note) <= 500),
  -- The signed-in account when there is one, and always the anonymous browser hash.
  reporter_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  session_hash text NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'dismissed')),
  handled_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  handled_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- "Autre" needs an explanation, whoever sends the report.
  CONSTRAINT other_reason_has_note
    CHECK (reason <> 'other' OR (note IS NOT NULL AND btrim(note) <> ''))
);
-- One open report per browser and profile: sending the same report ten times adds nothing.
CREATE UNIQUE INDEX reports_one_open_per_browser_idx
  ON reports (teacher_id, session_hash) WHERE status = 'open';
CREATE INDEX reports_status_idx ON reports (status, created_at);

CREATE TRIGGER reports_set_updated_at BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Search looks teachers up by level, subject and zone: the primary keys start with the
-- teacher, so the other direction needs its own index.
CREATE INDEX teacher_levels_level_idx ON teacher_levels (level_id);
CREATE INDEX teacher_subjects_subject_idx ON teacher_subjects (subject_id);
CREATE INDEX teacher_zones_delegation_idx ON teacher_zones (delegation_id);

-- Contact page. Like the payment details, the value is a placeholder until the owner
-- sends the real address; production hides it while contact.configured is false.
INSERT INTO settings (key, value) VALUES
  ('contact.email', '"contact@example.invalid"'),
  ('contact.configured', 'false')
ON CONFLICT (key) DO NOTHING;
