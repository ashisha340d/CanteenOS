import type { ReactNode } from 'react';

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="bg-background relative grid min-h-dvh place-items-center overflow-hidden p-4">
      {/* Two soft accent washes and a faint grid. Enough atmosphere to feel designed, not
          enough to compete with a form the user needs to fill in quickly. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 52% 46% at 18% 6%, var(--sidebar-accent), transparent 62%),
            radial-gradient(ellipse 46% 42% at 84% 96%, var(--sidebar-accent), transparent 62%)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse 65% 55% at 50% 50%, #000 20%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse 65% 55% at 50% 50%, #000 20%, transparent 78%)',
        }}
      />

      <div className="bg-card relative w-[408px] max-w-full rounded-2xl border p-6 shadow-xl sm:p-8 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500">
        <div className="mb-6 flex items-center gap-2.5">
          <span aria-hidden className="bg-primary ring-sidebar-accent size-2.5 rounded-full ring-4" />
          <span className="font-heading text-base font-semibold tracking-[-0.02em]">MenuBoard</span>
        </div>

        <h1 className="font-heading text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-1.5 text-sm">{subtitle}</p>}

        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
