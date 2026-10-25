-- Levels (spec 4.2): Primaire 1-6, Préparatoire 7-9, Secondaire 1-4, Université L1-L3.
-- Arabic names: owner to review.
INSERT INTO levels (slug, cycle, grade, name_fr, name_ar, sort_order) VALUES
  ('primaire-1',     'primaire',     1, 'Primaire 1',     'السنة الأولى ابتدائي',  1),
  ('primaire-2',     'primaire',     2, 'Primaire 2',     'السنة الثانية ابتدائي', 2),
  ('primaire-3',     'primaire',     3, 'Primaire 3',     'السنة الثالثة ابتدائي', 3),
  ('primaire-4',     'primaire',     4, 'Primaire 4',     'السنة الرابعة ابتدائي', 4),
  ('primaire-5',     'primaire',     5, 'Primaire 5',     'السنة الخامسة ابتدائي', 5),
  ('primaire-6',     'primaire',     6, 'Primaire 6',     'السنة السادسة ابتدائي', 6),
  ('preparatoire-7', 'preparatoire', 7, 'Préparatoire 7', 'السنة السابعة أساسي',   7),
  ('preparatoire-8', 'preparatoire', 8, 'Préparatoire 8', 'السنة الثامنة أساسي',   8),
  ('preparatoire-9', 'preparatoire', 9, 'Préparatoire 9', 'السنة التاسعة أساسي',   9),
  ('secondaire-1',   'secondaire',   1, 'Secondaire 1',   'السنة الأولى ثانوي',    10),
  ('secondaire-2',   'secondaire',   2, 'Secondaire 2',   'السنة الثانية ثانوي',   11),
  ('secondaire-3',   'secondaire',   3, 'Secondaire 3',   'السنة الثالثة ثانوي',   12),
  ('secondaire-4',   'secondaire',   4, 'Secondaire 4',   'السنة الرابعة ثانوي',   13),
  ('universite-l1',  'universite',   1, 'Université L1',  'إجازة 1',               14),
  ('universite-l2',  'universite',   2, 'Université L2',  'إجازة 2',               15),
  ('universite-l3',  'universite',   3, 'Université L3',  'إجازة 3',               16)
ON CONFLICT (slug) DO NOTHING;
