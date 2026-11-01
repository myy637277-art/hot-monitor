import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { DiscoverResponse } from '@hot/shared';
import { resetAiGuard, type AiEnv } from '../src/ai/deepseek.ts';
import { scoreStories } from '../src/ai/score.ts';
import { runCollect } from '../src/collect/run.ts';
import { listHomepage } from '../src/collect/store.ts';
import { createInterest, listDiscoveries, listDiscoveryFeed } from '../src/discover/interests.ts';
import { createApp } from '../src/app.ts';
import { interests, items, sources, stories, storyItems } from '../src/db/schema.ts';
import type { Db } from '../src/db/index.ts';
import { fakeClock, memoryDb, testNet, textResponse } from './helpers.ts';

const now = new Date('2026-10-26T02:00:00.000Z');
const opened: Array<() => void> = [];

afterEach(() => {
  resetAiGuard();
  opened.splice(0).forEach((close) => close());
});

function addItem(
  db: Db,
  input: { id: string; sourceId: string; title: string; summary: string | null; publishedAt: Date | null; url: string },
) {
  db.insert(stories).values({ id: input.id, title: input.title, summary: input.summary, createdAt: now, updatedAt: now }).run();
  db.insert(items)
    .values({
      id: `${input.id}-item`,
      sourceId: input.sourceId,
      dedupeKey: input.id,
      url: input.url,
      title: input.title,
      summary: input.summary,
      publishedAt: input.publishedAt,
      fetchedAt: now,
    })
    .run();
  db.insert(storyItems).values({ storyId: input.id, itemId: `${input.id}-item` }).run();
}

describe('interest discovery', () => {
  it('starts empty, matches related wording, and keeps those stories off the homepage', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    db.insert(sources).values({ id: 'hn', type: 'hn', name: 'Hacker News' }).run();
    db.insert(sources).values({ id: 'weibo_hot', type: 'weibo_hot', name: '微博热搜' }).run();
    addItem(db, {
      id: 'lab',
      sourceId: 'hn',
      title: '实验室放出新检查点',
      summary: 'a new language model checkpoint',
      publishedAt: now,
      url: 'https://news.ycombinator.com/item?id=1',
    });
    addItem(db, {
      id: 'city',
      sourceId: 'hn',
      title: '市政道路本周通车',
      summary: '路口改造',
      publishedAt: now,
      url: 'https://news.ycombinator.com/item?id=2',
    });
    addItem(db, {
      id: 'old',
      sourceId: 'hn',
      title: '实验室放出新检查点',
      summary: 'language model',
      publishedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
      url: 'https://news.ycombinator.com/item?id=3',
    });
    addItem(db, {
      id: 'hot',
      sourceId: 'weibo_hot',
      title: '大模型上热搜',
      summary: null,
      publishedAt: now,
      url: 'https://s.weibo.com/weibo?q=model',
    });

    const app = createApp(db, { heartbeatSec: 30, net: testNet(fakeClock(now.toISOString()), async () => textResponse('')) });
    const first = (await request(app).get('/api/v1/discover').expect(200)).body as DiscoverResponse;
    expect(first.interests).toEqual([]);
    expect(first.stories).toEqual([]);

    const created = await request(app).post('/api/v1/discover').send({ label: 'AI', terms: ['大模型'] }).expect(201);
    const id = created.body.interest.id as string;
    const second = (await request(app).get('/api/v1/discover').expect(200)).body as DiscoverResponse;
    expect(second.interests.map((row) => row.label)).toEqual(['AI']);
    expect(second.stories).toEqual([]);
    expect(second.holds.map((row) => row.storyId)).toEqual(['lab']);
    expect(second.holds[0]?.status).toBe('pending');
    expect(listHomepage(db, 100, now, false).map((row) => row.id)).not.toContain('lab');

    await request(app).patch(`/api/v1/discover/${id}`).send({ label: '模型', terms: ['大模型'] }).expect(200);
    const renamed = (await request(app).get('/api/v1/discover').expect(200)).body as DiscoverResponse;
    expect(renamed.interests[0]?.label).toBe('模型');
    expect(renamed.holds[0]?.label).toBe('模型');

    for (let i = 0; i < 40; i += 1) {
      addItem(db, {
        id: `extra-${i}`,
        sourceId: 'hn',
        title: `语言模型进展 ${i}`,
        summary: null,
        publishedAt: new Date(now.getTime() - i * 1000),
        url: `https://news.ycombinator.com/item?id=${10 + i}`,
      });
    }
    const capped = listDiscoveries(db, now);
    expect(capped).toHaveLength(30);
    expect(capped.map((row) => row.id)).not.toContain('city');
    expect(capped.map((row) => row.id)).not.toContain('old');
    expect(capped.map((row) => row.id)).not.toContain('hot');
    expect(listHomepage(db, 100, now, false)).toEqual([]);

    await request(app).delete(`/api/v1/discover/${id}`).expect(200);
    const cleared = (await request(app).get('/api/v1/discover').expect(200)).body as DiscoverResponse;
    expect(cleared.interests).toEqual([]);
    expect(cleared.stories).toEqual([]);
  });

  it('limits directions to 20 and terms to 5', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    const app = createApp(db, {
      heartbeatSec: 30,
      net: testNet(fakeClock(now.toISOString()), async () => {
        throw new Error('alias model should not be called');
      }),
    });
    await request(app)
      .post('/api/v1/discover')
      .send({ label: 'AI', terms: ['一', '二', '三', '四', '五', '六'] })
      .expect(400);
    await request(app).post('/api/v1/discover').send({ label: 'AI', terms: ['大模型'] }).expect(201);
    await request(app).post('/api/v1/discover').send({ label: 'ai', terms: ['芯片'] }).expect(409);
    await request(app).patch('/api/v1/discover/not-a-uuid').send({ label: 'AI', terms: ['大模型'] }).expect(400);
    await request(app).delete('/api/v1/discover/00000000-0000-4000-8000-000000000000').expect(404);

    for (let i = 0; i < 19; i += 1) {
      await request(app).post('/api/v1/discover').send({ label: `方向 ${i}`, terms: [`词${i}`] }).expect(201);
    }
    await request(app).post('/api/v1/discover').send({ label: '再一个', terms: ['词'] }).expect(400);
    const body = (await request(app).get('/api/v1/discover').expect(200)).body as DiscoverResponse;
    expect(body.interests).toHaveLength(20);
  });

  it('asks DeepSeek for a Chinese summary without forcing the story onto the homepage', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    db.insert(sources).values({ id: 'hn', type: 'hn', name: 'Hacker News' }).run();
    addItem(db, {
      id: 'lab',
      sourceId: 'hn',
      title: '实验室放出新检查点',
      summary: 'a new language model checkpoint',
      publishedAt: now,
      url: 'https://news.ycombinator.com/item?id=1',
    });
    createInterest(db, 'AI', ['大模型'], now);
    let calls = 0;
    const env: AiEnv = {
      apiKey: 'test-key',
      now: () => now,
      sleep: async () => {},
      fetch: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: [{ id: 'lab', relevant: true, summary: '实验室放出了新的检查点。', score: 70, reason: '方向相关' }],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    };
    await scoreStories(db, env);
    const row = db.select().from(stories).where(eq(stories.id, 'lab')).get();
    expect(calls).toBe(1);
    expect(row?.summaryZh).toBe('实验室放出了新的检查点。');
    expect(row?.relevant).toBe(false);
    expect(listDiscoveries(db, now).map((story) => story.id)).toEqual(['lab']);
    expect(listDiscoveryFeed(db, now).stories).toEqual([]);
    expect(listDiscoveryFeed(db, now).holds.map((row) => row.storyId)).toEqual(['lab']);
    expect(listHomepage(db, 100, now, true)).toEqual([]);
  });

  it('does not search a direction until the user adds one', async () => {
    const clock = fakeClock(now.toISOString());
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const target = String(url);
      urls.push(target);
      if (target.includes('twitterapi.io')) return textResponse('{"tweets":[]}', 200, 'application/json');
      if (target.includes('weibo.com')) return textResponse('{"data":{"realtime":[]}}', 200, 'application/json');
      if (target.includes('bilibili.com') || target.includes('api.github.com') || target.includes('topstories')) {
        return textResponse('[]', 200, 'application/json');
      }
      return textResponse('<rss></rss>', 200, 'application/xml');
    };
    const { db, close } = memoryDb();
    opened.push(close);
    const net = testNet(clock, fetchImpl, { twitterKey: 'test-key' });
    await runCollect(db, net, { search: 80, twitter: 150 });
    expect(urls.some((url) => decodeURIComponent(url).includes('大模型'))).toBe(false);

    createInterest(db, 'AI', ['大模型'], now);
    const before = urls.length;
    await runCollect(db, net, { search: 80, twitter: 150 });
    const added = urls.slice(before).map((url) => decodeURIComponent(url));
    expect(added.some((url) => url.includes('sogou.com') && url.includes('大模型'))).toBe(true);
    expect(added.some((url) => url.includes('advanced_search') && url.includes('大模型'))).toBe(true);
    expect(added.some((url) => url.includes('language model'))).toBe(false);
    expect(added.some((url) => url.includes('google.com') && url.includes('大模型'))).toBe(false);
  });

  it('asks DeepSeek once for aliases of a typed term and keeps them off the homepage read', async () => {
    const { db, close } = memoryDb();
    opened.push(close);
    db.insert(sources).values({ id: 'hn', type: 'hn', name: 'Hacker News' }).run();
    addItem(db, {
      id: 'scan',
      sourceId: 'hn',
      title: 'A new lithography scanner',
      summary: 'semiconductor tools',
      publishedAt: now,
      url: 'https://news.ycombinator.com/item?id=9',
    });
    let calls = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      const target = String(url);
      if (!target.includes('api.deepseek.com')) throw new Error('unexpected fetch');
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { response_format: { type: string }; thinking: { type: string }; messages: unknown };
      expect(body.response_format.type).toBe('json_object');
      expect(body.thinking.type).toBe('disabled');
      expect(JSON.stringify(body.messages)).toContain('JSON');
      expect(JSON.stringify(body.messages)).not.toContain('test-key');
      const asked = calls === 1 ? '光刻' : '晶圆';
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      term: asked,
                      aliases: ['lithography', '半导体', 'semiconductor', 'wafer', 'fifth', 'sixth', 'seventh', 'eighth'],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const app = createApp(db, {
      heartbeatSec: 30,
      net: testNet(fakeClock(now.toISOString()), fetchImpl, { deepseekKey: 'test-key' }),
    });
    const created = await request(app).post('/api/v1/discover').send({ label: '芯片设备', terms: ['光刻'] }).expect(201);
    const id = created.body.interest.id as string;
    expect(calls).toBe(1);
    const row = db.select().from(interests).where(eq(interests.id, id)).get();
    const stored = JSON.parse(row?.aliases ?? '{}') as Record<string, string[]>;
    expect(stored['光刻']).toEqual(['lithography', '半导体', 'semiconductor', 'wafer']);
    const found = (await request(app).get('/api/v1/discover').expect(200)).body as DiscoverResponse;
    expect(found.stories).toEqual([]);
    expect(found.holds.map((story) => story.storyId)).toEqual(['scan']);
    expect(found.holds[0]?.status).toBe('pending');
    await request(app).get('/api/v1/stories?limit=100').expect(200);
    expect(listHomepage(db, 100, now, false)).toEqual([]);
    expect(calls).toBe(1);
    await request(app).patch(`/api/v1/discover/${id}`).send({ label: '设备', terms: ['光刻'] }).expect(200);
    expect(calls).toBe(1);
    await request(app).patch(`/api/v1/discover/${id}`).send({ label: '设备', terms: ['晶圆'] }).expect(200);
    expect(calls).toBe(2);
  });

  it('matches a typed term or stored alias in the title or summary, not a vague name or a generic token', () => {
    const { db, close } = memoryDb();
    opened.push(close);
    db.insert(sources).values({ id: 'hn', type: 'hn', name: 'Hacker News' }).run();
    db.insert(sources).values({ id: 'gh', type: 'github', name: 'GitHub' }).run();
    const samples: Array<[string, string, string, string | null]> = [
      ['chain', 'hn', 'Forging a Microsoft Edge Full Chain', 'logic bugs only'],
      ['tail', 'hn', 'Tailscale SSH investigation', 'the patch remains under review'],
      ['vague', 'gh', 'github 上的一个研究方向', '这项研究发布在 github'],
      ['term', 'hn', '实验室讨论人工智能入学', null],
      ['word', 'hn', 'A coding model ships', 'The AI model is available by email'],
      ['inbox', 'hn', 'Daily email remains available', 'check your inbox'],
      ['machine', 'hn', 'Notes on machine intelligence', null],
      ['shop', 'hn', 'A machine for the shop', 'ordinary tools'],
      ['grad', 'hn', '计算机研究生方向的论文清单', '本周更新'],
      ['research', 'hn', '这是一个新的研究方向', '综述'],
    ];
    for (const [id, sourceId, title, summary] of samples) {
      addItem(db, { id, sourceId, title, summary, publishedAt: now, url: `https://example.com/${id}` });
    }
    createInterest(db, '计算机研究生方向', ['人工智能'], now, {
      人工智能: ['AI', 'artificial intelligence', 'machine intelligence', '研究', 'github', '方向'],
    });
    createInterest(db, '人工智能方向', ['计算机研究生方向'], now, { 计算机研究生方向: ['方向', '研究'] });
    const found = listDiscoveries(db, now);
    expect(found.map((story) => story.id).sort()).toEqual(['grad', 'machine', 'term', 'word']);
    expect(listDiscoveryFeed(db, now).stories).toEqual([]);
    expect(listDiscoveryFeed(db, now).holds.map((story) => story.storyId).sort()).toEqual(['grad', 'machine', 'term', 'word']);
    expect(found.find((story) => story.id === 'grad')?.interestLabel).toBe('人工智能方向');
    expect(found.find((story) => story.id === 'term')?.interestLabel).toBe('计算机研究生方向');
    expect(listHomepage(db, 100, now, false).map((row) => row.id)).toEqual([]);
  });
});
