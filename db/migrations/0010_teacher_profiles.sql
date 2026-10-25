-- Teacher profiles (spec 4.2, 2.5, 7) and the rules that must hold whatever the app does.

-- Targets of composite foreign keys below.
ALTER TABLE users ADD CONSTRAINT users_id_role_key UNIQUE (id, role);
ALTER TABLE delegations ADD CONSTRAINT delegations_id_governorate_key UNIQUE (id, governorate_id);

-- "Autre" (spec 4.2): a subject suggested by a teacher stays 'pending' until an admin approves it.
ALTER TABLE subjects ADD COLUMN suggested_by uuid REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE teacher_profiles (
  user_id      uuid PRIMARY KEY,
  -- Always 'teacher': together with the foreign key below, only a teacher account can
  -- own a profile (an admin or a reviewer never can).
  role         text NOT NULL DEFAULT 'teacher' CHECK (role = 'teacher'),
  -- Public address /prof/{slug}. Set at the first approval, then never changed.
  slug         text UNIQUE CHECK (slug IS NULL OR slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  full_name    text CHECK (full_name IS NULL OR char_length(btrim(full_name)) BETWEEN 2 AND 60),
  -- Storage key of the photo (e.g. photos/<uuid>.jpg), never a full address.
  photo_key    text CHECK (photo_key IS NULL OR photo_key ~ '^photos/[0-9a-f-]{36}\.jpg$'),
  diploma      text CHECK (diploma IS NULL OR diploma IN (
                 'primary_teacher', 'middle_school_teacher', 'high_school_teacher',
                 'university_teacher', 'student', 'engineer_executive', 'other_graduate')),
  experience   text CHECK (experience IS NULL OR experience IN (
                 'lt_1', '1_3', '3_5', '5_10', '10_15', 'gt_15')),
  bio          text CHECK (bio IS NULL OR char_length(bio) BETWEEN 30 AND 600),
  governorate_id uuid REFERENCES governorates (id),
  modes        text[] NOT NULL DEFAULT '{}'
                 CHECK (modes <@ ARRAY['at_home', 'at_teacher', 'online']),
  status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'suspended')),
  -- Reason of the last refusal: a template code, plus an optional free note.
  rejection_reason text,
  rejection_note   text CHECK (rejection_note IS NULL OR char_length(rejection_note) <= 500),
  suspension_reason text CHECK (suspension_reason IS NULL OR char_length(suspension_reason) <= 500),
  -- The teacher can pause the public listing (spec 2.3).
  is_listed    boolean NOT NULL DEFAULT true,
  rating_avg   numeric(3, 2) NOT NULL DEFAULT 0 CHECK (rating_avg BETWEEN 0 AND 5),
  rating_count integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  -- Edits to name, photo, bio and diploma of an APPROVED profile wait here for review while
  -- the old approved version stays live: {full_name, photo_key, bio, diploma, submitted_at}.
  pending_version jsonb CHECK (pending_version IS NULL OR jsonb_typeof(pending_version) = 'object'),
  version_rejection_reason text,
  version_rejection_note   text CHECK (version_rejection_note IS NULL OR char_length(version_rejection_note) <= 500),
  submitted_at timestamptz,
  approved_at  timestamptz,
  reviewed_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (user_id, role) REFERENCES users (id, role) ON DELETE CASCADE,
  -- Target of the zones' foreign key: a zone must belong to the profile's governorate.
  UNIQUE (user_id, governorate_id)
);
CREATE INDEX teacher_profiles_status_idx ON teacher_profiles (status, submitted_at);
CREATE INDEX teacher_profiles_governorate_idx ON teacher_profiles (governorate_id);

CREATE TABLE teacher_levels (
  teacher_id uuid NOT NULL REFERENCES teacher_profiles (user_id) ON DELETE CASCADE,
  level_id   uuid NOT NULL REFERENCES levels (id),
  PRIMARY KEY (teacher_id, level_id)
);

-- A zone is a délégation OF THE PROFILE'S GOVERNORATE, enforced by two composite foreign
-- keys. To change governorate, the zones are removed first (the app does it in one step).
CREATE TABLE teacher_zones (
  teacher_id     uuid NOT NULL,
  governorate_id uuid NOT NULL,
  delegation_id  uuid NOT NULL,
  PRIMARY KEY (teacher_id, delegation_id),
  FOREIGN KEY (teacher_id, governorate_id)
    REFERENCES teacher_profiles (user_id, governorate_id) ON DELETE CASCADE,
  FOREIGN KEY (delegation_id, governorate_id)
    REFERENCES delegations (id, governorate_id)
);

CREATE TABLE teacher_subjects (
  teacher_id uuid NOT NULL REFERENCES teacher_profiles (user_id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects (id),
  -- Millimes: 25.500 DT = 25500. The allowed range lives in settings (profile.rate_*).
  hourly_rate_millimes integer NOT NULL CHECK (hourly_rate_millimes > 0),
  PRIMARY KEY (teacher_id, subject_id)
);

CREATE TRIGGER teacher_profiles_set_updated_at BEFORE UPDATE ON teacher_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- THE definition of "all required fields are complete" (spec 2.3, invariant 1). Used when
-- a profile is submitted and approved, and later by the public visibility view (M4, M5).
CREATE FUNCTION profile_is_complete(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT p.full_name IS NOT NULL
       AND p.diploma IS NOT NULL
       AND p.experience IS NOT NULL
       AND p.bio IS NOT NULL
       AND p.governorate_id IS NOT NULL
       AND cardinality(p.modes) >= 1
       AND EXISTS (SELECT 1 FROM teacher_levels l WHERE l.teacher_id = p.user_id)
       AND EXISTS (SELECT 1 FROM teacher_subjects s WHERE s.teacher_id = p.user_id)
       -- Zones are required unless the only mode is "en ligne".
       AND (p.modes = ARRAY['online']
            OR EXISTS (SELECT 1 FROM teacher_zones z WHERE z.teacher_id = p.user_id))
       AND u.phone_verified_at IS NOT NULL
    FROM teacher_profiles p
    JOIN users u ON u.id = p.user_id
    WHERE p.user_id = p_user_id
  ), false)
$$;

-- A profile can only be submitted or approved when it is complete, whoever asks.
CREATE FUNCTION teacher_profiles_require_complete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('pending', 'approved') THEN
    -- Only when the status changes (OLD does not exist on INSERT).
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = NEW.status THEN
        RETURN NEW;
      END IF;
    END IF;
    IF NOT profile_is_complete(NEW.user_id) THEN
      RAISE EXCEPTION 'profile % is incomplete and cannot become %', NEW.user_id, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER teacher_profiles_require_complete
  BEFORE INSERT OR UPDATE OF status ON teacher_profiles
  FOR EACH ROW EXECUTE FUNCTION teacher_profiles_require_complete();
