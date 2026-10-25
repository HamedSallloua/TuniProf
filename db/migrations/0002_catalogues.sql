-- Catalogue tables (spec section 7): admin-editable reference data.
-- Every table: uuid key, a stable slug (used in URLs and by seed scripts),
-- French and Arabic names, created_at / updated_at. Money is integer millimes.

CREATE TABLE governorates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_fr    text NOT NULL CHECK (btrim(name_fr) <> ''),
  name_ar    text NOT NULL CHECK (btrim(name_ar) <> ''),
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delegations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  governorate_id uuid NOT NULL REFERENCES governorates (id),
  slug           text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_fr        text NOT NULL CHECK (btrim(name_fr) <> ''),
  -- Arabic name is optional until the owner's list provides it.
  name_ar        text CHECK (name_ar IS NULL OR btrim(name_ar) <> ''),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (governorate_id, slug)
);
CREATE INDEX delegations_governorate_id_idx ON delegations (governorate_id);

CREATE TABLE levels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- cycle groups levels for the "group shortcuts" of the profile form (spec 4.2).
  cycle      text NOT NULL CHECK (cycle IN ('primaire', 'preparatoire', 'secondaire', 'universite')),
  grade      smallint NOT NULL CHECK (grade > 0),
  name_fr    text NOT NULL CHECK (btrim(name_fr) <> ''),
  name_ar    text NOT NULL CHECK (btrim(name_ar) <> ''),
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle, grade)
);

CREATE TABLE subjects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_fr    text NOT NULL CHECK (btrim(name_fr) <> ''),
  name_ar    text NOT NULL CHECK (btrim(name_ar) <> ''),
  -- "Autre" (spec 4.2): a subject typed by a teacher stays 'pending' until an admin approves it.
  status     text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending')),
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plans (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_fr                     text NOT NULL CHECK (btrim(name_fr) <> ''),
  name_ar                     text NOT NULL CHECK (btrim(name_ar) <> ''),
  duration_days               integer NOT NULL CHECK (duration_days > 0),
  -- Visibility-only price, and price of the bundle with the Dashboard (millimes: 40.500 DT = 40500).
  price_visibility_millimes   integer NOT NULL CHECK (price_visibility_millimes >= 0),
  price_with_dashboard_millimes integer NOT NULL CHECK (price_with_dashboard_millimes >= 0),
  sort_order                  integer NOT NULL DEFAULT 0,
  is_active                   boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  -- The bundle includes the visibility, so it can never cost less.
  CHECK (price_with_dashboard_millimes >= price_visibility_millimes)
);

CREATE TRIGGER governorates_set_updated_at BEFORE UPDATE ON governorates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER delegations_set_updated_at BEFORE UPDATE ON delegations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER levels_set_updated_at BEFORE UPDATE ON levels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subjects_set_updated_at BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
