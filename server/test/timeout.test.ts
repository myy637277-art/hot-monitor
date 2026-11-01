import { afterEach, describe, expect, it } from 'vitest';
import { runCollect } from '../src/collect/run.ts';
import { listStories } from '../src/collect/store.ts';
import { fakeClock, fixture, memoryDb, testNet, textResponse } from './helpers.ts';

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

describe('timeout skip', () => {
  it('skips HN, GitHub, and arXiv when they time out and still keeps other sources', async () => {
    const clock = fakeClock('2026-10-26T02:00:00.000Z');
    const fetchImpl: typeof fetch = (url, init) => {
      const target = String(url);
      if (target.includes('hacker-news.firebaseio.com') || target.includes('api.github.com') || target.includes('export.arxiv.org')) {
        return new Promise((_, reject) => {
          const abort = () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          };
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener('abort', abort);
        });
      }
      if (target.includes('weibo.com')) return Promise.resolve(textResponse(fixture('weibo.json'), 200, 'application/json'));
      if (target.includes('bilibili.com')) return Promise.resolve(textResponse(fixture('bilibili.json'), 200, 'application/json'));
      return Promise.resolve(textResponse('<rss></rss>', 200, 'application/xml'));
    };
    const { db, close } = memoryDb();
    opened.push(close);
    const net = testNet(clock, fetchImpl, { hnTimeoutMs: 40, feedTimeoutMs: 40, searchTimeoutMs: 40 });
    const report = await runCollect(db, net, { search: 80, twitter: 150 });
    for (const id of ['hn', 'github', 'arxiv']) {
      const attempt = report.attempts.find((row) => row.sourceId === id);
      expect(attempt?.status, id).toBe('skipped');
      expect(attempt?.error).toContain('超时');
      expect(attempt?.pauseUntil).toBeNull();
    }
    const stories = listStories(db, 20);
    expect(stories.some((story) => story.sources.some((source) => source.id === 'weibo_hot'))).toBe(true);
    expect(stories.some((story) => story.sources.some((source) => source.id === 'bili_hot'))).toBe(true);
  });
});
