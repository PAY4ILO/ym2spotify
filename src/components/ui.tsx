'use client';

import type { ReactNode } from 'react';

export function Card({
  step,
  title,
  subtitle,
  done,
  disabled,
  children,
}: {
  step: number;
  title: string;
  subtitle?: string;
  done?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-edge bg-panel/80 backdrop-blur transition-opacity ${
        disabled ? 'opacity-45' : 'opacity-100'
      }`}
      aria-disabled={disabled}
    >
      <header className="flex items-start gap-3 border-b border-edge px-5 py-4">
        <span
          className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            done ? 'bg-spotify text-black' : 'bg-panel-2 text-muted'
          }`}
          aria-hidden
        >
          {done ? '✓' : step}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const styles = {
    primary: 'bg-spotify text-black hover:bg-spotify/85',
    ghost: 'border border-edge bg-panel-2 text-white hover:border-muted',
    danger: 'border border-red-500/40 bg-transparent text-red-300 hover:bg-red-500/10',
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spotify disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'mute'; children: ReactNode }) {
  const styles = {
    ok: 'bg-spotify/15 text-spotify',
    warn: 'bg-yandex/15 text-yandex',
    err: 'bg-red-500/15 text-red-300',
    mute: 'bg-panel-2 text-muted',
  }[tone];
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function Notice({ tone, children }: { tone: 'info' | 'warn' | 'err'; children: ReactNode }) {
  const styles = {
    info: 'border-edge bg-panel-2 text-muted',
    warn: 'border-yandex/30 bg-yandex/5 text-yandex/90',
    err: 'border-red-500/30 bg-red-500/5 text-red-200',
  }[tone];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

export function Progress({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs text-muted tabular-nums">
        <span>
          {done} / {total}
        </span>
        <span>{percent}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-panel-2"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div
          className="h-full rounded-full bg-spotify transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
