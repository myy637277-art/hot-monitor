import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { blendCredibility, hotnessScore, isLookalikeHost, type ScoreItem } from '../src/ai/formula.ts';
import { resetAiGuard, resolveChatModel, setAiUsed, type AiEnv } from '../src/ai/deepseek.ts';
import { scoreStories } from '../src/ai/score.ts';
import { items, sources, stories, storyItems, watches } from '../src/db/schema.ts';
import { memoryDb } from './helpers.ts';

const now = new Date('2026-10-26T04:00:00.000Z');
const opened: Array<() => void> = [];

afterEach(() => {
  resetAiGuard();
  opened.splice(0).forEach((close) => close());
});

describe('hotness and credibility rules', () => {
  it('scores hotness from source count, volume, hot lists, and recency', () => {
    expect(hotnessScore({ items: [item('hn', 'hn')], updatedAt: now }, now)).toBe(20);
    const fourDays = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
    const eightDays = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    expect(hotnessScore({ items: [{ ...item('hn', 'hn'), publishedAt: fourDays }], updatedAt: fourDays }, now)).toBe(8);
    expect(hotnessScore({ items: [{ ...item('hn', 'hn'), publishedAt: eightDays }], updatedAt: eightDays }, now)).toBe(5);
    expect(
      hotnessScore(
        {
          items: [item('weibo_hot', 'weibo_hot'), item('hn', 'hn'), item('rss:qbitai', 'rss'), item('hn', 'hn', 'i2')],
          updatedAt: now,
        },
        now,
      ),
    ).toBe(95);
  });

  it('caps a lookalike at 30 after blending in a high model score', () => {
    expect(isLookalikeHost('openai.com')).toBe(false);
    expect(isLookalikeHost('blog.openai.com')).toBe(false);
    expect(isLookalikeHost('openai-login.com')).toBe(true);
    expect(isLookalikeHost('0penai.com')).toBe(true);
    expect(blendCredibility(40, 80, false)).toBe(60);
    expect(blendCredibility(30, 100, true)).toBe(30);
    expect(resolveChatModel('deepseek-chat')).toBe('deepseek-v4-flash');
    expect(resolveChatModel('deepseek-v4-pro')).toBe('deepseek-v4-flash');
    expect(resolveChatModel('deepseek-flash')).toBe('deepseek-flash');
    expect(resolveChatModel('deepseek-v4-flash')).toBe('deepseek-v4-flash');
  });
});

describe('story scoring', () => {
  it('stores a Chinese summary and score from one DeepSeek call', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    insertStory(db, 'https://openai.com/index/gpt', 'OpenAI releases a new model', 'An English announcement');
    const seen: string[] = [];
    await scoreStories(
      db,
      env(async (url, init) => {
        const target = String(url);
        expect(target).toBe('https://api.deepseek.com/chat/completions');
        const body = JSON.parse(String(init?.body)) as {
          model: string;
          max_tokens: number;
          thinking: { type: string };
          response_format: { type: string };
          messages: Array<{ content: string }>;
        };
        expect(body.model).toBe('deepseek-v4-flash');
        expect(body.thinking.type).toBe('disabled');
        expect(body.response_format.type).toBe('json_object');
        expect(body.max_tokens).toBeGreaterThanOrEqual(1024);
        const prompt = body.messages.map((message) => message.content).join('\n');
        expect(prompt).toContain('JSON');
        const header = headerOf(init, 'authorization');
        expect(header.startsWith('Bearer ')).toBe(true);
        expect(header).not.toContain('sk-live');
        seen.push(prompt);
        return json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [{ id: 's1', relevant: true, summary: 'OpenAI 发布了新的语言模型。', score: 80, reason: '官方域名，内容具体' }],
                }),
              },
            },
          ],
        });
      }, 'test-key'),
    );
    const row = db.select().from(stories).where(eq(stories.id, 's1')).get();
    expect(row?.summaryZh).toBe('OpenAI 发布了新的语言模型。');
    expect(row?.aiMode).toBe('model');
    expect(row?.hotness).toBe(20);
    expect(row?.credibility).toBeGreaterThan(30);
    expect(seen).toHaveLength(1);
  });

  it('stays on the rules-only path when the key is absent', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    insertStory(db, 'https://openai.com/index/gpt', 'OpenAI releases a new model', 'An English announcement');
    let calls = 0;
    await scoreStories(
      db,
      env(async () => {
        calls += 1;
        throw new Error('model should not be called');
      }),
    );
    const row = db.select().from(stories).where(eq(stories.id, 's1')).get();
    expect(calls).toBe(0);
    expect(row?.aiMode).toBe('rules');
    expect(row?.summaryZh).toBe('仅规则判断，未生成中文摘要。');
    expect(row?.credibilityReason).toContain('仅规则判断');
    const scoredAt = row?.scoredAt?.getTime();
    await scoreStories(
      db,
      env(async () => {
        calls += 1;
        throw new Error('model should not be called');
      }),
    );
    const again = db.select().from(stories).where(eq(stories.id, 's1')).get();
    expect(calls).toBe(0);
    expect(again?.scoredAt?.getTime()).toBe(scoredAt);
  });

  it('stores a timeout reason and returns when DeepSeek aborts', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    insertStory(db, 'https://openai.com/index/gpt', 'OpenAI releases a new model', 'An English announcement');
    let calls = 0;
    await scoreStories(
      db,
      env(async () => {
        calls += 1;
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      }, 'test-key'),
    );
    const row = db.select().from(stories).where(eq(stories.id, 's1')).get();
    expect(calls).toBe(1);
    expect(row?.aiMode).toBe('rules');
    expect(row?.credibilityReason).toContain('DeepSeek 超时');
  });

  it('still calls the model when the old daily counter is already past 45', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    insertStory(db, 'https://openai.com/index/gpt', 'OpenAI releases a new model', 'An English announcement');
    setAiUsed(db, now, 45);
    let calls = 0;
    await scoreStories(
      db,
      env(async () => {
        calls += 1;
        return json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [{ id: 's1', relevant: true, summary: 'OpenAI 发布了新模型。', score: 70, reason: '来源清楚' }],
                }),
              },
            },
          ],
        });
      }, 'test-key'),
    );
    const row = db.select().from(stories).where(eq(stories.id, 's1')).get();
    expect(calls).toBe(1);
    expect(row?.aiMode).toBe('model');
  });

  it('caps credibility at 30 when the domain is a lookalike', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    insertStory(db, 'https://openai-login.com/gpt', 'OpenAI 发布新模型', '立即体验');
    await scoreStories(
      db,
      env(async () => {
        return json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [{ id: 's1', relevant: true, summary: '有人假借 OpenAI 的名义发布模型。', score: 100, reason: '看起来像官方发布' }],
                }),
              },
            },
          ],
        });
      }, 'test-key'),
    );
    const row = db.select().from(stories).where(eq(stories.id, 's1')).get();
    expect(row?.credibility).toBe(30);
    expect(row?.credibilityReason).toContain('封顶');
    expect(row?.summaryZh).toContain('OpenAI');
  });

  it('retries with deepseek-flash when the primary model id is rejected', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    insertStory(db, 'https://openai.com/index/gpt', 'OpenAI releases a new model', 'An English announcement');
    const models: string[] = [];
    await scoreStories(
      db,
      env(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        models.push(body.model);
        if (models.length === 1) return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 400 });
        return json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [{ id: 's1', relevant: true, summary: 'OpenAI 发布了新模型。', score: 70, reason: '来源清楚' }],
                }),
              },
            },
          ],
        });
      }, 'test-key'),
    );
    expect(models).toEqual(['deepseek-v4-flash', 'deepseek-flash']);
    const row = db.select().from(stories).where(eq(stories.id, 's1')).get();
    expect(row?.aiMode).toBe('model');
    expect(row?.summaryZh).toContain('OpenAI');
  });

  it('sends an already scored keyword match and skips an unrelated scored story', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    insertStory(db, 'https://openai.com/index/gpt', 'OpenAI releases a new model', 'An English announcement', 's-hit', 'i-hit');
    insertStory(db, 'https://example.com/weather', '本地天气转晴', '今天多云', 's-miss', 'i-miss');
    await scoreStories(db, env(async () => { throw new Error('no key yet'); }));
    db.insert(watches)
      .values({ id: 'w1', keyword: 'OpenAI', paused: false, since: now, createdAt: now })
      .run();
    const prompts: string[] = [];
    await scoreStories(
      db,
      env(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        prompts.push(body.messages.map((message) => message.content).join('\n'));
        return json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [{ id: 's-hit', relevant: true, summary: 'OpenAI 发布了新模型。', score: 70, reason: '来源清楚' }],
                }),
              },
            },
          ],
        });
      }, 'test-key'),
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('s-hit');
    expect(prompts[0]).not.toContain('s-miss');
    const miss = db.select().from(stories).where(eq(stories.id, 's-miss')).get();
    expect(miss?.aiMode).toBe('rules');
  });
});

function item(sourceId: string, sourceType: string, id = 'i1'): ScoreItem {
  return {
    url: 'https://example.com/a',
    title: 'OpenAI model',
    summary: null,
    sourceId,
    sourceType,
    publishedAt: now,
  };
}

function insertStory(
  db: ReturnType<typeof memoryDb>['db'],
  url: string,
  title: string,
  summary: string,
  id = 's1',
  itemId = 'i1',
) {
  const sourceId = `rss:${id}`;
  db.insert(sources).values({ id: sourceId, type: 'rss', name: 'OpenAI', enabled: true, autoPause: false }).run();
  db.insert(stories).values({ id, title, summary, createdAt: now, updatedAt: now }).run();
  db.insert(items)
    .values({ id: itemId, sourceId, dedupeKey: itemId, url, title, summary, fetchedAt: now, publishedAt: now })
    .run();
  db.insert(storyItems).values({ storyId: id, itemId }).run();
}

function env(fetchImpl: typeof fetch, apiKey?: string): AiEnv {
  return { apiKey, fetch: fetchImpl, now: () => now, sleep: async () => {} };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function headerOf(init: RequestInit | undefined, name: string): string {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) return '';
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return found?.[1] ?? '';
}
