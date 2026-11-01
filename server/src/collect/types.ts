export interface Net {
  fetch: typeof fetch;
  now: () => Date;
  /** Optional signal cancels the wait. Callers that ignore it still type-check. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  ua: string;
  /** Extra delay added to the 90s search gap. Production uses 0–30s; tests use 0. */
  jitterMs: () => number;
  minGapMs: number;
  searchDailyCap: number;
  searchTimeoutMs: number;
  hnTimeoutMs: number;
  feedTimeoutMs: number;
  twitterCap: number;
  twitterKey?: string;
  deepseekKey?: string;
  serverchanKey?: string;
  searchQuery: string;
}

export interface RawItem {
  sourceId: string;
  title: string;
  url: string;
  summary: string | null;
  publishedAt: Date | null;
  dedupeKey: string;
  embedding?: Float32Array | null;
}

export type AttemptStatus = 'ok' | 'paused' | 'skipped' | 'error' | 'unconfigured' | 'cap';

export interface Attempt {
  sourceId: string;
  status: AttemptStatus;
  items: RawItem[];
  error: string | null;
  requests: number;
  usageItems: number;
  pauseUntil: Date | null;
  pauseReason: string | null;
}

export function okAttempt(sourceId: string, items: RawItem[], requests = 1): Attempt {
  return {
    sourceId,
    status: 'ok',
    items,
    error: null,
    requests,
    usageItems: items.length,
    pauseUntil: null,
    pauseReason: null,
  };
}

export function failedAttempt(
  sourceId: string,
  status: Exclude<AttemptStatus, 'ok'>,
  error: string,
  extra?: Partial<Pick<Attempt, 'requests' | 'usageItems' | 'pauseUntil' | 'pauseReason' | 'items'>>,
): Attempt {
  return {
    sourceId,
    status,
    items: extra?.items ?? [],
    error,
    requests: extra?.requests ?? 0,
    usageItems: extra?.usageItems ?? 0,
    pauseUntil: extra?.pauseUntil ?? null,
    pauseReason: extra?.pauseReason ?? null,
  };
}
