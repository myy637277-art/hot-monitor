import { createHash, randomUUID } from 'node:crypto';
import type { EmbeddingNote, SourceRunStatus, SourceStatus, SourceType } from '@hot/shared';
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { aiCache, claimChecks, crawlBudget, fetchCache, items, jobRuns, notifications, searchState, sources, stories, storyItems, usageDaily } from '../db/schema.ts';
import { buildCatalog, type CatalogEntry } from './catalog.ts';
import { homepageCards, type HomeItem, type HomeRow } from './home.ts';
import { bufferToFloats, floatsToBuffer } from './embed.ts';
import { decideMatch, type MatchCandidate } from './merge.ts';
import { parseSimhash, simhashHex } from './simhash.ts';
import { addDays, nextShanghaiMidnight, shanghaiDate } from './time.ts';
import { loadTrust } from '../trust.ts';
import type { Attempt, RawItem } from './types.ts';

const SEARCH_STATE_ID = 'global';
const CACHE_MS = 60 * 60 * 1000;
const CANDIDATE_MS = 14 * 24 * 60 * 60 * 1000;

export function ensureSources(db: Db, caps: { search: number; twitter: number }): CatalogEntry[] {
  const catalog = buildCatalog(caps);
  for (const entry of catalog) {
    db.insert(sources)
      .values({
        id: entry.id,
        type: entry.type,
        name: entry.name,
        enabled: true,
        autoPause: entry.autoPause,
      })
      .onConflictDoUpdate({
        target: sources.id,
        set: { type: entry.type, name: entry.name, autoPause: entry.autoPause },
      })
      .run();
  }
  return catalog;
}

export function getUsage(db: Db, sourceId: string, day: string): { requests: number; items: number } {
  const row = db.select().from(usageDaily).where(and(eq(usageDaily.day, day), eq(usageDaily.sourceId, sourceId))).get();
  return { requests: row?.requests ?? 0, items: row?.items ?? 0 };
}

export function getSearchUsed(db: Db, sourceId: string, day: string): number {
  return db.select().from(crawlBudget).where(and(eq(crawlBudget.sourceId, sourceId), eq(crawlBudget.day, day))).get()?.used ?? 0;
}

export function activePause(db: Db, sourceId: string, now: Date): { until: Date; reason: string | null } | null {
  const today = shanghaiDate(now);
  const days = [today, addDays(today, -1)];
  const rows = db
    .select()
    .from(crawlBudget)
    .where(and(eq(crawlBudget.sourceId, sourceId), inArray(crawlBudget.day, days)))
    .all();
  const hit = rows.find((row) => row.pausedUntil && row.pausedUntil.getTime() > now.getTime());
  if (!hit?.pausedUntil) return null;
  return { until: hit.pausedUntil, reason: hit.pauseReason };
}

export function getLastSearchAt(db: Db): Date | null {
  return db.select().from(searchState).where(eq(searchState.id, SEARCH_STATE_ID)).get()?.lastRequestAt ?? null;
}

export function setLastSearchAt(db: Db, at: Date): void {
  db.insert(searchState)
    .values({ id: SEARCH_STATE_ID, lastRequestAt: at })
    .onConflictDoUpdate({ target: searchState.id, set: { lastRequestAt: at } })
    .run();
}

export function getCachedBody(db: Db, cacheKey: string, now: Date): string | null {
  const row = db.select().from(fetchCache).where(eq(fetchCache.cacheKey, cacheKey)).get();
  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  return row.body;
}

export function setCachedBody(db: Db, cacheKey: string, body: string, now: Date): void {
  const expiresAt = new Date(now.getTime() + CACHE_MS);
  db.insert(fetchCache)
    .values({ cacheKey, body, fetchedAt: now, expiresAt })
    .onConflictDoUpdate({ target: fetchCache.cacheKey, set: { body, fetchedAt: now, expiresAt } })
    .run();
}

function addCount(
  db: Db,
  table: typeof usageDaily,
  day: string,
  sourceId: string,
  requests: number,
  itemCount: number,
): void {
  db.insert(table)
    .values({ day, sourceId, requests, items: itemCount })
    .onConflictDoUpdate({
      target: [table.day, table.sourceId],
      set: {
        requests: sql`${table.requests} + ${requests}`,
        items: sql`${table.items} + ${itemCount}`,
      },
    })
    .run();
}

function addBudgetUsed(db: Db, sourceId: string, day: string, requests: number): void {
  db.insert(crawlBudget)
    .values({ sourceId, day, used: requests })
    .onConflictDoUpdate({
      target: [crawlBudget.sourceId, crawlBudget.day],
      set: { used: sql`${crawlBudget.used} + ${requests}` },
    })
    .run();
}

export function setPause(db: Db, sourceId: string, now: Date, until: Date, reason: string): void {
  const day = shanghaiDate(now);
  const existing = db.select().from(crawlBudget).where(and(eq(crawlBudget.sourceId, sourceId), eq(crawlBudget.day, day))).get();
  if (!existing) {
    db.insert(crawlBudget).values({ sourceId, day, used: 0, pausedUntil: until, pauseReason: reason }).run();
    return;
  }
  db.update(crawlBudget)
    .set({ pausedUntil: until, pauseReason: reason })
    .where(and(eq(crawlBudget.sourceId, sourceId), eq(crawlBudget.day, day)))
    .run();
}

function itemId(sourceId: string, dedupeKey: string): string {
  return createHash('sha256').update(`${sourceId}\n${dedupeKey}`).digest('hex').slice(0, 32);
}

function loadCandidates(db: Db, since: Date): MatchCandidate[] {
  const rows = db
    .select({
      storyId: storyItems.storyId,
      dedupeKey: items.dedupeKey,
      simhash: items.simhash,
      embedding: items.embedding,
    })
    .from(storyItems)
    .innerJoin(items, eq(storyItems.itemId, items.id))
    .where(gte(items.fetchedAt, since))
    .all();
  return rows.map((row) => ({
    storyId: row.storyId,
    dedupeKey: row.dedupeKey,
    simhash: parseSimhash(row.simhash),
    embedding: row.embedding ? bufferToFloats(row.embedding) : null,
  }));
}

export function ingestItems(db: Db, raws: RawItem[], now: Date, useEmbedding: boolean): void {
  const candidates = loadCandidates(db, new Date(now.getTime() - CANDIDATE_MS));
  for (const raw of raws) {
    if (!raw.title.trim()) continue;
    const hash = simhashHex(`${raw.title}\n${raw.summary ?? ''}`);
    const embedding = raw.embedding ?? null;
    const matched = decideMatch(
      { dedupeKey: raw.dedupeKey, simhash: parseSimhash(hash), embedding },
      candidates,
      useEmbedding,
    );
    const storyId = matched ?? randomUUID();
    if (!matched) {
      db.insert(stories)
        .values({
          id: storyId,
          title: raw.title,
          summary: raw.summary,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } else {
      db.update(stories)
        .set({
          updatedAt: now,
          summary: sql`coalesce(${stories.summary}, ${raw.summary})`,
        })
        .where(eq(stories.id, storyId))
        .run();
    }
    const id = itemId(raw.sourceId, raw.dedupeKey);
    db.insert(items)
      .values({
        id,
        sourceId: raw.sourceId,
        dedupeKey: raw.dedupeKey,
        url: raw.url,
        title: raw.title,
        summary: raw.summary,
        publishedAt: raw.publishedAt,
        simhash: hash,
        embedding: embedding ? floatsToBuffer(embedding) : null,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: items.id,
        set: {
          url: raw.url,
          title: raw.title,
          summary: raw.summary,
          publishedAt: raw.publishedAt,
          simhash: hash,
          embedding: embedding ? floatsToBuffer(embedding) : sql`${items.embedding}`,
          fetchedAt: now,
        },
      })
      .run();
    db.insert(storyItems).values({ storyId, itemId: id }).onConflictDoNothing().run();
    candidates.push({
      storyId,
      dedupeKey: raw.dedupeKey,
      simhash: parseSimhash(hash),
      embedding,
    });
  }
}

const AI_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

function chunkIds(ids: string[], size = 400): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Drop expired fetch cache, model cache older than 30 days, and items outside the 14-day merge window. */
export function pruneStorage(db: Db, now: Date): void {
  const itemCutoff = new Date(now.getTime() - CANDIDATE_MS);
  const aiCutoff = new Date(now.getTime() - AI_CACHE_MS);
  db.transaction((tx) => {
    const writer = tx as unknown as Db;
    writer.delete(fetchCache).where(lt(fetchCache.expiresAt, now)).run();
    writer.delete(aiCache).where(lt(aiCache.createdAt, aiCutoff)).run();
    const oldIds = writer
      .select({ id: items.id })
      .from(items)
      .where(lt(items.fetchedAt, itemCutoff))
      .all()
      .map((row) => row.id);
    for (const group of chunkIds(oldIds)) {
      writer.delete(storyItems).where(inArray(storyItems.itemId, group)).run();
      writer.delete(items).where(inArray(items.id, group)).run();
    }
    writer
      .delete(stories)
      .where(
        sql`${stories.id} not in (select story_id from story_items) and ${stories.id} not in (select story_id from notifications) and ${stories.id} not in (select story_id from claim_checks)`,
      )
      .run();
  });
}

export function recordAttempt(
  db: Db,
  attempt: Attempt,
  now: Date,
  useEmbedding: boolean,
  opts?: { touchSource?: boolean },
): void {
  const touchSource = opts?.touchSource !== false && attempt.error !== '已取消';
  db.transaction((tx) => {
    applyAttempt(tx as unknown as Db, attempt, now, useEmbedding, touchSource);
  });
}

function applyAttempt(db: Db, attempt: Attempt, now: Date, useEmbedding: boolean, touchSource: boolean): void {
  const day = shanghaiDate(now);
  if (attempt.requests > 0) addBudgetUsed(db, attempt.sourceId, day, attempt.requests);
  if (attempt.requests > 0 || attempt.usageItems > 0) addCount(db, usageDaily, day, attempt.sourceId, attempt.requests, attempt.usageItems);
  if (attempt.pauseUntil) setPause(db, attempt.sourceId, now, attempt.pauseUntil, attempt.pauseReason ?? attempt.error ?? '暂停');
  if (attempt.items.length > 0) ingestItems(db, attempt.items, now, useEmbedding);
  if (!touchSource) return;

  const status = attempt.status === 'cap' ? 'paused' : attempt.status;
  if (status === 'ok') {
    db.update(sources)
      .set({ lastStatus: 'ok', lastError: null, lastErrorAt: null, lastSuccessAt: now })
      .where(eq(sources.id, attempt.sourceId))
      .run();
    return;
  }
  db.update(sources)
    .set({
      lastStatus: status,
      lastError: attempt.pauseReason ?? attempt.error,
      lastErrorAt: now,
    })
    .where(eq(sources.id, attempt.sourceId))
    .run();
}

const STATUS_TEXT: Record<SourceRunStatus, string> = {
  idle: '未采集',
  ok: '正常',
  paused: '暂停至明天',
  skipped: '本轮跳过',
  error: '失败',
  unconfigured: '未配置密钥',
  disabled: '已关闭',
};

export function listSourceStatus(
  db: Db,
  now: Date,
  opts: { twitterConfigured: boolean; caps: { search: number; twitter: number }; running: boolean; embedding: EmbeddingNote },
): { day: string; running: boolean; embedding: EmbeddingNote; lastCollectAt: string | null; lastCollectNote: string | null; sources: SourceStatus[] } {
  const catalog = ensureSources(db, opts.caps);
  const day = shanghaiDate(now);
  const usageRows = db.select().from(usageDaily).where(eq(usageDaily.day, day)).all();
  const sourceRows = db.select().from(sources).all();
  const byId = new Map(sourceRows.map((row) => [row.id, row]));
  const collect = db.select().from(jobRuns).where(eq(jobRuns.name, 'collect')).get();

  const listed = catalog.map((entry) => {
    const row = byId.get(entry.id);
    const pause = activePause(db, entry.id, now);
    const usage = usageRows.find((item) => item.sourceId === entry.id);
    const enabled = row?.enabled !== false;
    let status: SourceRunStatus = 'idle';
    if (!enabled) status = 'disabled';
    else if (entry.id === 'twitter' && !opts.twitterConfigured) status = 'unconfigured';
    else if (pause) status = 'paused';
    else if (row?.lastStatus === 'skipped') status = 'skipped';
    else if (row?.lastStatus === 'error') status = 'error';
    else if (row?.lastStatus === 'ok' || row?.lastSuccessAt) status = 'ok';
    else if (row?.lastStatus === 'unconfigured') status = 'unconfigured';
    else if (row?.lastStatus === 'paused') status = 'paused';

    return {
      id: entry.id,
      type: entry.type as SourceType,
      name: entry.name,
      enabled,
      status,
      statusText: STATUS_TEXT[status],
      pauseReason: pause?.reason ?? (status === 'paused' ? row?.lastError ?? null : null),
      pausedUntil: pause?.until.toISOString() ?? null,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      lastError: status === 'ok' || status === 'disabled' ? null : row?.lastError ?? null,
      usage: {
        requests: usage?.requests ?? 0,
        items: usage?.items ?? 0,
        cap: entry.cap,
      },
    };
  });

  return {
    day,
    running: opts.running,
    embedding: opts.embedding,
    lastCollectAt: collect?.lastRunAt.toISOString() ?? null,
    lastCollectNote: collect?.lastError ?? null,
    sources: listed,
  };
}

export function listStories(db: Db, limit: number): Array<{
  id: string;
  title: string;
  summary: string | null;
  summaryZh: string | null;
  hotness: number | null;
  credibility: number | null;
  credibilityReason: string | null;
  aiMode: 'model' | 'rules' | null;
  updatedAt: string;
  sources: Array<{ id: string; name: string; type: SourceType; url: string | null }>;
}> {
  const storyRows = db
    .select()
    .from(stories)
    .where(or(isNull(stories.relevant), eq(stories.relevant, true)))
    .orderBy(desc(stories.updatedAt))
    .limit(limit)
    .all();
  if (storyRows.length === 0) return [];
  const ids = storyRows.map((row) => row.id);
  const links = db.select().from(storyItems).where(inArray(storyItems.storyId, ids)).all();
  const itemIds = [...new Set(links.map((link) => link.itemId))];
  const itemRows = itemIds.length === 0 ? [] : db.select().from(items).where(inArray(items.id, itemIds)).all();
  const sourceRows = db.select().from(sources).all();
  const itemById = new Map(itemRows.map((row) => [row.id, row]));
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));

  return storyRows.map((story) => {
    const seen = new Set<string>();
    const storySources: Array<{ id: string; name: string; type: SourceType; url: string | null }> = [];
    for (const link of links.filter((row) => row.storyId === story.id)) {
      const item = itemById.get(link.itemId);
      const source = item ? sourceById.get(item.sourceId) : undefined;
      if (!item || !source) continue;
      const url = item.url && /^https?:\/\//i.test(item.url) ? item.url : null;
      const key = url ?? `source:${source.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      storySources.push({ id: source.id, name: source.name, type: source.type as SourceType, url });
    }
    const aiMode = story.aiMode === 'model' || story.aiMode === 'rules' ? story.aiMode : null;
    return {
      id: story.id,
      title: story.title,
      summary: story.summary,
      summaryZh: story.summaryZh,
      hotness: story.hotness,
      credibility: story.credibility,
      credibilityReason: story.credibilityReason,
      aiMode,
      updatedAt: story.updatedAt.toISOString(),
      sources: storySources,
    };
  });
}

export function loadHomeRows(db: Db): HomeRow[] {
  const storyRows = db.select().from(stories).all();
  if (storyRows.length === 0) return [];
  const ids = storyRows.map((row) => row.id);
  const links = db.select().from(storyItems).where(inArray(storyItems.storyId, ids)).all();
  const itemIds = [...new Set(links.map((link) => link.itemId))];
  const itemRows = itemIds.length === 0 ? [] : db.select().from(items).where(inArray(items.id, itemIds)).all();
  const sourceRows = db.select().from(sources).all();
  const itemById = new Map(itemRows.map((row) => [row.id, row]));
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  return storyRows.map((story) => {
    const homeItems: HomeItem[] = [];
    for (const link of links) {
      if (link.storyId !== story.id) continue;
      const item = itemById.get(link.itemId);
      const source = item ? sourceById.get(item.sourceId) : undefined;
      if (!item || !source) continue;
      homeItems.push({
        sourceId: source.id,
        sourceType: source.type,
        sourceName: source.name,
        url: item.url,
        title: item.title,
        summary: item.summary,
        publishedAt: item.publishedAt,
      });
    }
    const aiMode = story.aiMode === 'model' || story.aiMode === 'rules' ? story.aiMode : null;
    return {
      id: story.id,
      title: story.title,
      summary: story.summary,
      summaryZh: story.summaryZh,
      eventTitle: story.eventTitle,
      hotness: story.hotness,
      credibility: story.credibility,
      credibilityReason: story.credibilityReason,
      aiMode,
      updatedAt: story.updatedAt,
      relevant: story.relevant,
      feedVerdict: story.feedVerdict,
      feedReason: story.feedReason,
      feedJudgedAt: story.feedJudgedAt,
      feedBadge: story.feedBadge,
      items: homeItems,
    };
  });
}

export function listHomepage(db: Db, limit: number, now: Date, modelOpen: boolean) {
  const domains = loadTrust(db).domains;
  return homepageCards(loadHomeRows(db), now, modelOpen, domains).slice(0, limit);
}

/** First collect only records counts. Later collects mark new homepage stories and source gains. */
export function markHomeBadges(db: Db, now: Date, modelOpen: boolean): void {
  const domains = loadTrust(db).domains;
  const cards = homepageCards(loadHomeRows(db), now, modelOpen, domains);
  const prevRows = db.select({ id: stories.id, homeSourceCount: stories.homeSourceCount }).from(stories).all();
  const prev = new Map(prevRows.map((row) => [row.id, row.homeSourceCount]));
  const seenBefore = prevRows.some((row) => row.homeSourceCount != null);
  db.update(stories).set({ feedBadge: null }).run();
  for (const card of cards) {
    const count = card.sources.length;
    const before = prev.get(card.id) ?? null;
    let badge: string | null = null;
    if (seenBefore && before == null) badge = '新上榜';
    else if (before != null && count > before) badge = `多了 ${count - before} 个来源`;
    db.update(stories).set({ feedBadge: badge, homeSourceCount: count }).where(eq(stories.id, card.id)).run();
  }
}

export function setSourceEnabled(db: Db, id: string, enabled: boolean): boolean {
  const row = db.select().from(sources).where(eq(sources.id, id)).get();
  if (!row) return false;
  db.update(sources).set({ enabled }).where(eq(sources.id, id)).run();
  return true;
}

export { nextShanghaiMidnight };
