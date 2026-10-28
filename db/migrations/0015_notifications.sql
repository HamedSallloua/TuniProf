-- Notifications queue (spec 9, 8.1, 7). One row per message and per channel:
--   site      a notice shown on the teacher's own pages (pending = unread, then read)
--   whatsapp  a message an admin copies and sends by hand from the WhatsApp Business app
--             (pending, then sent) until templates are approved by Meta (spec 8.5)
--   email     sent by the daily job through the e-mail provider (pending, then sent or failed)

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- What happened, e.g. profile_approved, plan_expiring. The text is written when it is shown.
  kind        text NOT NULL CHECK (kind ~ '^[a-z_]+$'),
  channel     text NOT NULL CHECK (channel IN ('site', 'whatsapp', 'email')),
  -- Values for the text (name, date, days, reason...). Never a secret: an activation code is
  -- never stored here.
  params      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(params) = 'object'),
  -- The same event is never queued twice for the same person and channel: this is what makes
  -- the daily job safe to run twice. Example: plan_expiring:7:2027-01-05.
  dedupe_key  text NOT NULL CHECK (btrim(dedupe_key) <> ''),
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed', 'read')),
  attempts    smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error  text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  sent_at     timestamptz,
  read_at     timestamptz,
  -- The admin who marked a WhatsApp message as sent.
  handled_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, channel, dedupe_key),
  CHECK (CASE channel
           WHEN 'site' THEN status IN ('pending', 'read')
           WHEN 'whatsapp' THEN status IN ('pending', 'sent')
           ELSE status IN ('pending', 'sent', 'failed')
         END),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CHECK ((status = 'read') = (read_at IS NOT NULL))
);
-- The admin queue and the e-mail delivery read the pending rows of one channel, oldest first.
CREATE INDEX notifications_queue_idx ON notifications (channel, status, created_at);
CREATE INDEX notifications_user_idx ON notifications (user_id, channel, status, created_at DESC);

CREATE TRIGGER notifications_set_updated_at BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
