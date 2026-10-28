// "Come back to the profile I was reading" after the WhatsApp sign-in of a reviewer.
// Only addresses of the form /prof/{slug} are ever accepted, so the sign-in page can never be
// used to send somebody to another site (an open redirect).

const PROFILE_PATH = /^\/prof\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseReturnTo(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length <= 150 &&
    PROFILE_PATH.test(value)
    ? value
    : null;
}
