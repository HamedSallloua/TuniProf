-- Groups can no longer be archived (owner decision after M8): a group is either there or deleted.
-- The name is now unique among ALL of a teacher's groups. If two groups of one teacher share a
-- name (an archived one and an active one), this migration stops with an error instead of
-- deleting anything: rename one of them first.

DROP INDEX groups_active_name_idx;
DROP INDEX groups_teacher_idx;
ALTER TABLE groups DROP COLUMN status;
CREATE UNIQUE INDEX groups_name_idx ON groups (teacher_id, lower(btrim(name)));
CREATE INDEX groups_teacher_idx ON groups (teacher_id);
