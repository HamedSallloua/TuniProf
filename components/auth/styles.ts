// Class strings shared by forms, buttons and links. They live outside ui.tsx
// ('use client'): a server page importing a string from a client file receives
// a client reference instead of the text, and the styles silently vanish.

export const inputClass =
  'block w-full min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-foreground aria-[invalid=true]:border-accent aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-accent';

export const buttonClass =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 font-medium text-primary-foreground hover:bg-accent disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-primary bg-surface px-5 font-medium text-primary hover:bg-secondary';

export const linkClass =
  'text-primary underline underline-offset-2 hover:text-accent';
