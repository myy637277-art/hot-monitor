import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { items, notifications, sources, stories, storyItems } from '../src/db/schema.ts';
import { buildDigest, deliverDigest, readDigest, saveDigest } from '../src/notify/digest.ts';
import { startScheduler } from '../src/scheduler.ts';
import { fakeClock, memoryDb, testNet } from './helpers.ts';

const now = new Date('2026-10-28T00:30:00.000Z');
const yesterday = new Date('2026-10-27T02:00:00.000Z');
const opened: Array<() => void> = [];
const stops: Array<() => void> = [];

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  opened.splice(0).forEach((close) => close());
});

function db() {
  const openedDb = memoryDb();
  opened.push(openedDb.close);
  return openedDb.db;
}

function arm(database: ReturnType<typeof db>) {
  const scheduler = startScheduler(database, 30, { run: async () => {} });
  stops.push(() => scheduler.stop());
  return scheduler;
}

function addStory(
  database: ReturnType<typeof db>,
  story: {
    id: string;
    title?: string;
    summary?: string | null;
    summaryZh?: string | null;
    eventTitle?: string | null;
    publishedAt: Date;
    parts: Array<{ sourceId: string; type: string; name: string; url: string }>;
  },
) {
  database
    .insert(stories)
    .values({
      id: story.id,
      title: story.title ?? story.id,
      summary: story.summary ?? null,
      summaryZh: story.summaryZh ?? null,
      eventTitle: story.eventTitle ?? null,
      relevant: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const known = new Set(database.select().from(sources).all().map((row) => row.id));
  story.parts.forEach((part, index) => {
    if (!known.has(part.sourceId)) {
      database.insert(sources).values({ id: part.sourceId, type: part.type, name: part.name, enabled: true, autoPause: false }).run();
      known.add(part.sourceId);
    }
    const itemId = `${story.id}-${index}`;
    database
      .insert(items)
      .values({
        id: itemId,
        sourceId: part.sourceId,
        dedupeKey: itemId,
        url: part.url,
        title: story.title ?? story.id,
        summary: story.summary ?? null,
        fetchedAt: now,
        publishedAt: story.publishedAt,
      })
      .run();
    database.insert(storyItems).values({ storyId: story.id, itemId }).run();
  });
}

function addNote(database: ReturnType<typeof db>, storyId: string, createdAt = now) {
  database
    .insert(notifications)
    .values({
      id: `note-${storyId}-${createdAt.getTime()}`,
      watchId: '11111111-1111-4111-8111-111111111111',
      storyId,
      keyword: '测试',
      title: storyId,
      body: storyId,
      channel: 'sent',
      createdAt,
    })
    .run();
}

const qbit = (url: string) => ({ sourceId: 'rss:qbitai', type: 'rss', name: '量子位', url });

describe('scheduled digest', () => {
  it('keeps today homepage stories and drops older ones that would rank first', () => {
    const database = db();
    for (let i = 0; i < 16; i += 1) {
      addStory(database, {
        id: `old-${i}`,
        publishedAt: new Date(yesterday.getTime() + i * 1000),
        parts: [qbit(`https://www.qbitai.com/old-${i}`), { sourceId: 'arxiv', type: 'arxiv', name: 'arXiv', url: `https://arxiv.org/abs/${i}` }],
      });
    }
    addStory(database, {
      id: 'today',
      title: 'English title',
      eventTitle: '今天的中文标题',
      summaryZh: '一行摘要',
      publishedAt: now,
      parts: [qbit('https://www.qbitai.com/today')],
    });
    const lines = buildDigest(database, now, { includeHome: true, includeKeywords: false }, false);
    expect(lines).toEqual([
      { storyId: 'today', title: '今天的中文标题', summary: '一行摘要', url: 'https://www.qbitai.com/today' },
    ]);
  });

  it('caps the homepage day at 15', () => {
    const database = db();
    for (let i = 0; i < 16; i += 1) {
      addStory(database, {
        id: `t${i}`,
        publishedAt: new Date(now.getTime() - i * 60_000),
        parts: [qbit(`https://www.qbitai.com/t${i}`)],
      });
    }
    expect(buildDigest(database, now, { includeHome: true, includeKeywords: false }, false).map((line) => line.storyId)).toEqual(
      Array.from({ length: 15 }, (_, i) => `t${i}`),
    );
  });

  it('adds keyword hits only when that scope is on, without duplicating a homepage story', () => {
    const database = db();
    addStory(database, {
      id: 'home',
      title: '首页故事',
      summaryZh: '首页摘要',
      publishedAt: now,
      parts: [qbit('https://www.qbitai.com/home')],
    });
    addStory(database, {
      id: 'weibo',
      title: '微博命中',
      summaryZh: '关键词摘要',
      publishedAt: now,
      parts: [{ sourceId: 'weibo_hot', type: 'weibo_hot', name: '微博', url: 'https://s.weibo.com/weibo?q=ai' }],
    });
    addStory(database, {
      id: 'stale',
      title: '昨天的命中',
      summaryZh: '不应出现',
      publishedAt: yesterday,
      parts: [{ sourceId: 'weibo_hot', type: 'weibo_hot', name: '微博', url: 'https://s.weibo.com/weibo?q=old' }],
    });
    addNote(database, 'weibo', now);
    addNote(database, 'home', new Date(now.getTime() - 1000));
    addNote(database, 'stale', yesterday);
    const off = buildDigest(database, now, { includeHome: true, includeKeywords: false }, false);
    expect(off.map((line) => line.storyId)).toEqual(['home']);
    const on = buildDigest(database, now, { includeHome: true, includeKeywords: true }, false);
    expect(on.map((line) => line.storyId)).toEqual(['home', 'weibo']);
    const keywordsOnly = buildDigest(database, now, { includeHome: false, includeKeywords: true }, false);
    expect(keywordsOnly.map((line) => line.storyId)).toEqual(['weibo', 'home']);
  });

  it('does not call Server酱 for an empty digest or a missing key', async () => {
    const database = db();
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    };
    const empty = await deliverDigest(database, { now, modelOpen: false, serverchanKey: 'SCT_unit_test', fetchImpl, mode: 'manual' });
    expect(empty).toEqual({ reason: 'empty', count: 0, httpStatus: null });
    expect(calls).toBe(0);

    addStory(database, { id: 'today', title: '今天', summaryZh: '摘要', publishedAt: now, parts: [qbit('https://www.qbitai.com/today')] });
    const missed = await deliverDigest(database, { now, modelOpen: false, fetchImpl, mode: 'manual' });
    expect(missed.reason).toBe('unconfigured');
    expect(calls).toBe(0);
    expect(JSON.stringify(missed)).not.toContain('SCT_unit_test');
  });

  it('posts one digest, skips a second scheduled send that day, and keeps the key out of the result', async () => {
    const database = db();
    saveDigest(database, { enabled: true, hour: 8, minute: 0, includeHome: true, includeKeywords: false }, now);
    addStory(database, {
      id: 'today',
      title: 'English title',
      eventTitle: '今天的中文标题',
      summaryZh: '一行摘要',
      publishedAt: now,
      parts: [qbit('https://www.qbitai.com/today')],
    });
    let posts = 0;
    let desp = '';
    const logs: string[] = [];
    const info = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      posts += 1;
      expect(String(input).startsWith('https://sctapi.ftqq.com/')).toBe(true);
      desp = new URLSearchParams(String(init?.body ?? '')).get('desp') ?? '';
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    };
    try {
      const first = await deliverDigest(database, { now, modelOpen: false, serverchanKey: 'SCT_unit_test', fetchImpl, mode: 'scheduled' });
      const second = await deliverDigest(database, { now, modelOpen: false, serverchanKey: 'SCT_unit_test', fetchImpl, mode: 'scheduled' });
      expect(first).toEqual({ reason: 'sent', count: 1, httpStatus: 200 });
      expect(second.reason).toBe('skipped');
      expect(posts).toBe(1);
      expect(readDigest(database, now).lastSentOn).toBe('2026-10-28');
      expect(JSON.stringify(first)).not.toContain('SCT_unit_test');
      expect(desp).toContain('今天的中文标题');
      expect(desp).toContain('https://www.qbitai.com/today');
      expect(desp).not.toContain('SCT_unit_test');
      expect(logs.join('\n')).not.toContain('SCT_unit_test');
    } finally {
      console.info = info;
    }
  });

  it('lets a manual send ignore the daily slot and does not mark the day', async () => {
    const database = db();
    addStory(database, { id: 'today', title: '今天', summaryZh: '摘要', publishedAt: now, parts: [qbit('https://www.qbitai.com/today')] });
    let posts = 0;
    const fetchImpl: typeof fetch = async () => {
      posts += 1;
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    };
    const manual = await deliverDigest(database, { now, modelOpen: false, serverchanKey: 'SCT_unit_test', fetchImpl, mode: 'manual' });
    expect(manual.reason).toBe('sent');
    expect(readDigest(database, now).lastSentOn).toBeNull();
    saveDigest(database, { enabled: true, hour: 8, minute: 0, includeHome: true, includeKeywords: false }, now);
    const scheduled = await deliverDigest(database, { now, modelOpen: false, serverchanKey: 'SCT_unit_test', fetchImpl, mode: 'scheduled' });
    expect(scheduled.reason).toBe('sent');
    expect(posts).toBe(2);
  });

  it('records an HTTP failure without the key and without consuming the day', async () => {
    const database = db();
    saveDigest(database, { enabled: true, hour: 8, minute: 0, includeHome: true, includeKeywords: false }, now);
    addStory(database, { id: 'today', title: '今天', summaryZh: '摘要', publishedAt: now, parts: [qbit('https://www.qbitai.com/today')] });
    const logs: string[] = [];
    const info = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    };
    const fetchImpl: typeof fetch = async () => new Response('nope', { status: 503 });
    try {
      const failed = await deliverDigest(database, { now, modelOpen: false, serverchanKey: 'SCT_unit_test', fetchImpl, mode: 'scheduled' });
      expect(failed).toEqual({ reason: 'failed', count: 1, httpStatus: 503 });
      expect(readDigest(database, now).lastSentOn).toBeNull();
      expect(logs.join('\n')).not.toContain('SCT_unit_test');
    } finally {
      console.info = info;
    }
  });

  it('records a failed send without the key and without consuming the day', async () => {
    const database = db();
    saveDigest(database, { enabled: true, hour: 8, minute: 0, includeHome: true, includeKeywords: false }, now);
    addStory(database, { id: 'today', title: '今天', summaryZh: '摘要', publishedAt: now, parts: [qbit('https://www.qbitai.com/today')] });
    const logs: string[] = [];
    const info = console.info;
    const error = console.error;
    console.info = (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    };
    const fetchImpl: typeof fetch = async () => {
      throw new Error('https://sctapi.ftqq.com/SCT_unit_test.send');
    };
    try {
      const failed = await deliverDigest(database, { now, modelOpen: false, serverchanKey: 'SCT_unit_test', fetchImpl, mode: 'scheduled' });
      expect(failed).toEqual({ reason: 'failed', count: 1, httpStatus: null });
      expect(readDigest(database, now).lastSentOn).toBeNull();
      expect(readDigest(database, now).lastStatus).toBe('failed');
      expect(logs.join('\n')).not.toContain('SCT_unit_test');
    } finally {
      console.info = info;
      console.error = error;
    }
  });

  it('stores the schedule and arms 08:00 Asia/Shanghai after a restart', async () => {
    const database = db();
    const clock = fakeClock('2026-10-28T00:30:00.000Z');
    let posts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      posts += 1;
      expect(String(init?.body ?? '')).not.toContain('SCT_unit_test');
      expect(String(input).includes('sctapi.ftqq.com')).toBe(true);
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    };
    let changed = 0;
    const app = createApp(database, {
      heartbeatSec: 30,
      net: testNet(clock, fetchImpl, { serverchanKey: 'SCT_unit_test' }),
      onDigestChange: () => {
        changed += 1;
      },
    });
    const listed = await request(app).get('/api/v1/digest').expect(200);
    expect(listed.body.digest).toMatchObject({
      enabled: false,
      hour: 8,
      minute: 0,
      includeHome: true,
      includeKeywords: false,
      lastSentOn: null,
      lastStatus: null,
    });
    expect(JSON.stringify(listed.body)).not.toContain('SCT_unit_test');

    const saved = await request(app)
      .put('/api/v1/digest')
      .send({ enabled: true, hour: 8, minute: 0, includeHome: true, includeKeywords: false })
      .expect(200);
    expect(saved.body.digest.enabled).toBe(true);
    expect(changed).toBe(1);
    await request(app).put('/api/v1/digest').send({ enabled: true, hour: 24, minute: 0, includeHome: true, includeKeywords: false }).expect(400);

    const first = arm(database);
    expect(first.nextRun(new Date('2026-10-27T23:59:00.000Z'))?.toISOString()).toBe('2026-10-28T00:00:00.000Z');
    first.stop();
    const restarted = arm(database);
    expect(restarted.nextRun(new Date('2026-10-27T23:59:00.000Z'))?.toISOString()).toBe('2026-10-28T00:00:00.000Z');

    addStory(database, { id: 'today', title: '今天', summaryZh: '摘要', publishedAt: now, parts: [qbit('https://www.qbitai.com/today')] });
    const sent = await request(app).post('/api/v1/digest/send').expect(200);
    expect(sent.body).toEqual({ ok: true, reason: 'sent', count: 1, httpStatus: 200 });
    expect(posts).toBe(1);
    expect(JSON.stringify(sent.body)).not.toContain('SCT_unit_test');
    const after = await request(app).get('/api/v1/digest').expect(200);
    expect(after.body.digest.lastSentOn).toBeNull();
    expect(after.body.digest.lastStatus).toBe('sent');
  });

  it('does not arm a job while the daily push is off', () => {
    const database = db();
    const scheduler = arm(database);
    expect(scheduler.nextRun()).toBeNull();
    expect(readDigest(database).enabled).toBe(false);
  });
});
