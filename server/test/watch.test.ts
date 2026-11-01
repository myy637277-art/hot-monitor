import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { notifications, stories, watches } from '../src/db/schema.ts';
import { listWatchState, matchWatches } from '../src/notify/watch.ts';
import { serverchanEndpoint } from '../src/notify/serverchan.ts';
import type { ClaimVerdict } from '../src/ai/claim.ts';
import { memoryDb } from './helpers.ts';

const passed = async (): Promise<ClaimVerdict> => ({
  status: 'pass',
  relevant: true,
  authentic: true,
  reason: '来源和主题都对得上',
});

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

function db() {
  const openedDb = memoryDb();
  opened.push(openedDb.close);
  return openedDb.db;
}

function story(
  database: ReturnType<typeof db>,
  row: { id: string; title: string; summary?: string | null; summaryZh?: string | null; relevant?: boolean | null; createdAt: Date },
) {
  database
    .insert(stories)
    .values({
      id: row.id,
      title: row.title,
      summary: row.summary ?? null,
      summaryZh: row.summaryZh ?? null,
      relevant: row.relevant ?? true,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
    })
    .run();
}

describe('keyword watch', () => {
  it('matches the title or Chinese summary and does not notify the same story twice', async () => {
    const database = db();
    const since = new Date('2026-10-26T00:00:00Z');
    const now = new Date('2026-10-26T01:00:00Z');
    database.insert(watches).values({ id: '11111111-1111-4111-8111-111111111111', keyword: '灵眸', paused: false, since, createdAt: since }).run();
    story(database, { id: 'title-hit', title: '灵眸发现新热点', summaryZh: '别的摘要', createdAt: now });
    story(database, { id: 'zh-hit', title: '无关标题', summary: 'lynx only in english', summaryZh: '侦察员灵眸在看', createdAt: now });
    story(database, { id: 'english-only', title: '无关标题', summary: '灵眸', summaryZh: '没有命中', createdAt: now });
    story(database, { id: 'old', title: '灵眸旧闻', createdAt: new Date('2026-10-25T00:00:00Z') });
    story(database, { id: 'hidden', title: '灵眸但无关', relevant: false, createdAt: now });

    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    };

    expect(await matchWatches(database, { now, serverchanKey: 'SCT_unit_test', fetchImpl, verdict: passed })).toBe(3);
    expect(await matchWatches(database, { now, serverchanKey: 'SCT_unit_test', fetchImpl, verdict: passed })).toBe(0);
    const rows = database.select().from(notifications).all();
    expect(rows.map((row) => row.storyId).sort()).toEqual(['english-only', 'title-hit', 'zh-hit']);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.startsWith('POST https://sctapi.ftqq.com/SCT_unit_test.send'))).toBe(true);
  });

  it('does not call Server酱 when the key is absent, and skips a paused watch', async () => {
    const database = db();
    const since = new Date('2026-10-26T00:00:00Z');
    const now = new Date('2026-10-26T01:00:00Z');
    database.insert(watches).values({ id: '22222222-2222-4222-8222-222222222222', keyword: '灵眸', paused: false, since, createdAt: since }).run();
    database.insert(watches).values({ id: '33333333-3333-4333-8333-333333333333', keyword: '灵眸', paused: true, since, createdAt: since }).run();
    story(database, { id: 'one', title: '灵眸', createdAt: now });

    let called = 0;
    const fetchImpl: typeof fetch = async () => {
      called += 1;
      return new Response('nope', { status: 500 });
    };
    expect(await matchWatches(database, { now, fetchImpl, verdict: passed })).toBe(1);
    expect(called).toBe(0);
    expect(database.select().from(notifications).all().map((row) => row.channel)).toEqual(['skipped']);
  });

  it('adds, pauses, and deletes a keyword', async () => {
    const database = db();
    const app = createApp(database, { heartbeatSec: 30 });
    const created = await request(app).post('/api/v1/watches').send({ keyword: ' 灵眸 ' }).expect(201);
    expect(created.body.watch.keyword).toBe('灵眸');
    await request(app).post('/api/v1/watches').send({ keyword: '灵眸' }).expect(409);
    await request(app).patch(`/api/v1/watches/${created.body.watch.id}`).send({ paused: true }).expect(200);
    const listed = await request(app).get('/api/v1/watches').expect(200);
    expect(listed.body.watches).toEqual([expect.objectContaining({ keyword: '灵眸', paused: true })]);
    await request(app).delete(`/api/v1/watches/${created.body.watch.id}`).expect(200);
    expect((await request(app).get('/api/v1/watches')).body.watches).toEqual([]);
  });

  it('matches DeepSeek against the keyword deepseek大模型', async () => {
    const database = db();
    const since = new Date('2026-10-26T00:00:00Z');
    const now = new Date('2026-10-26T01:00:00Z');
    database.insert(watches).values({ id: '44444444-4444-4444-8444-444444444444', keyword: 'deepseek大模型', paused: false, since, createdAt: since }).run();
    story(database, { id: 'ds', title: '模型发布', summary: 'DeepSeek released a checkpoint', summaryZh: '一条科技消息', createdAt: now });
    story(database, { id: 'other', title: 'OpenAI note', summary: 'unrelated', summaryZh: '别的事情', createdAt: now });
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ code: 0 }), { status: 200 });
    expect(await matchWatches(database, { now, serverchanKey: 'SCT_unit_test', fetchImpl, verdict: passed })).toBe(1);
    expect(database.select().from(notifications).all().map((row) => row.storyId)).toEqual(['ds']);
    expect(listWatchState(database).matchNote).toBeNull();
  });

  it('stores a Server酱 error status without the key', async () => {
    const database = db();
    const since = new Date('2026-10-26T00:00:00Z');
    const now = new Date('2026-10-26T01:00:00Z');
    database.insert(watches).values({ id: '55555555-5555-4555-8555-555555555555', keyword: '灵眸', paused: false, since, createdAt: since }).run();
    story(database, { id: 'one', title: '灵眸', createdAt: now });
    const fetchImpl: typeof fetch = async () => new Response('nope', { status: 503 });
    expect(await matchWatches(database, { now, serverchanKey: 'SCT_unit_test', fetchImpl, verdict: passed })).toBe(1);
    const row = database.select().from(notifications).all()[0];
    expect(row?.channel).toBe('failed');
    expect(row?.httpStatus).toBe(503);
    const listed = listWatchState(database).notifications[0];
    expect(listed?.httpStatus).toBe(503);
    expect(JSON.stringify(listed)).not.toContain('SCT_unit_test');
  });

  it('says when a collect matched no keyword', async () => {
    const database = db();
    const since = new Date('2026-10-26T00:00:00Z');
    const now = new Date('2026-10-26T01:00:00Z');
    database.insert(watches).values({ id: '66666666-6666-4666-8666-666666666666', keyword: 'deepseek大模型', paused: false, since, createdAt: since }).run();
    story(database, { id: 'none', title: '今天的天气', summaryZh: '没有相关内容', createdAt: now });
    const fetchImpl: typeof fetch = async () => new Response('nope', { status: 500 });
    expect(await matchWatches(database, { now, serverchanKey: 'SCT_unit_test', fetchImpl })).toBe(0);
    expect(listWatchState(database).matchNote).toBe('这次采集没有命中关键词。');
  });

  it('keeps a rejected or unchecked keyword match out of WeChat', async () => {
    const database = db();
    const since = new Date('2026-10-26T00:00:00Z');
    const now = new Date('2026-10-26T01:00:00Z');
    database.insert(watches).values({ id: '77777777-7777-4777-8777-777777777777', keyword: '灵眸', paused: false, since, createdAt: since }).run();
    story(database, { id: 'nope', title: '灵眸只是顺带出现', createdAt: now });
    story(database, { id: 'wait', title: '灵眸还没核对', createdAt: now });
    const fetchImpl: typeof fetch = async () => {
      throw new Error('wechat should not be called');
    };
    expect(
      await matchWatches(database, {
        now,
        serverchanKey: 'SCT_unit_test',
        fetchImpl,
        verdict: async (input) =>
          input.title.includes('还没')
            ? { status: 'pending', relevant: null, authentic: null, reason: '等待核对' }
            : { status: 'reject', relevant: false, authentic: true, reason: '只是顺带提到' },
      }),
    ).toBe(0);
    expect(database.select().from(notifications).all()).toEqual([]);
    const holds = listWatchState(database).holds;
    expect(holds.map((row) => row.status).sort()).toEqual(['pending', 'reject']);
    expect(holds.find((row) => row.storyId === 'nope')?.reason).toBe('只是顺带提到');
  });

  it('builds the Turbo and Server酱³ endpoints without sending', () => {
    expect(serverchanEndpoint('SCT_unit_test')).toBe('https://sctapi.ftqq.com/SCT_unit_test.send');
    expect(serverchanEndpoint('sctp123tAbcd')).toBe('https://123.push.ft07.com/send/sctp123tAbcd.send');
  });
});
