// Frame of the account pages: a title, an optional intro, and the content.
export function AuthCard({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-primary">{title}</h1>
      {intro && <p className="mt-2 text-muted">{intro}</p>}
      <div className="mt-6 rounded-card border border-border bg-surface p-5 sm:p-6">
        {children}
      </div>
    </div>
  );
}
