import { useEffect, useState } from 'react';
import type { HealthResponse } from '@hot/shared';

export type HealthState =
  | { status: 'loading' }
  | { status: 'ok' | 'stale'; health: HealthResponse; checkedAt: Date }
  | { status: 'down'; error: string; checkedAt: Date };

const POLL_MS = 5000;

export function isStale(health: HealthResponse, now = Date.now()): boolean {
  const { lastAt, intervalSec } = health.heartbeat;
  if (!lastAt) return true;
  return now - new Date(lastAt).getTime() > (intervalSec * 2 + 5) * 1000;
}

export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch('/api/v1/health');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const health = (await res.json()) as HealthResponse;
        if (alive) setState({ status: isStale(health) ? 'stale' : 'ok', health, checkedAt: new Date() });
      } catch (err) {
        if (alive) setState({ status: 'down', error: String(err), checkedAt: new Date() });
      }
    };
    void check();
    const id = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return state;
}

export const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour12: false }) : '—';

export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';
