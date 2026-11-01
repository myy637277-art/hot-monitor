import type { ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';

interface HudCardProps {
  code?: string;
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'article' | 'div';
}

export function HudCard({ code, title, action, children, className = '', bodyClassName = '', as: Tag = 'section' }: HudCardProps) {
  return (
    <Tag className={cn('hud-frame', className)}>
      <div className={cn('hud-body p-4 sm:p-5', bodyClassName)}>
        {(code || title || action) && (
          <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {code && <p className="font-mono text-[11px] text-muted uppercase">{code}</p>}
              {title && <h2 className="mt-0.5 text-base font-semibold">{title}</h2>}
            </div>
            {action}
          </header>
        )}
        {children}
      </div>
    </Tag>
  );
}
