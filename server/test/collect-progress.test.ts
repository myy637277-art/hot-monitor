import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourcesResponse } from '@hot/shared';
import { createApp } from '../src/app.ts';
import { createCollector, runCollect } from '../src/collect/run.ts';
import { fakeClock, fixture, memoryDb, testNet, textResponse } from './helpers.ts';

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

describe('collect progress', () => {
  it('returns from POST /api/v1/collect before the search gap finishes', async () => {
    const clock = fakeClock('2026-10-26T02:00:00.000Z');
    let hold = true;
    const fetchImpl: typeof fetch = async (url) => {
      const target = String(url);
      if (target.includes('weibo.com')) return textResponse(fixture('weibo.json'), 200, 'application/json');
      if (target.includes('bilibili.com')) return textResponse(fixture('bilibili.json'), 200, 'application/json');
      if (target.includes('topstories')) return textResponse('[]', 200, 'application/json');
      if (target.includes('sogou.com') || target.includes('google.com') || target.includes('duckduckgo.com')) return textResponse('<html></html>');
      return textResponse('<rss></rss>', 200, 'application/xml');
    };
    const { db, close } = memoryDb();
    opened.push(close);
    const net = testNet(clock, fetchImpl, {
      sleep: async () => {
        while (hold) await new Promise((resolve) => setTimeout(resolve, 15));
      },
    });
    const collector = createCollector(db, net, { search: 80, twitter: 150 });
    const app = createApp(db, { heartbeatSec: 30, collector, net });

    const res = await request(app).post('/api/v1/collect');
    expect(res.status).toBe(202);
    expect(collector.running()).toBe(true);

    await vi.waitFor(
      async () => {
        const body = (await request(app).get('/api/v1/sources')).body as SourcesResponse;
        expect(body.running).toBe(true);
        expect(body.progress.sourceName).toBe('Google');
        expect(body.progress.items).toBeGreaterThan(0);
      },
      { timeout: 5_000, interval: 20 },
    );

    hold = false;
    await vi.waitFor(() => expect(collector.running()).toBe(false), { timeout: 5_000, interval: 20 });
    const done = (await request(app).get('/api/v1/sources')).body as SourcesResponse;
    expect(done.progress).toEqual({ sourceName: null, items: 0 });
  });

  it('marks a hung source failed and still records the others', async () => {
    const clock = fakeClock('2026-10-26T02:00:00.000Z');
    let releaseHang = () => {};
    const hang = new Promise<Response>((resolve) => {
      releaseHang = () => resolve(textResponse('{}', 200, 'application/json'));
    });
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes('weibo.com')) return hang;
      if (String(url).includes('topstories')) return textResponse('[]', 200, 'application/json');
      if (String(url).includes('bilibili.com')) return textResponse(fixture('bilibili.json'), 200, 'application/json');
      return textResponse('<rss></rss>', 200, 'application/xml');
    };
    const { db, close } = memoryDb();
    opened.push(close);
    const net = testNet(clock, fetchImpl, { feedTimeoutMs: 40, hnTimeoutMs: 40, searchTimeoutMs: 40 });
    const started = Date.now();
    try {
      const report = await runCollect(db, net, { search: 80, twitter: 150 });
      expect(Date.now() - started).toBeLessThan(3_000);
      const weibo = report.attempts.find((attempt) => attempt.sourceId === 'weibo_hot');
      const bili = report.attempts.find((attempt) => attempt.sourceId === 'bili_hot');
      expect(weibo).toMatchObject({ status: 'error', error: '请求超时' });
      expect(bili?.status).toBe('ok');
      expect(bili?.items.length).toBeGreaterThan(0);
    } finally {
      releaseHang();
    }
  });
});
