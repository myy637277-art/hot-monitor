import { ShieldCheck, Warning, WarningCircle, Info } from '@phosphor-icons/react';

export type Tone = 'ok' | 'warn' | 'danger' | 'info';

const tones: Record<Tone, { cls: string; icon: typeof Info }> = {
  ok: { cls: 'border-ok/60 text-ok', icon: ShieldCheck },
  warn: { cls: 'border-warn/60 text-warn', icon: WarningCircle },
  danger: { cls: 'border-accent/70 text-accent-text', icon: Warning },
  info: { cls: 'border-line-strong text-muted', icon: Info },
};

export function Badge({ tone, children }: { tone: Tone; children: string }) {
  const { cls, icon: Icon } = tones[tone];
  return (
    <span className={`inline-flex items-center gap-1 border bg-ink px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>
      <Icon aria-hidden="true" size={14} weight="bold" />
      {children}
    </span>
  );
}
