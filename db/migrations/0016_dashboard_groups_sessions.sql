-- Dashboard: groups, weekly rules and sessions (spec 5.1 to 5.5, 7; invariants 9 to 11, 16).
-- Dates and times are LOCAL (Africa/Tunis): a `date` and a `time`, never converted.

CREATE TABLE groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   uuid NOT NULL,
  -- Always 'teacher': only a teacher account can own groups.
  role         text NOT NULL DEFAULT 'teacher' CHECK (role = 'teacher'),
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 50),
  -- Assigned automatically (spec 5.2), shown on calendar blocks.
  color        text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  pricing_model text NOT NULL DEFAULT 'per_session'
                 CHECK (pricing_model IN ('per_session', 'per_month')),
  -- Only a suggestion shown next to each student's amount (spec 5.2, 5.8); never changes what
  -- a student owes. Millimes: 20.000 DT = 20000.
  reference_price_millimes integer
                 CHECK (reference_price_millimes IS NULL OR reference_price_millimes BETWEEN 0 AND 10000000),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (teacher_id, role) REFERENCES users (id, role) ON DELETE CASCADE,
  -- Target of the composite foreign key of sessions: a session belongs to a group of the
  -- SAME teacher, whatever the application does.
  UNIQUE (id, teacher_id),
  CHECK (end_date >= start_date),
  -- The period is at most 14 months (spec 5.2).
  CHECK (end_date <= (start_date + interval '14 months')::date)
);
-- The name is unique among the teacher's ACTIVE groups (spec 5.2), whatever the letter case.
CREATE UNIQUE INDEX groups_active_name_idx
  ON groups (teacher_id, lower(btrim(name))) WHERE status = 'active';
CREATE INDEX groups_teacher_idx ON groups (teacher_id, status);

-- Weekday 1 = Monday ... 7 = Sunday (weeks start Monday, spec 1). Up to 3 sessions a day.
CREATE TABLE schedule_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  slot_no    smallint NOT NULL CHECK (slot_no BETWEEN 1 AND 3),
  start_time time NOT NULL CHECK (extract(second FROM start_time) = 0),
  end_time   time NOT NULL CHECK (extract(second FROM end_time) = 0),
  CHECK (end_time > start_time),
  UNIQUE (group_id, weekday, slot_no),
  -- Sessions of the same day of one group do not overlap (spec 5.2 step 3).
  EXCLUDE USING gist (
    group_id WITH =,
    weekday WITH =,
    tsrange(date '2000-01-01' + start_time, date '2000-01-01' + end_time) WITH &&
  )
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    uuid NOT NULL,
  group_id      uuid NOT NULL,
  date          date NOT NULL,
  start_time    time NOT NULL CHECK (extract(second FROM start_time) = 0),
  end_time      time NOT NULL CHECK (extract(second FROM end_time) = 0),
  -- cancelled = "Supprimer" of one occurrence: it disappears from the calendar and can be
  -- restored (spec 5.3).
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  -- rule: generated from the weekly pattern. moved: "Modifier date". extra: "Ajouter une séance".
  origin        text NOT NULL CHECK (origin IN ('rule', 'moved', 'extra')),
  original_date date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (group_id, teacher_id) REFERENCES groups (id, teacher_id) ON DELETE CASCADE,
  CHECK (end_time > start_time),
  CHECK ((origin = 'moved') = (original_date IS NOT NULL)),

  -- THE overlap rule (spec 5.3, invariant 9): two scheduled sessions of the same teacher can
  -- never overlap, whatever the screen, the device or the two requests at the same moment.
  CONSTRAINT no_teacher_overlap EXCLUDE USING gist (
    teacher_id WITH =,
    tsrange(date + start_time, date + end_time) WITH &&
  ) WHERE (status = 'scheduled')
);
CREATE INDEX sessions_teacher_date_idx ON sessions (teacher_id, date);
CREATE INDEX sessions_group_date_idx ON sessions (group_id, date);

CREATE TRIGGER groups_set_updated_at BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sessions_set_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
