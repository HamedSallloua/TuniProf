-- Keeps updated_at correct on every UPDATE, whoever makes the change (app, admin, SQL).
-- clock_timestamp() (not now()) so the value moves even inside one transaction.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
