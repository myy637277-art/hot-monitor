import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { SourcesResponse, StoriesResponse } from '@hot/shared';
import { createApp } from '../src/app.ts';
import { runCollect } from '../src/collect/run.ts';
import { fakeClock, fixture, memoryDb, testNet, textResponse } from './helpers.ts';

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

describe('fixture pipeline', () => {
  it('builds a multi-source feed without calling an analysis API', async () => {
    const clock = fakeClock('2026-10-26T02:00:00.000Z');
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const target = String(url);
      urls.push(target);
      if (target.includes('openrouter.ai') || target.includes('api.deepseek.com')) throw new Error('analysis API should not be called');
      if (target.includes('weibo.com')) return textResponse(fixture('weibo.json'), 200, 'application/json');
      if (target.includes('bilibili.com')) return textResponse(fixture('bilibili.json'), 200, 'application/json');
      if (target.includes('topstories')) return textResponse(fixture('hn-top.json'), 200, 'application/json');
      if (target.includes('hacker-news.firebaseio.com')) return textResponse(fixture('hn-item.json'), 200, 'application/json');
      if (target.includes('api.github.com')) return textResponse(fixture('github.json'), 200, 'application/json');
      if (target.includes('arxiv.org')) return textResponse(fixture('arxiv.xml'), 200, 'application/xml');
      if (target.includes('qbitai.com')) return textResponse(fixture('rss-qbitai.xml'), 200, 'application/xml');
      if (target.includes('sogou.com')) return textResponse(fixture('sogou.html'));
      if (target.includes('google.com')) return textResponse(fixture('google.html'));
      if (target.includes('duckduckgo.com')) return textResponse(fixture('ddg.html'));
      return textResponse('<rss></rss>', 200, 'application/xml');
    };
    const { db, close } = memoryDb();
    opened.push(close);
    const net = testNet(clock, fetchImpl);
    const report = await runCollect(db, net, { search: 80, twitter: 150 });
    expect(report.embedding.skipped).toBe(true);
    expect(report.embedding.reason).toContain('SimHash');
    expect(urls.some((url) => url.includes('openrouter.ai') || url.includes('api.deepseek.com'))).toBe(false);

    const app = createApp(db, { heartbeatSec: 30, net });
    const stories = (await request(app).get('/api/v1/stories').expect(200)).body as StoriesResponse;
    const sourceIds = new Set(stories.stories.flatMap((story) => story.sources.map((source) => source.id)));
    expect(sourceIds.size).toBeGreaterThanOrEqual(2);
    expect(stories.stories.some((story) => story.sources.some((source) => source.id === 'weibo_hot' || source.id === 'bili_hot'))).toBe(false);
    const qbitai = stories.stories.find((story) => story.sources.some((source) => source.id === 'rss:qbitai'));
    expect(qbitai).toBeTruthy();
    expect(qbitai?.unverified).toBe(true);

    const sources = (await request(app).get('/api/v1/sources').expect(200)).body as SourcesResponse;
    expect(sources.embedding.reason).toContain('SimHash');
    expect(sources.sources.length).toBeGreaterThanOrEqual(10);
  });
});
