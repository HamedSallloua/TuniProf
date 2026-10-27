-- Entitlements, payment requests, activation codes, founding claims (spec 2.2 to 2.6, 4.3, 7).
-- Money is integer millimes. Dates are instants (timestamptz); a plan adds whole days.

-- Two INDEPENDENT expiry dates per teacher (invariant 2). Days bought before the profile is
-- approved wait as credit (pending_*) and start at approval (invariant 3).
CREATE TABLE entitlements (
  teacher_id              uuid PRIMARY KEY,
  role                    text NOT NULL DEFAULT 'teacher' CHECK (role = 'teacher'),
  visibility_until        timestamptz,
  dashboard_until         timestamptz,
  pending_visibility_days integer NOT NULL DEFAULT 0 CHECK (pending_visibility_days >= 0),
  pending_dashboard_days  integer NOT NULL DEFAULT 0 CHECK (pending_dashboard_days >= 0),
  -- The plan of the latest purchase: the price of a later Dashboard upgrade depends on it.
  last_plan_id            uuid REFERENCES plans (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (teacher_id, role) REFERENCES users (id, role) ON DELETE CASCADE
);

CREATE TABLE payment_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id           uuid NOT NULL REFERENCES plans (id),
  -- 'plan': a plan purchase or renewal. 'upgrade': adds the Dashboard to the current term.
  kind              text NOT NULL DEFAULT 'plan' CHECK (kind IN ('plan', 'upgrade')),
  with_dashboard    boolean NOT NULL,
  -- Dashboard days granted by an upgrade (the remaining visibility days when requested).
  upgrade_dashboard_days integer CHECK (upgrade_dashboard_days IS NULL OR upgrade_dashboard_days > 0),
  -- The exact amount to pay, fixed when the request is made (later price changes do not touch it).
  amount_millimes   integer NOT NULL CHECK (amount_millimes > 0),
  method            text NOT NULL CHECK (method IN ('flouci', 'd17', 'ccp')),
  -- Shown to the teacher and written on the payment, e.g. TTP-48213.
  reference         text NOT NULL UNIQUE CHECK (reference ~ '^TTP-[0-9]{5}$'),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'proof_received', 'verified', 'rejected', 'cancelled')),
  -- The bank or wallet transaction number: the same proof can never be used twice (spec 13.3).
  transaction_ref   text UNIQUE CHECK (transaction_ref IS NULL OR btrim(transaction_ref) <> ''),
  transaction_date  date,
  note              text CHECK (note IS NULL OR char_length(note) <= 500),
  handled_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  handled_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upgrade_has_dashboard
    CHECK (kind = 'plan' OR (with_dashboard AND upgrade_dashboard_days IS NOT NULL)),
  CONSTRAINT verified_has_transaction
    CHECK (status <> 'verified' OR (transaction_ref IS NOT NULL AND transaction_date IS NOT NULL))
);
-- One open request per teacher at a time.
CREATE UNIQUE INDEX payment_requests_one_open_idx
  ON payment_requests (teacher_id) WHERE status IN ('pending', 'proof_received');
CREATE INDEX payment_requests_status_idx ON payment_requests (status, created_at);

-- Activation codes (spec 2.4). The code itself is not stored: it is derived from the id and
-- the server secret (like the WhatsApp codes), and only its keyed hash is kept.
CREATE TABLE activation_codes (
  id                 uuid PRIMARY KEY,
  code_hash          text NOT NULL UNIQUE,
  plan_id            uuid NOT NULL REFERENCES plans (id),
  visibility_days    integer NOT NULL CHECK (visibility_days >= 0),
  dashboard_days     integer NOT NULL CHECK (dashboard_days >= 0),
  -- One code answers one payment request, and can only be redeemed by that request's teacher.
  payment_request_id uuid NOT NULL UNIQUE REFERENCES payment_requests (id),
  teacher_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'issued'
                       CHECK (status IN ('issued', 'redeemed', 'revoked', 'expired')),
  redeemed_at        timestamptz,
  expires_at         timestamptz NOT NULL,
  issued_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  revoked_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (visibility_days + dashboard_days > 0),
  CHECK ((status = 'redeemed') = (redeemed_at IS NOT NULL)),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

-- Every addition of days, whatever its source (spec 7: entitlement_grants).
CREATE TABLE entitlement_grants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source             text NOT NULL CHECK (source IN ('code', 'founding', 'admin')),
  visibility_days    integer NOT NULL CHECK (visibility_days >= 0),
  dashboard_days     integer NOT NULL CHECK (dashboard_days >= 0),
  granted_at         timestamptz NOT NULL DEFAULT now(),
  -- Stored as credit because the profile was not approved yet; started_at is set at approval.
  as_credit          boolean NOT NULL DEFAULT false,
  started_at         timestamptz,
  activation_code_id uuid REFERENCES activation_codes (id),
  payment_request_id uuid REFERENCES payment_requests (id),
  granted_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  note               text CHECK (note IS NULL OR char_length(note) <= 500),
  revoked_at         timestamptz,
  CHECK (visibility_days + dashboard_days > 0),
  -- A manual grant by an admin always carries a written reason (spec 6).
  CHECK (source <> 'admin' OR (granted_by IS NOT NULL AND note IS NOT NULL AND btrim(note) <> '')),
  CHECK (source <> 'code' OR activation_code_id IS NOT NULL),
  CHECK (as_credit OR started_at IS NOT NULL)
);
CREATE INDEX entitlement_grants_teacher_idx ON entitlement_grants (teacher_id, granted_at);
-- A code can only ever be redeemed once.
CREATE UNIQUE INDEX entitlement_grants_one_per_code_idx
  ON entitlement_grants (activation_code_id) WHERE activation_code_id IS NOT NULL;

-- One founding year per phone number (spec 2.6). The row stays even if the account is deleted,
-- so the same number cannot claim a second slot.
CREATE TABLE founding_claims (
  phone_e164 text PRIMARY KEY CHECK (phone_e164 ~ '^\+216[2459][0-9]{7}$'),
  user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  grant_id   uuid REFERENCES entitlement_grants (id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER entitlements_set_updated_at BEFORE UPDATE ON entitlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payment_requests_set_updated_at BEFORE UPDATE ON payment_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER activation_codes_set_updated_at BEFORE UPDATE ON activation_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- THE visibility rule (spec 2.3, invariant 1), written once. Search, the profile page and the
-- sitemap all go through it (M5). Visible if and only if:
--   approved AND listed AND visibility_until in the future AND all required fields complete
--   AND the account is not suspended.
CREATE FUNCTION teacher_is_visible(p_user uuid, p_at timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT p.status = 'approved'
       AND p.is_listed
       AND e.visibility_until > p_at
       AND profile_is_complete(p.user_id)
       AND u.status = 'active'
    FROM teacher_profiles p
    JOIN users u ON u.id = p.user_id
    JOIN entitlements e ON e.teacher_id = p.user_id
    WHERE p.user_id = p_user
  ), false)
$$;

-- The public side of a profile: only visible teachers, and never a phone number.
CREATE VIEW visible_teacher_profiles AS
SELECT p.user_id, p.slug, p.full_name, p.photo_key, p.diploma, p.experience, p.bio,
       p.governorate_id, p.modes, p.rating_avg, p.rating_count, p.approved_at
FROM teacher_profiles p
WHERE teacher_is_visible(p.user_id);
