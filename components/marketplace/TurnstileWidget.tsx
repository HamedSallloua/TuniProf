'use client';

import { useEffect, useRef, useState } from 'react';

// Cloudflare Turnstile (spec 3.4): an anti-bot check shown only after several reveals.
// The widget gives a one-time token; it travels in the hidden field `turnstileToken` and the
// server asks Cloudflare whether it is genuine (lib/marketplace/turnstile.ts).

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: { sitekey: string; callback: (token: string) => void },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // allow another try
      reject(new Error('Turnstile could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * `attempt` changes after every try: a token can be used once, so the widget is reset to
 * give a fresh one.
 */
export function TurnstileWidget({
  siteKey,
  attempt,
}: {
  siteKey: string;
  attempt: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const firstAttempt = useRef(attempt);
  const [token, setToken] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          callback: setToken,
        });
      })
      .catch(() => {
        // Blocked by an extension or the network: the server will ask again.
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  useEffect(() => {
    // The first value is the widget's own first try: only later changes need a reset.
    if (
      attempt !== firstAttempt.current &&
      widgetId.current &&
      window.turnstile
    ) {
      setToken('');
      window.turnstile.reset(widgetId.current);
    }
  }, [attempt]);

  return (
    <>
      <div ref={container} className="min-h-16" />
      <input type="hidden" name="turnstileToken" value={token} readOnly />
    </>
  );
}
