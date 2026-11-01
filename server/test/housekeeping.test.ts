import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { pruneStorage, recordAttempt } from '../src/collect/store.ts';
import { failedAttempt } from '../src/collect/types.ts';
import { aiCache, fetchCache, items, notifications, sources, stories, storyItems } from '../src/db/schema.ts';
import { memoryDb } from './helpers.ts';

const now = new Date('2026-10-28T00:00:00.000Z');
const old = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

describe('storage prune', () => {
  it('drops expired caches, items older than 14 days, and stories nothing still points at', () => {
    const { db, close } = memoryDb();
    opened.push(close);
    db.insert(sources).values({ id: 'hn', type: 'hn', name: 'HN', enabled: true, autoPause: false }).run();
    db.insert(stories).values([
      { id: 'keep-note', title: 'noted', createdAt: old, updatedAt: old },
      { id: 'drop', title: 'old', createdAt: old, updatedAt: old },
      { id: 'fresh', title: 'fresh', createdAt: now, updatedAt: now },
    ]).run();
    db.insert(items).values([
      { id: 'old-item', sourceId: 'hn', dedupeKey: 'a', url: 'https://news.ycombinator.com/a', title: 'old', fetchedAt: old },
      { id: 'fresh-item', sourceId: 'hn', dedupeKey: 'b', url: 'https://news.ycombinator.com/b', title: 'fresh', fetchedAt: now },
    ]).run();
    db.insert(storyItems).values([
      { storyId: 'drop', itemId: 'old-item' },
      { storyId: 'fresh', itemId: 'fresh-item' },
    ]).run();
    db.insert(notifications)
      .values({ id: 'n1', watchId: 'w', storyId: 'keep-note', keyword: 'k', title: 'noted', body: 'b', channel: 'skipped', createdAt: old })
      .run();
    db.insert(fetchCache).values({ cacheKey: 'gone', body: 'x', fetchedAt: old, expiresAt: old }).run();
    db.insert(aiCache).values({ cacheKey: 'old-ai', body: '{}', createdAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000) }).run();

    pruneStorage(db, now);

    expect(db.select().from(items).all().map((row) => row.id)).toEqual(['fresh-item']);
    expect(db.select().from(stories).all().map((row) => row.id).sort()).toEqual(['fresh', 'keep-note']);
    expect(db.select().from(fetchCache).all()).toHaveLength(0);
    expect(db.select().from(aiCache).all()).toHaveLength(0);
  });

  it('keeps the source row when a follow-up search is not allowed to touch it', () => {
    const { db, close } = memoryDb();
    opened.push(close);
    db.insert(sources)
      .values({ id: 'search_sogou', type: 'search_sogou', name: '搜狗', enabled: true, autoPause: false, lastStatus: 'ok', lastSuccessAt: now })
      .run();
    recordAttempt(db, failedAttempt('search_sogou', 'error', '请求超时', { requests: 0 }), now, false, { touchSource: false });
    expect(db.select().from(sources).where(eq(sources.id, 'search_sogou')).get()?.lastStatus).toBe('ok');
  });
});
