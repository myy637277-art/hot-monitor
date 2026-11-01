import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { credibilityRule, type ScoreItem } from '../src/ai/formula.ts';
import { runCollect } from '../src/collect/run.ts';
import { ensureSources, markHomeBadges } from '../src/collect/store.ts';
import { items, sources, stories, storyItems } from '../src/db/schema.ts';
import { deliverDigest, listDigestLogs } from '../src/notify/digest.ts';
import { createApp } from '../src/app.ts';
import { deleteTrusted, listTrusted, loadTrust } from '../src/trust.ts';
import { fakeClock, memoryDb, testNet, textResponse } from './helpers.ts';

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

const now = new Date('2026-10-28T08:00:00.000Z');

function scoreItem(url: string): ScoreItem {
  return {
    url,
    title: 'OpenAI ships a model',
    summary: 'A concrete model announcement with enough text',
    sourceId: 'twitter',
    sourceType: 'twitter',
    publishedAt: now,
  };
}

describe('trusted sources', () => {
  it('does not cap a listed official handle, and keeps the cap when it is absent', () => {
    const listed = credibilityRule([scoreItem('https://x.com/nvidiaai/status/1')], {
      domains: [],
      handles: ['nvidiaai'],
    });
    const unlisted = credibilityRule([scoreItem('https://x.com/nvidiaai/status/1')]);
    expect(listed.hardCap).toBe(false);
    expect(listed.score).toBeGreaterThan(30);
    expect(unlisted.hardCap).toBe(true);
  });

  it('seeds once and keeps a deleted handle deleted', () => {
    const { db, close } = memoryDb();
    opened.push(close);
    expect(loadTrust(db).handles).toContain('openaidevs');
    const row = listTrusted(db).find((item) => item.kind === 'handle' && item.value === 'openaidevs');
    expect(row).toBeTruthy();
    expect(deleteTrusted(db, row!.id)).toBe(true);
    expect(loadTrust(db).handles).not.toContain('openaidevs');
  });
});

describe('homepage change badges', () => {
  it('records the first snapshot quietly, then marks a newly listed story', () => {
    const { db, close } = memoryDb();
    opened.push(close);
    db.insert(sources).values({ id: 'rss:openai', type: 'rss', name: 'OpenAI', enabled: true, autoPause: false }).run();
    const story = (id: string) => {
      db.insert(stories).values({ id, title: id, summary: id, createdAt: now, updatedAt: now, relevant: true }).run();
      db.insert(items)
        .values({
          id: `${id}-item`,
          sourceId: 'rss:openai',
          dedupeKey: id,
          url: `https://openai.com/${id}`,
          title: id,
          summary: null,
          fetchedAt: now,
          publishedAt: now,
        })
        .run();
      db.insert(storyItems).values({ storyId: id, itemId: `${id}-item` }).run();
    };
    story('first');
    markHomeBadges(db, now, false);
    expect(db.select().from(stories).where(eq(stories.id, 'first')).get()?.feedBadge).toBeNull();
    expect(db.select().from(stories).where(eq(stories.id, 'first')).get()?.homeSourceCount).toBe(1);
    story('second');
    markHomeBadges(db, now, false);
    expect(db.select().from(stories).where(eq(stories.id, 'second')).get()?.feedBadge).toBe('新上榜');
    expect(db.select().from(stories).where(eq(stories.id, 'first')).get()?.feedBadge).toBeNull();
  });
});

describe('collect and digest bookkeeping', () => {
  it('skips a disabled source and records an empty digest', async () => {
    const clock = fakeClock('2026-10-28T08:00:00.000Z');
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      urls.push(String(url));
      return textResponse('<rss></rss>', 200, 'application/xml');
    };
    const { db, close } = memoryDb();
    opened.push(close);
    ensureSources(db, { search: 80, twitter: 150 });
    db.update(sources).set({ enabled: false }).where(eq(sources.id, 'weibo_hot')).run();
    await runCollect(db, testNet(clock, fetchImpl), { search: 80, twitter: 150 });
    expect(urls.some((url) => url.includes('weibo.com'))).toBe(false);

    const sent = await deliverDigest(db, { now, modelOpen: false, fetchImpl, mode: 'manual' });
    expect(sent.reason).toBe('empty');
    expect(listDigestLogs(db).map((row) => row.reason)).toEqual(['empty']);

    const app = createApp(db, { heartbeatSec: 30 });
    const body = await request(app).get('/api/v1/sources').expect(200);
    expect(body.body.sources.find((source: { id: string }) => source.id === 'weibo_hot').status).toBe('disabled');
  });
});
