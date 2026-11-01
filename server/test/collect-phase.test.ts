import { afterEach, describe, expect, it } from 'vitest';
import { runCollect } from '../src/collect/run.ts';
import { watches } from '../src/db/schema.ts';
import { fakeClock, memoryDb, testNet, textResponse } from './helpers.ts';

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

describe('collect phases', () => {
  it('keeps keyword queries out of the main phase and feed queries out of the keyword phase', async () => {
    const clock = fakeClock('2026-10-28T02:00:00.000Z');
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      seen.push(String(url));
      return textResponse('<html></html>');
    };
    const { db, close } = memoryDb();
    opened.push(close);
    const keyword = '特斯拉芯片';
    db.insert(watches)
      .values({ id: '11111111-1111-4111-8111-111111111111', keyword, paused: false, since: clock.now(), createdAt: clock.now() })
      .run();
    const net = testNet(clock, fetchImpl, { minGapMs: 0, searchTimeoutMs: 1_000, feedTimeoutMs: 1_000 });

    seen.length = 0;
    await runCollect(db, net, { search: 80, twitter: 150 }, undefined, 'main');
    expect(seen.some((url) => url.includes(encodeURIComponent(keyword)))).toBe(false);
    expect(seen.some((url) => url.includes('weibo.com'))).toBe(true);

    seen.length = 0;
    await runCollect(db, net, { search: 80, twitter: 150 }, undefined, 'keywords');
    expect(seen.some((url) => url.includes(encodeURIComponent(keyword)))).toBe(true);
    expect(seen.some((url) => url.includes('weibo.com'))).toBe(false);
  });
});
