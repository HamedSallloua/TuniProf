-- Dashboard: students and memberships (spec 5.6, 5.7, 7; invariants 14, 15, 16).
-- A student exists ONCE per teacher and is linked to groups through memberships.

CREATE TABLE students (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    uuid NOT NULL,
  -- Always 'teacher': only a teacher account owns students.
  role          text NOT NULL DEFAULT 'teacher' CHECK (role = 'teacher'),
  full_name     text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 80),
  -- The name as searched: lower case, no accents, no Arabic diacritics (written by the
  -- application with the same function as the search; spec 7).
  full_name_norm text NOT NULL CHECK (full_name_norm <> ''),
  -- Optional, Tunisian mobile number in E.164 (spec 4.1): "+21622345678".
  phone         text CHECK (phone IS NULL OR phone ~ '^\+216[2459][0-9]{7}$'),
  -- The digits of the phone, searched anywhere in the number: "21622345678".
  phone_digits  text CHECK ((phone IS NULL) = (phone_digits IS NULL)),
  note          text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 300),
  -- The note as searched (same normalisation as the name).
  note_norm     text CHECK ((note IS NULL) = (note_norm IS NULL)),
  -- "Archiver": hidden from the lists and the pickers, history kept (spec 5.7).
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (teacher_id, role) REFERENCES users (id, role) ON DELETE CASCADE,
  -- Target of the composite foreign key of memberships: a membership links a student and a
  -- group of the SAME teacher, whatever the application does (invariant 16).
  UNIQUE (id, teacher_id)
);
CREATE INDEX students_teacher_idx ON students (teacher_id, archived_at);
-- Server-side search above about 200 students (spec 5.7): LIKE '%...%' uses these indexes.
CREATE INDEX students_name_trgm_idx ON students USING gin (full_name_norm gin_trgm_ops);
CREATE INDEX students_phone_trgm_idx ON students USING gin (phone_digits gin_trgm_ops);
CREATE INDEX students_note_trgm_idx ON students USING gin (note_norm gin_trgm_ops);

-- A student's presence in ONE group (spec 5.1). Leaving ends it (`left_on`), the history stays;
-- coming back later is a new row (spec 5.7).
CREATE TABLE memberships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    uuid NOT NULL,
  group_id      uuid NOT NULL,
  student_id    uuid NOT NULL,
  joined_on     date NOT NULL,
  left_on       date,
  -- For the siblings discount of M10 (spec 5.8); not used before.
  default_discount_millimes integer NOT NULL DEFAULT 0 CHECK (default_discount_millimes >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (group_id, teacher_id) REFERENCES groups (id, teacher_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id, teacher_id) REFERENCES students (id, teacher_id) ON DELETE CASCADE,
  CHECK (left_on IS NULL OR left_on >= joined_on)
);
-- A student is in a group once at a time: no second open membership (spec 5.6, 5.7).
CREATE UNIQUE INDEX memberships_open_idx
  ON memberships (group_id, student_id) WHERE left_on IS NULL;
CREATE INDEX memberships_student_idx ON memberships (student_id);
CREATE INDEX memberships_group_idx ON memberships (group_id);

CREATE TRIGGER students_set_updated_at BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
