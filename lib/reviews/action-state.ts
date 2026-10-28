// Answers of the review server actions (kept outside the 'use server' files, which may only
// export functions). `error` is a key of the matching messages group.

export type ReviewFormState = null | { sent: true } | { error: string };

export type TeacherReviewState = null | { done: true } | { error: string };
