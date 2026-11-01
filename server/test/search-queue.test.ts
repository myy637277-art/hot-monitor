import { afterEach, describe, expect, it } from 'vitest';
import { fakeClock, fixture, memoryDb, runSearch, testNet, textResponse } from './helpers.ts';

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

describe('search queue', () => {
  it('keeps at least 90 seconds between search requests and sends an identifiable user agent', async () => {
    const clock = fakeClock('2026-10-26T02:00:00.000Z');
    const calls: Array<{ at: number; ua: string }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ at: clock.now().getTime(), ua: header(init, 'User-Agent') });
      const body = String(url).includes('google.com') ? fixture('google.html') : fixture('sogou.html');
      return textResponse(body);
    };
    const { db, close } = memoryDb();
    opened.push(close);
    const net = testNet(clock, fetchImpl);
    await runSearch(db, 'sogou', net);
    net.searchQuery = '芯片';
    await runSearch(db, 'google', net);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(90_000);
    expect(calls[0]!.ua).toBe('myy-hot-monitor/0.1 (personal research; contact: test@example.com)');
  });

  it('caches the same query for an hour', async () => {
    const clock = fakeClock('2026-10-26T02:00:00.000Z');
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return textResponse(fixture('sogou.html'));
    };
    const { db, close } = memoryDb();
    opened.push(close);
    const net = testNet(clock, fetchImpl);
    await runSearch(db, 'sogou', net);
    await runSearch(db, 'sogou', net);
    expect(fetches).toBe(1);
  });

  it('stops an engine at 80 requests a day and still allows another engine', async () => {
    const clock = fakeClock('2026-10-26T02:00:00.000Z');
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return textResponse(fixture('sogou.html'));
    };
    const { db, close } = memoryDb();
    opened.push(close);
    const net = testNet(clock, fetchImpl);
    for (let i = 0; i < 80; i++) {
      net.searchQuery = `查询${i}`;
      const attempt = await runSearch(db, 'sogou', net);
      expect(attempt.status).toBe('ok');
    }
    net.searchQuery = '超出';
    const blocked = await runSearch(db, 'sogou', net);
    expect(blocked.status).toBe('cap');
    expect(blocked.pauseReason).toBe('已达每日上限');
    expect(fetches).toBe(80);
    net.searchQuery = '谷歌仍可搜';
    const google = await runSearch(db, 'google', net);
    expect(google.status).toBe('ok');
    expect(fetches).toBe(81);
  });
});

function header(init: RequestInit | undefined, name: string): string {
  const headers = init?.headers;
  if (!headers) return '';
  if (headers instanceof Headers) return headers.get(name) ?? '';
  if (Array.isArray(headers)) return headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? '';
  return (headers as Record<string, string>)[name] ?? '';
}
