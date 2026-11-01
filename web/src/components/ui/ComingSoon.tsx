import { CheckSquareOffset } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { HudCard } from './HudCard.tsx';

/** Placeholder panel for a section whose feature lands in a later milestone. */
export function ComingSoon({
  milestone,
  agent,
  title,
  items,
  intro,
}: {
  milestone: string;
  agent: ReactNode;
  title: string;
  items: string[];
  intro?: string;
}) {
  return (
    <HudCard code={`STANDBY · ${milestone}`} title={title}>
      <div className="flex items-start gap-3">
        <div className="w-14 shrink-0">{agent}</div>
        <div className="min-w-0">
          <p className="text-sm text-muted">{intro ?? `这个模块会在 ${milestone} 上线，届时这里会有：`}</p>
          <ul className="mt-3 space-y-2 text-sm">
            {items.map((item) => (
              <li key={item} className="flex gap-2">
                <CheckSquareOffset aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-accent-text" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </HudCard>
  );
}
