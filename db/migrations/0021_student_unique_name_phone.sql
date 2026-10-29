-- M9 (second round): a teacher cannot have two students with the same name AND the same phone
-- number. The application checks it first (and says which student already exists); this index
-- is the guarantee when two requests arrive at the same moment. Students without a phone are
-- not concerned.
CREATE UNIQUE INDEX students_teacher_name_phone_key
  ON students (teacher_id, full_name_norm, phone)
  WHERE phone IS NOT NULL;
