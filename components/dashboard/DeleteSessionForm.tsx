'use client';

import { secondaryButtonClass } from '@/components/auth/styles';

/**
 * "Supprimer" one session: it is deleted for good, so the browser asks first. The server action
 * is given by the page, which also says where to come back to.
 */
export function DeleteSessionForm({
  action,
  sessionId,
  returnTo,
  label,
  confirmText,
}: {
  action: (formData: FormData) => Promise<void>;
  sessionId: string;
  returnTo: string;
  label: string;
  confirmText: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(confirmText)) event.preventDefault();
      }}
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="retour" value={returnTo} />
      <button type="submit" className={secondaryButtonClass}>
        {label}
      </button>
    </form>
  );
}
