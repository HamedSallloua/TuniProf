-- Student archiving is removed (owner request after M9): a student is either in the list or
-- deleted for good. Students that were archived simply become normal students again.

ALTER TABLE students DROP COLUMN archived_at;
-- The old index covered (teacher_id, archived_at) and went with the column.
CREATE INDEX students_teacher_idx ON students (teacher_id);
