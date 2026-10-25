-- Subjects (spec 4.2), all approved. "Autre" is not a row: a teacher's own subject
-- is added later with status 'pending' until an admin approves it.
-- Arabic names: owner to review.
INSERT INTO subjects (slug, name_fr, name_ar, sort_order) VALUES
  ('anglais',              'Anglais',               'الإنجليزية',          1),
  ('arabe',                'Arabe',                 'العربية',             2),
  ('francais',             'Français',              'الفرنسية',            3),
  ('histoire-geo',         'Histoire-Géo',          'التاريخ والجغرافيا',   4),
  ('informatique',         'Informatique',          'الإعلامية',           5),
  ('mathematiques',        'Mathématiques',         'الرياضيات',           6),
  ('philosophie',          'Philosophie',           'الفلسفة',             7),
  ('physique',             'Physique',              'الفيزياء',            8),
  ('sciences-naturelles',  'Sciences Naturelles',   'علوم الحياة والأرض',   9),
  ('economie',             'Économie',              'الاقتصاد',            10),
  ('chimie',               'Chimie',                'الكيمياء',            11),
  ('allemand',             'Allemand',              'الألمانية',           12),
  ('italien',              'Italien',               'الإيطالية',           13),
  ('espagnol',             'Espagnol',              'الإسبانية',           14),
  ('technologie',          'Technologie',           'التكنولوجيا',         15),
  ('gestion-comptabilite', 'Gestion/Comptabilité',  'التصرف والمحاسبة',     16),
  ('eveil-scientifique',   'Éveil scientifique',    'الإيقاظ العلمي',       17)
ON CONFLICT (slug) DO NOTHING;
