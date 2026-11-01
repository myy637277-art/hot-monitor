import { fmtTime, type HealthState } from '../lib/useHealth.ts';

const view = {
  loading: { dot: 'bg-warn animate-blink', text: '连接中', short: '连接' },
  ok: { dot: 'bg-ok', text: '后端在线', short: '在线' },
  stale: { dot: 'bg-warn', text: '心跳超时', short: '超时' },
  down: { dot: 'bg-accent', text: '后端离线', short: '离线' },
} as const;

export function StatusChip({ state, compact = false }: { state: HealthState; compact?: boolean }) {
  const v = view[state.status];
  const beat = state.status === 'ok' || state.status === 'stale' ? fmtTime(state.health.heartbeat.lastAt) : null;
  return (
    <div className="inline-flex items-center gap-2 border border-line bg-ink px-2.5 py-1 text-xs" data-testid="status-chip">
      <span aria-hidden="true" className={`size-2 rounded-full ${v.dot}`} />
      <span role="status" aria-label={v.text} className="font-medium whitespace-nowrap">
        {compact ? v.short : v.text}
      </span>
      {beat && !compact && <span className="font-mono text-muted">心跳 {beat}</span>}
    </div>
  );
}
