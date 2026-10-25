-- Accounts and server-side sessions (spec 4.1, 7, 8.5).
--
-- Roles: teacher, visitor (light reviewer account), admin_super, admin_support.
-- Owner decision (M2): password_hash is NULL for visitor accounts and ONLY for them.
-- A visitor proves their phone through WhatsApp for every new session.
-- One phone number = one account = one role (phone_e164 is unique).

CREATE TABLE users (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role                     text NOT NULL
                             CHECK (role IN ('teacher', 'visitor', 'admin_super', 'admin_support')),
  -- +216 then 8 digits starting with 2, 4, 5 or 9 (spec 4.1)
  phone_e164               text NOT NULL UNIQUE
                             CHECK (phone_e164 ~ '^\+216[2459][0-9]{7}$'),
  email                    text
                             CHECK (email IS NULL
                                    OR (email = lower(email)
                                        AND length(email) <= 254
                                        AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  password_hash            text,
  phone_verified_at        timestamptz,
  -- pending: signed up, phone not yet verified. suspended: blocked by an admin.
  status                   text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'active', 'suspended')),
  -- Timestamped consents (spec 4.1). Required for teachers.
  phone_display_consent_at timestamptz,
  terms_accepted_at        timestamptz,
  last_login_at            timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT visitor_has_no_password_others_have_one
    CHECK ((role = 'visitor') = (password_hash IS NULL)),
  CONSTRAINT active_needs_verified_phone
    CHECK (status <> 'active' OR phone_verified_at IS NOT NULL),
  CONSTRAINT teacher_needs_consents
    CHECK (role <> 'teacher'
           OR (phone_display_consent_at IS NOT NULL AND terms_accepted_at IS NOT NULL))
);

CREATE TABLE auth_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 of the cookie value. The cookie value itself is never stored.
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  ip_hash      text,
  user_agent   text CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
