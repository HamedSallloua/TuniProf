-- WhatsApp verification, rate limits and webhook de-duplication (spec 8.5, 8.2).

-- One row per verification attempt started on the site ("send-to-verify").
-- The code itself is never stored: only an HMAC of it (code_hash). The screen
-- recomputes the code from the challenge id and the server secret.
CREATE TABLE otp_challenges (
  id            uuid PRIMARY KEY,
  phone_e164    text NOT NULL CHECK (phone_e164 ~ '^\+216[2459][0-9]{7}$'),
  purpose       text NOT NULL CHECK (purpose IN ('signup', 'reset', 'visitor_login')),
  channel       text NOT NULL DEFAULT 'whatsapp_inbound'
                  CHECK (channel IN ('whatsapp_inbound', 'whatsapp_template')),
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  -- Wrong tries so far. At 5 the challenge locks for one hour (locked_until).
  attempts      smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_until  timestamptz,
  verified_at   timestamptz,
  -- Set when the verified challenge has been used (session created, password reset).
  consumed_at   timestamptz,
  user_id       uuid REFERENCES users (id) ON DELETE CASCADE,
  -- The browser that started the challenge; only it can finish it.
  device_hash   text NOT NULL,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consumed_only_when_verified
    CHECK (consumed_at IS NULL OR verified_at IS NOT NULL)
);
CREATE INDEX otp_challenges_phone_idx ON otp_challenges (phone_e164, created_at DESC);
CREATE INDEX otp_challenges_open_code_idx ON otp_challenges (code_hash)
  WHERE verified_at IS NULL;

CREATE TRIGGER otp_challenges_set_updated_at BEFORE UPDATE ON otp_challenges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Meta may deliver the same WhatsApp message more than once. One row per message
-- we have already handled, so a retry never counts as a second attempt.
CREATE TABLE webhook_events (
  provider    text NOT NULL,
  message_id  text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, message_id)
);

-- Sliding-window rate limits: one row per counted event (login failure, code request...).
-- Old rows are cleaned by the daily job (M7).
CREATE TABLE rate_limit_events (
  id         bigserial PRIMARY KEY,
  bucket     text NOT NULL,
  key        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_limit_events_lookup_idx ON rate_limit_events (bucket, key, created_at);
