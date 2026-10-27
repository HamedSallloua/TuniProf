-- Settings of the billing module (spec 2.6, 4.3, 6). All editable by the admin later (M11);
-- nothing here is hard-coded in the application.

-- Founding offer (spec 2.6): the first 100 approved teachers get 365 days free.
-- Assumption to be confirmed by the owner: the free year includes the Dashboard.
INSERT INTO settings (key, value) VALUES
  ('founding.slots_total', '100'),
  ('founding.slots_used', '0'),
  ('founding.days', '365'),
  ('founding.grant_visibility', 'true'),
  ('founding.grant_dashboard', 'true')
ON CONFLICT (key) DO NOTHING;

-- Payment accounts. These are FAKE PLACEHOLDERS: they are shown only in development, and
-- only until the owner replaces them and sets payment.configured to true.
-- In production, payment instructions stay hidden while payment.configured is false.
INSERT INTO settings (key, value) VALUES
  ('payment.configured', 'false'),
  ('payment.beneficiary_name', '"PLACEHOLDER - nom du beneficiaire"'),
  ('payment.flouci_number', '"PLACEHOLDER - numero Flouci"'),
  ('payment.d17_info', '"PLACEHOLDER - D17 / e-Dinar"'),
  ('payment.ccp_number', '"PLACEHOLDER - numero CCP"'),
  ('payment.working_hours', '"PLACEHOLDER - horaires"'),
  -- Digits with country code, for wa.me links. 00000000000 cannot be a real number.
  ('payment.whatsapp_number', '"00000000000"'),
  ('payment.messenger_page', '"placeholder-page"'),
  -- The Arabic helper lines of the payment page, word for word from the owner's brief
  -- (spec 4.3). Empty until the owner provides them: they are not in the spec.
  ('payment.helper_lines_ar', '[]'),
  -- How long an unredeemed activation code stays valid (spec 2.4).
  ('codes.expiry_days', '90')
ON CONFLICT (key) DO NOTHING;
