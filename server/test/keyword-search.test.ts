import { afterEach, describe, expect, it } from 'vitest';
import { runCollect } from '../src/collect/run.ts';
import { watches } from '../src/db/schema.ts';
import { fakeClock, memoryDb, testNet, textResponse } from './helpers.ts';

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

describe('keyword search', () => {
  it('requests Sogou or DuckDuckGo and twitter advanced search for an active keyword', async () => {
    const clock = fakeClock('2026-10-26T02:00:00.000Z');
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      urls.push(String(url));
      return textResponse('<html></html>');
    };
    const { db, close } = memoryDb();
    opened.push(close);
    const now = clock.now();
    db.insert(watches)
      .values({ id: '77777777-7777-4777-8777-777777777777', keyword: 'deepseek大模型', paused: false, since: now, createdAt: now })
      .run();
    db.insert(watches)
      .values({ id: '88888888-8888-4888-8888-888888888888', keyword: 'paused-word', paused: true, since: now, createdAt: now })
      .run();
    await runCollect(db, testNet(clock, fetchImpl, { twitterKey: 'test-key' }), { search: 80, twitter: 150 });
    const keywordUrls = urls.filter((url) => url.toLowerCase().includes('deepseek'));
    expect(keywordUrls.some((url) => url.includes('sogou.com') || url.includes('duckduckgo.com'))).toBe(true);
    expect(keywordUrls.some((url) => url.includes('twitterapi.io') && url.includes('advanced_search'))).toBe(true);
    expect(urls.some((url) => url.includes('google.com') && url.toLowerCase().includes('deepseek'))).toBe(false);
    expect(urls.some((url) => url.toLowerCase().includes('paused-word'))).toBe(false);
  });
});
