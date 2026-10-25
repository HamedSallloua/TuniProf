import type { Metadata } from 'next';
import Link from 'next/link';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-arabic';
import './globals.css';
import ar from '@/messages/ar.json';
import fr from '@/messages/fr.json';

export const metadata: Metadata = {
  title: `${fr.notFound.title} | ${ar.notFound.title}`,
};

// Shown for any address that matches no page. It bypasses the normal layout, so the
// language is unknown here: the message is shown in French and in Arabic together.
export default function GlobalNotFound() {
  return (
    <html lang="fr">
      <body className="flex min-h-dvh items-center justify-center bg-background p-6 antialiased">
        <div className="grid w-full max-w-3xl gap-6 sm:grid-cols-2">
          <section lang="fr" dir="ltr" className="font-sans">
            <h1 className="text-2xl font-bold text-primary">
              {fr.notFound.title}
            </h1>
            <p className="mt-2 text-muted">{fr.notFound.body}</p>
            <Link
              href="/"
              className="mt-5 inline-flex min-h-11 items-center rounded-md bg-primary px-5 font-medium text-primary-foreground hover:bg-accent"
            >
              {fr.notFound.backHome}
            </Link>
          </section>
          <section
            lang="ar"
            dir="rtl"
            className="font-sans"
            style={{
              fontFamily:
                "'Noto Sans Arabic Variable', 'Inter Variable', sans-serif",
            }}
          >
            <h2 className="text-2xl font-bold text-primary">
              {ar.notFound.title}
            </h2>
            <p className="mt-2 text-muted">{ar.notFound.body}</p>
            <Link
              href="/ar"
              className="mt-5 inline-flex min-h-11 items-center rounded-md bg-primary px-5 font-medium text-primary-foreground hover:bg-accent"
            >
              {ar.notFound.backHome}
            </Link>
          </section>
        </div>
      </body>
    </html>
  );
}
