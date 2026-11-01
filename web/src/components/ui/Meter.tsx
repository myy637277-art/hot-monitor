const SEGMENTS = 10;

const fills = { accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn' } as const;

/** Skill-bar style meter for hotness and credibility scores (0-100). */
export function Meter({ label, value, tone = 'accent' }: { label: string; value: number; tone?: keyof typeof fills }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const filled = Math.round((clamped / 100) * SEGMENTS);
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped}>
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono text-bone">{clamped}</span>
      </div>
      <div aria-hidden="true" className="flex gap-0.5">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 -skew-x-[20deg] ${i < filled ? fills[tone] : 'bg-white/10'}`} />
        ))}
      </div>
    </div>
  );
}
