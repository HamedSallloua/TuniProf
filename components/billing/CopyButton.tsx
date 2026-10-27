'use client';

import { useState } from 'react';
import { secondaryButtonClass } from '@/components/auth/styles';

/** Copies a text to the clipboard and says so. Used for the payment proof message. */
export function CopyButton({
  text,
  label,
  copiedLabel,
}: {
  text: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopied(false); // the browser refused: the text stays visible to copy by hand
          }
        }}
      >
        {label}
      </button>
      {copied && (
        <span role="status" className="text-sm text-primary">
          {copiedLabel}
        </span>
      )}
    </span>
  );
}
