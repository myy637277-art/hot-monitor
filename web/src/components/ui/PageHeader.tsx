import { useEffect, type ReactNode } from 'react';

export function PageHeader({
  code,
  title,
  children,
  action,
  compact = false,
}: {
  code: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  useEffect(() => {
    document.title = `${title} · 热点监控`;
  }, [title]);

  const mark = code.split(' ')[0] ?? code;
  const rest = code.slice(mark.length).trim();

  return (
    <header className={compact ? 'mb-4 flex flex-wrap items-center justify-between gap-3' : 'mb-4'}>
      <div className="min-w-0">
        <p className="font-mono text-[11px] text-muted">
          <span className="text-accent-text">{mark}</span>
          {rest ? ` ${rest}` : ''}
        </p>
        <h1 className={compact ? 'text-xl font-semibold text-bone' : 'mt-1 text-3xl font-semibold tracking-tight text-bone'}>{title}</h1>
        {!compact && <span aria-hidden="true" className="title-cut" />}
        {children && (
          <p className={compact ? 'mt-1 text-sm text-muted' : 'mt-2 max-w-prose text-sm leading-relaxed text-muted'}>{children}</p>
        )}
      </div>
      {action}
    </header>
  );
}
