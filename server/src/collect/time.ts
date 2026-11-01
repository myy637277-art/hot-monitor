const SHANGHAI = 'Asia/Shanghai';

export function shanghaiDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + days));
  return utc.toISOString().slice(0, 10);
}

/** Next 00:00 in Asia/Shanghai, which is when a daily pause expires. */
export function nextShanghaiMidnight(now: Date): Date {
  return new Date(`${addDays(shanghaiDate(now), 1)}T00:00:00+08:00`);
}
