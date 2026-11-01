import { randomUUID } from 'node:crypto';
import type { ClaimHold, NotifyChannel, Watch, WatchNotification } from '@hot/shared';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { claimRows, judgeClaim, writeClaim, type ClaimInput, type ClaimVerdict } from '../ai/claim.ts';
import type { AiEnv } from '../ai/deepseek.ts';
import type { Db } from '../db/index.ts';
import { claimChecks, items, jobRuns, notifications, stories, storyItems, watches } from '../db/schema.ts';
import { postServerchan } from './serverchan.ts';

const LATIN = /[a-z0-9][a-z0-9+]{3,}/g;
const MATCH_JOB = 'keyword-match';

export function keywordHits(keyword: string, title: string, summaryZh: string | null, extra = ''): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return false;
  const hay = `${title}\n${summaryZh ?? ''}\n${extra}`.toLowerCase();
  if (hay.includes(needle)) return true;
  return (needle.match(LATIN) ?? []).some((token) => hay.includes(token));
}

function toWatch(row: typeof watches.$inferSelect): Watch {
  return {
    id: row.id,
    keyword: row.keyword,
    paused: row.paused,
    createdAt: row.createdAt.toISOString(),
  };
}

function toNote(row: typeof notifications.$inferSelect, url: string | null): WatchNotification {
  const channel: NotifyChannel = row.channel === 'sent' || row.channel === 'failed' ? row.channel : 'skipped';
  return {
    id: row.id,
    watchId: row.watchId,
    storyId: row.storyId,
    keyword: row.keyword,
    title: row.title,
    body: row.body,
    channel,
    httpStatus: row.httpStatus ?? null,
    createdAt: row.createdAt.toISOString(),
    url,
  };
}

export function listWatchState(db: Db): {
  watches: Watch[];
  notifications: WatchNotification[];
  holds: ClaimHold[];
  matchNote: string | null;
} {
  const watchRows = db.select().from(watches).orderBy(desc(watches.createdAt)).all();
  const noteRows = db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(50).all();
  const held = claimRows(db, 'keyword').filter((row) => row.status === 'reject' || row.status === 'pending');
  const storyIds = [...noteRows.map((row) => row.storyId), ...held.map((row) => row.storyId)];
  const urls = storyUrls(db, storyIds);
  const wanted = [...new Set(storyIds)];
  const titleRows =
    wanted.length === 0
      ? []
      : db.select({ id: stories.id, title: stories.title }).from(stories).where(inArray(stories.id, wanted)).all();
  const titles = new Map(titleRows.map((row) => [row.id, row.title]));
  const labels = new Map(watchRows.map((row) => [row.id, row.keyword]));
  const match = db.select().from(jobRuns).where(eq(jobRuns.name, MATCH_JOB)).get();
  return {
    watches: watchRows.map(toWatch),
    notifications: noteRows.map((row) => toNote(row, urls.get(row.storyId) ?? null)),
    holds: held.flatMap((row) => {
      const title = titles.get(row.storyId);
      const label = labels.get(row.ownerId);
      if (!title || !label || (row.status !== 'reject' && row.status !== 'pending')) return [];
      return [{ storyId: row.storyId, label, title, reason: row.reason, status: row.status, url: urls.get(row.storyId) ?? null }];
    }),
    matchNote: match?.lastError ?? null,
  };
}

export function createWatch(db: Db, keyword: string, now: Date): { ok: true; watch: Watch } | { ok: false; error: 'duplicate' } {
  const trimmed = keyword.trim();
  const taken = db
    .select()
    .from(watches)
    .all()
    .some((row) => row.keyword.toLowerCase() === trimmed.toLowerCase());
  if (taken) return { ok: false, error: 'duplicate' };
  const row = { id: randomUUID(), keyword: trimmed, paused: false, since: now, createdAt: now };
  db.insert(watches).values(row).run();
  return { ok: true, watch: toWatch(row) };
}

export function setWatchPaused(db: Db, id: string, paused: boolean, now: Date): boolean {
  const row = db.select().from(watches).where(eq(watches.id, id)).get();
  if (!row) return false;
  db.update(watches)
    .set(paused ? { paused: true } : { paused: false, since: now })
    .where(eq(watches.id, id))
    .run();
  return true;
}

export function deleteWatch(db: Db, id: string): boolean {
  const row = db.select().from(watches).where(eq(watches.id, id)).get();
  if (!row) return false;
  db.delete(claimChecks).where(and(eq(claimChecks.kind, 'keyword'), eq(claimChecks.ownerId, id))).run();
  db.delete(notifications).where(eq(notifications.watchId, id)).run();
  db.delete(watches).where(eq(watches.id, id)).run();
  return true;
}

async function deliver(
  fetchImpl: typeof fetch,
  key: string | undefined,
  title: string,
  body: string,
  keyword: string,
): Promise<{ channel: NotifyChannel; httpStatus: number | null }> {
  const trimmed = key?.trim();
  if (!trimmed) return { channel: 'skipped', httpStatus: null };
  try {
    const result = await postServerchan(fetchImpl, trimmed, title, `关键词：${keyword}\n\n${body}`);
    return { channel: result.ok ? 'sent' : 'failed', httpStatus: result.status };
  } catch {
    return { channel: 'failed', httpStatus: null };
  }
}

/** Notify active watches about stories created since the watch's `since` time. A pass is required before the row or WeChat send. */
export async function matchWatches(
  db: Db,
  opts: {
    now: Date;
    serverchanKey?: string;
    fetchImpl: typeof fetch;
    env?: AiEnv;
    signal?: AbortSignal;
    verdict?: (input: ClaimInput) => Promise<ClaimVerdict>;
  },
): Promise<number> {
  const decide =
    opts.verdict ??
    (opts.env
      ? (input: ClaimInput) => judgeClaim(db, opts.env as AiEnv, input)
      : async (): Promise<ClaimVerdict> => ({ status: 'pending', relevant: null, authentic: null, reason: '等待核对' }));
  const active = db.select().from(watches).where(eq(watches.paused, false)).all();
  let created = 0;
  let matched = 0;
  for (const watch of active) {
    if (opts.signal?.aborted) break;
    const rows = db
      .select()
      .from(stories)
      .where(and(gte(stories.createdAt, watch.since), or(isNull(stories.relevant), eq(stories.relevant, true))))
      .all();
    const facts = storyFacts(db, rows.map((row) => row.id));
    const saved = new Map(
      claimRows(db, 'keyword')
        .filter((row) => row.ownerId === watch.id)
        .map((row) => [row.storyId, row]),
    );
    for (const story of rows) {
      const fact = facts.get(story.id);
      const hay = `${story.summary ?? ''}\n${fact?.text ?? ''}`;
      if (opts.signal?.aborted) break;
      if (!keywordHits(watch.keyword, story.title, story.summaryZh, hay)) continue;
      matched += 1;
      const existing = db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.watchId, watch.id), eq(notifications.storyId, story.id)))
        .get();
      if (existing) continue;
      const prior = saved.get(story.id);
      const verdict =
        prior && prior.status !== 'pending'
          ? {
              status: prior.status as ClaimVerdict['status'],
              relevant: prior.relevant,
              authentic: prior.authentic,
              reason: prior.reason,
            }
          : await decide({
              label: watch.keyword,
              title: story.title,
              summary: story.summaryZh ?? story.summary ?? '',
              urls: fact?.urls ?? [],
            });
      if (!prior || prior.status === 'pending') {
        writeClaim(db, { kind: 'keyword', ownerId: watch.id, storyId: story.id, verdict, at: opts.now });
      }
      if (verdict.status !== 'pass') continue;
      const body = story.summaryZh?.trim() || story.title;
      const sent = await deliver(opts.fetchImpl, opts.serverchanKey, story.title, body, watch.keyword);
      db.insert(notifications)
        .values({
          id: randomUUID(),
          watchId: watch.id,
          storyId: story.id,
          keyword: watch.keyword,
          title: story.title,
          body,
          channel: sent.channel,
          httpStatus: sent.httpStatus,
          createdAt: opts.now,
        })
        .run();
      created += 1;
    }
  }
  const matchNote = active.length > 0 && matched === 0 ? '这次采集没有命中关键词。' : null;
  db.insert(jobRuns)
    .values({ name: MATCH_JOB, lastRunAt: opts.now, runCount: 1, lastError: matchNote })
    .onConflictDoUpdate({
      target: jobRuns.name,
      set: { lastRunAt: opts.now, runCount: sql`${jobRuns.runCount} + 1`, lastError: matchNote },
    })
    .run();
  return created;
}

function storyUrls(db: Db, storyIds: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (storyIds.length === 0) return out;
  const links = db.select().from(storyItems).where(inArray(storyItems.storyId, storyIds)).all();
  const itemIds = [...new Set(links.map((link) => link.itemId))];
  const itemRows = itemIds.length === 0 ? [] : db.select().from(items).where(inArray(items.id, itemIds)).all();
  const itemById = new Map(itemRows.map((row) => [row.id, row]));
  for (const link of links) {
    if (out.has(link.storyId)) continue;
    const url = itemById.get(link.itemId)?.url;
    if (url && /^https?:\/\//i.test(url)) out.set(link.storyId, url);
  }
  return out;
}

function storyFacts(db: Db, storyIds: string[]): Map<string, { text: string; urls: string[] }> {
  const out = new Map<string, { text: string; urls: string[] }>();
  if (storyIds.length === 0) return out;
  const links = db.select().from(storyItems).where(inArray(storyItems.storyId, storyIds)).all();
  const itemIds = [...new Set(links.map((link) => link.itemId))];
  const itemRows = itemIds.length === 0 ? [] : db.select().from(items).where(inArray(items.id, itemIds)).all();
  const itemById = new Map(itemRows.map((row) => [row.id, row]));
  for (const link of links) {
    const item = itemById.get(link.itemId);
    if (!item) continue;
    const fact = out.get(link.storyId) ?? { text: '', urls: [] };
    fact.text = `${fact.text}\n${item.title}\n${item.summary ?? ''}`;
    if (/^https?:\/\//i.test(item.url)) fact.urls.push(item.url);
    out.set(link.storyId, fact);
  }
  return out;
}
