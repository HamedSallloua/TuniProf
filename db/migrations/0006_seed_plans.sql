-- Plans and prices (spec 2.1), in millimes: 40.500 DT = 40500.
-- The admin edits these later in the admin panel; nothing in the code uses these numbers.
-- Arabic names: owner to review.
INSERT INTO plans (slug, name_fr, name_ar, duration_days, price_visibility_millimes, price_with_dashboard_millimes, sort_order) VALUES
  ('mensuel',     'Mensuel',     'شهري',   30,  15000,  25000,  1),
  ('trimestriel', 'Trimestriel', 'ثلاثي',  90,  40500,  65000,  2),
  ('semestriel',  'Semestriel',  'سداسي',  180, 72000,  111000, 3),
  ('annuel',      'Annuel',      'سنوي',   365, 120000, 180000, 4)
ON CONFLICT (slug) DO NOTHING;
