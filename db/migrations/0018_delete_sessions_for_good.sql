-- "Supprimer" a session now deletes it for good (owner decision after M8): there is no
-- "cancelled" state and no "Restaurer" any more.
-- Sessions that were only cancelled are deleted here, since they were already gone from the
-- calendar. Groups can also get sessions picked by hand in a calendar (origin 'manual').

DELETE FROM sessions WHERE status = 'cancelled';

ALTER TABLE sessions DROP CONSTRAINT no_teacher_overlap;
ALTER TABLE sessions DROP COLUMN status;
ALTER TABLE sessions ADD CONSTRAINT no_teacher_overlap EXCLUDE USING gist (
  teacher_id WITH =,
  tsrange(date + start_time, date + end_time) WITH &&
);

ALTER TABLE sessions DROP CONSTRAINT sessions_origin_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_origin_check
  CHECK (origin IN ('rule', 'moved', 'extra', 'manual'));
