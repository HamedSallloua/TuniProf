-- Reviews (spec 3.5, 7, invariant 8): one review per reviewer and teacher, moderated before
-- publishing, one public reply from the teacher, and a rating cached on the profile.

CREATE TABLE reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id     uuid NOT NULL REFERENCES teacher_profiles (user_id) ON DELETE CASCADE,
  author_id      uuid NOT NULL,
  -- Always 'visitor': together with the foreign key below, only a reviewer account can
  -- write a review. A teacher or an admin never can (spec 3.5). Since one phone number has
  -- exactly one account and one role (M2), a review "from the teacher's own phone number"
  -- is impossible by construction.
  author_role    text NOT NULL DEFAULT 'visitor' CHECK (author_role = 'visitor'),
  rating         smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        text CHECK (comment IS NULL OR (btrim(comment) <> '' AND char_length(comment) <= 500)),
  -- pending: waiting for moderation. published: shown. rejected: never shown.
  -- hidden: was published, taken down by an admin (after a report, for example).
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'published', 'rejected', 'hidden')),
  -- The teacher's one public reply (spec 3.5).
  teacher_reply  text CHECK (teacher_reply IS NULL OR (btrim(teacher_reply) <> '' AND char_length(teacher_reply) <= 500)),
  replied_at     timestamptz,
  moderated_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  moderated_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (author_id, author_role) REFERENCES users (id, role) ON DELETE CASCADE,
  -- One review per account and teacher (acceptance test 15).
  UNIQUE (teacher_id, author_id),
  CHECK ((teacher_reply IS NULL) = (replied_at IS NULL)),
  -- A reply only exists on a review that was published at some point.
  CHECK (teacher_reply IS NULL OR status IN ('published', 'hidden'))
);
CREATE INDEX reviews_teacher_idx ON reviews (teacher_id, status, created_at DESC);
CREATE INDEX reviews_status_idx ON reviews (status, created_at);
CREATE INDEX reviews_author_idx ON reviews (author_id, created_at);

CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- At most 3 reviews per account per day (spec 3.5, acceptance test 15): a rolling 24 hours,
-- whatever the status of the earlier reviews. The lock makes two reviews sent at the same
-- moment count one after the other. SQLSTATE TP002 lets the application tell this refusal
-- from the others.
CREATE FUNCTION reviews_limit_per_day() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('review-day:' || NEW.author_id::text));
  IF (SELECT count(*) FROM reviews
       WHERE author_id = NEW.author_id
         AND created_at > NEW.created_at - interval '24 hours'
         AND created_at <= NEW.created_at) >= 3 THEN
    RAISE EXCEPTION 'reviewer % already wrote 3 reviews in 24 hours', NEW.author_id
      USING ERRCODE = 'TP002';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reviews_limit_per_day BEFORE INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION reviews_limit_per_day();

-- rating_avg and rating_count on the profile count PUBLISHED reviews only, and are kept in
-- step by the database itself so no code path can forget to update them.
CREATE FUNCTION refresh_teacher_rating(p_teacher uuid) RETURNS void
LANGUAGE sql AS $$
  UPDATE teacher_profiles p
     SET rating_count = s.n, rating_avg = s.average
    FROM (SELECT count(*)::int AS n,
                 COALESCE(round(avg(rating)::numeric, 2), 0) AS average
            FROM reviews
           WHERE teacher_id = p_teacher AND status = 'published') s
   WHERE p.user_id = p_teacher
$$;

CREATE FUNCTION reviews_refresh_rating() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_teacher_rating(OLD.teacher_id);
    RETURN OLD;
  END IF;
  PERFORM refresh_teacher_rating(NEW.teacher_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER reviews_refresh_rating
  AFTER INSERT OR DELETE OR UPDATE OF status, rating ON reviews
  FOR EACH ROW EXECUTE FUNCTION reviews_refresh_rating();

-- Reports now also cover reviews (spec 3.5: the teacher may report a review). A report with
-- review_id NULL is about a profile (M5); otherwise about that review, written by the
-- teacher who received it.
ALTER TABLE reports ADD COLUMN review_id uuid REFERENCES reviews (id) ON DELETE CASCADE;

ALTER TABLE reports DROP CONSTRAINT reports_reason_check;
ALTER TABLE reports ADD CONSTRAINT reports_reason_check
  CHECK (reason IN ('wrong_info', 'inappropriate', 'suspected_fraud', 'other', 'fake_review'));
ALTER TABLE reports ADD CONSTRAINT report_reason_matches_target
  CHECK (CASE WHEN review_id IS NULL
              THEN reason <> 'fake_review'
              ELSE reason IN ('inappropriate', 'fake_review', 'other') END);
ALTER TABLE reports ADD CONSTRAINT review_report_has_reporter
  CHECK (review_id IS NULL OR reporter_id IS NOT NULL);

-- One open report per browser and profile (M5), and one per teacher and review.
DROP INDEX reports_one_open_per_browser_idx;
CREATE UNIQUE INDEX reports_one_open_profile_per_browser_idx
  ON reports (teacher_id, session_hash) WHERE status = 'open' AND review_id IS NULL;
CREATE UNIQUE INDEX reports_one_open_per_review_idx
  ON reports (review_id, reporter_id) WHERE status = 'open' AND review_id IS NOT NULL;
CREATE INDEX reports_review_idx ON reports (review_id) WHERE review_id IS NOT NULL;
