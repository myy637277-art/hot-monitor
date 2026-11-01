import { afterEach, describe, expect, it } from 'vitest';
import { judgeHomepage } from '../src/ai/judge.ts';
import { resetAiGuard, setAiUsed, type AiEnv } from '../src/ai/deepseek.ts';
import { filterKeywordHits, parseLooseDate } from '../src/collect/home.ts';
import { listHomepage } from '../src/collect/store.ts';
import { items, sources, stories, storyItems } from '../src/db/schema.ts';
import { memoryDb } from './helpers.ts';

const now = new Date('2026-10-28T08:00:00.000Z');
const opened: Array<() => void> = [];

afterEach(() => {
  resetAiGuard();
  opened.splice(0).forEach((close) => close());
});

describe('homepage window', () => {
  it('drops undated, stale, weibo, bilibili, and off-domain search hits', () => {
    const { db, close } = memoryDb();
    opened.push(close);
    add(db, 'fresh', 'rss:qbitai', 'rss', '量子位', 'https://www.qbitai.com/a', now);
    add(db, 'old', 'rss:qbitai', 'rss', '量子位', 'https://www.qbitai.com/old', daysAgo(8));
    add(db, 'undated', 'rss:openai', 'rss', 'OpenAI', 'https://openai.com/x', null);
    add(db, 'weibo', 'weibo_hot', 'weibo_hot', '微博热搜', 'https://s.weibo.com/weibo?q=1', now);
    add(db, 'bili', 'bili_hot', 'bili_hot', '哔哩哔哩热门', 'https://www.bilibili.com/video/BV1', now);
    add(db, 'search-off', 'search_sogou', 'search_sogou', '搜狗', 'https://example.com/post', now);
    add(db, 'search-on', 'search_ddg', 'search_ddg', 'DuckDuckGo', 'https://www.theverge.com/ai', now);
    add(db, 'tweet', 'twitter', 'twitter', 'X', 'https://x.com/i/status/1', now);
    add(db, 'hn-alone', 'hn', 'hn', 'Hacker News', 'https://news.ycombinator.com/item?id=1', now);
    const cards = listHomepage(db, 100, now, false);
    const ids = cards.map((card) => card.id);
    expect(ids).toContain('fresh');
    expect(ids).toContain('search-on');
    expect(ids).toContain('tweet');
    expect(ids).not.toContain('old');
    expect(ids).not.toContain('undated');
    expect(ids).not.toContain('weibo');
    expect(ids).not.toContain('bili');
    expect(ids).not.toContain('search-off');
    expect(ids).not.toContain('hn-alone');
    expect(cards.every((card) => card.unverified)).toBe(true);
    expect(cards.every((card) => card.feedVerdict == null)).toBe(true);
    expect(cards.find((card) => card.id === 'fresh')?.sourceStrength).toBe(1);
    expect(cards.find((card) => card.id === 'tweet')?.sourceStrength).toBe(0);
    expect(cards.some((card) => card.sources.some((source) => source.type === 'weibo_hot' || source.type === 'bili_hot'))).toBe(false);
  });

  it('keeps a low-engagement post when a second source reports it, and ranks agreement first', () => {
    const { db, close } = memoryDb();
    opened.push(close);
    add(db, 'alone', 'rss:qbitai', 'rss', '量子位', 'https://www.qbitai.com/alone', now);
    add(db, 'pair', 'twitter', 'twitter', 'X', 'https://x.com/i/status/9', daysAgo(2));
    addItem(db, 'pair', 'rss:jiqizhixin', 'rss', '机器之心', 'https://www.jiqizhixin.com/p', daysAgo(2), 'i-pair-2');
    const cards = listHomepage(db, 100, now, false);
    expect(cards.map((card) => card.id)).toEqual(['pair', 'alone']);
    expect(cards[0]?.sources.map((source) => source.id).sort()).toEqual(['rss:jiqizhixin', 'twitter']);
  });

  it('hides an unreliable verdict and waits for the model while the cap is open', () => {
    const { db, close } = memoryDb();
    opened.push(close);
    add(db, 'bad', 'rss:qbitai', 'rss', '量子位', 'https://www.qbitai.com/bad', now, { feedVerdict: 'unreliable', feedReason: '来源说不清' });
    add(db, 'wait', 'rss:qbitai', 'rss', '量子位', 'https://www.qbitai.com/wait', now);
    expect(listHomepage(db, 100, now, true).map((card) => card.id)).toEqual([]);
    expect(listHomepage(db, 100, now, false).map((card) => card.id)).toEqual(['wait']);
    expect(listHomepage(db, 100, now, false)[0]?.unverified).toBe(true);
  });

  it('parses a loose keyword date and drops a low-authority hit', () => {
    expect(parseLooseDate('发布于 3天前', now)?.toISOString()).toBe(daysAgo(3).toISOString());
    const kept = filterKeywordHits(
      [
        { sourceId: 'search_sogou', title: '量子位 2026-10-27', url: 'https://www.qbitai.com/n', summary: '2026-10-27', publishedAt: null, dedupeKey: 'a' },
        { sourceId: 'search_sogou', title: '杂站', url: 'https://example.com/n', summary: '2026-10-27', publishedAt: now, dedupeKey: 'b' },
        { sourceId: 'search_sogou', title: '量子位旧闻', url: 'https://www.qbitai.com/old', summary: null, publishedAt: daysAgo(8), dedupeKey: 'c' },
      ],
      now,
    );
    expect(kept.map((item) => item.dedupeKey)).toEqual(['a']);
  });
});

describe('homepage judgment', () => {
  it('stores a Chinese event title and one verdict from deepseek-v4-flash', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    add(db, 's1', 'rss:qbitai', 'rss', '量子位', 'https://www.qbitai.com/a', now);
    const models: string[] = [];
    await judgeHomepage(db, env(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string; thinking: { type: string }; messages: Array<{ content: string }> };
      models.push(body.model);
      expect(body.thinking.type).toBe('disabled');
      expect(body.messages.map((message) => message.content).join('\n')).toContain('JSON');
      return json({
        items: [{ id: 's1', verdict: 'reliable', reason: '量子位有原文', title: '量子位报道新模型发布' }],
      });
    }));
    expect(models).toEqual(['deepseek-v4-flash']);
    const [card] = listHomepage(db, 10, now, true);
    expect(card?.eventTitle).toBe('量子位报道新模型发布');
    expect(card?.feedReason).toBe('量子位有原文');
    expect(card?.feedVerdict).toBe('reliable');
    expect(card?.sourceStrength).toBe(1);
    expect(card?.unverified).toBe(false);
  });

  it('still judges a homepage candidate when the old daily counter is past 45', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    add(db, 's1', 'rss:qbitai', 'rss', '量子位', 'https://www.qbitai.com/a', now);
    setAiUsed(db, now, 45);
    let calls = 0;
    await judgeHomepage(db, env(async () => {
      calls += 1;
      return json({
        items: [{ id: 's1', verdict: 'uncertain', reason: '来源清楚但细节少', title: '量子位提到一项新研究' }],
      });
    }));
    expect(calls).toBe(1);
    const [card] = listHomepage(db, 10, now, true);
    expect(card?.unverified).toBe(false);
    expect(card?.feedVerdict).toBe('uncertain');
    expect(card?.eventTitle).toBe('量子位提到一项新研究');
  });
});

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function add(
  db: ReturnType<typeof memoryDb>['db'],
  id: string,
  sourceId: string,
  type: string,
  name: string,
  url: string,
  publishedAt: Date | null,
  extra?: { feedVerdict?: string; feedReason?: string },
) {
  addItem(db, id, sourceId, type, name, url, publishedAt, `${id}-item`, extra);
}

function addItem(
  db: ReturnType<typeof memoryDb>['db'],
  storyId: string,
  sourceId: string,
  type: string,
  name: string,
  url: string,
  publishedAt: Date | null,
  itemId: string,
  extra?: { feedVerdict?: string; feedReason?: string },
) {
  const source = db.select().from(sources).all().find((row) => row.id === sourceId);
  if (!source) db.insert(sources).values({ id: sourceId, type, name, enabled: true, autoPause: false }).run();
  const story = db.select().from(stories).all().find((row) => row.id === storyId);
  if (!story) {
    db.insert(stories)
      .values({
        id: storyId,
        title: storyId,
        summary: storyId,
        createdAt: now,
        updatedAt: now,
        relevant: true,
        feedVerdict: extra?.feedVerdict,
        feedReason: extra?.feedReason,
      })
      .run();
  }
  db.insert(items)
    .values({ id: itemId, sourceId, dedupeKey: itemId, url, title: storyId, summary: null, fetchedAt: now, publishedAt })
    .run();
  db.insert(storyItems).values({ storyId, itemId }).run();
}

function env(fetchImpl: typeof fetch): AiEnv {
  return { apiKey: 'test-key', fetch: fetchImpl, now: () => now, sleep: async () => {} };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
