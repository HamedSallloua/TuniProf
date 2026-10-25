'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** Re-reads the page every few seconds, so it notices when the WhatsApp message arrived. */
export function AutoRefresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}

/** A form that submits itself once shown. A visible button stays as a fallback. */
export function AutoSubmitForm({
  action,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);
  useEffect(() => {
    // Development mode runs effects twice; a verification must be finished only once.
    if (submitted.current) return;
    submitted.current = true;
    ref.current?.requestSubmit();
  }, []);
  return (
    <form ref={ref} action={action}>
      {children}
    </form>
  );
}
