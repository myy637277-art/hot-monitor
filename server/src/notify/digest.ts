import type { DigestLog, DigestReason, DigestSettings } from '@hot/shared';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { hasHan } from '../ai/formula.ts';
import { homepageCards } from '../collect/home.ts';
import { loadHomeRows } from '../collect/store.ts';
import { addDays, shanghaiDate } from '../collect/time.ts';
import type { Db } from '../db/index.ts';
import { digestLog, digestSchedule, items, notifications, stories, storyItems } from '../db/schema.ts';
import { loadTrust } from '../trust.ts';
import { postServerchan } from './serverchan.ts';

const DIGEST_ID = 'default';
const DIGEST_CAP = 15;
const SUMMARY_MAX = 80;

export interface DigestLine {
  storyId: string;
  title: string;
  summary: string;
  url: string | null;
}

export interface DigestInput {
  enabled: boolean;
  hour: number;
  minute: number;
  includeHome: boolean;
  includeKeywords: boolean;
}

const REASONS = new Set<DigestReason>(['sent', 'empty', 'unconfigured', 'failed', 'skipped']);

function oneLine(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX);
}

function lineTitle(eventTitle: string | null, title: string): string {
  const event = oneLine(eventTitle);
  if (event && hasHan(event)) return event;
  return oneLine(title);
}

function toSettings(row: typeof digestSchedule.$inferSelect): DigestSettings {
  const status = row.lastStatus;
  return {
    enabled: row.enabled,
    hour: row.hour,
    minute: row.minute,
    includeHome: row.includeHome,
    includeKeywords: row.includeKeywords,
    lastSentOn: row.lastSentOn,
    lastStatus: status && REASONS.has(status as DigestReason) ? (status as DigestReason) : null,
    lastHttpStatus: row.lastHttpStatus,
  };
}

export function readDigest(db: Db, now = new Date()): DigestSettings {
  const row = db.select().from(digestSchedule).where(eq(digestSchedule.id, DIGEST_ID)).get();
  if (row) return toSettings(row);
  db.insert(digestSchedule)
    .values({
      id: DIGEST_ID,
      enabled: false,
      hour: 8,
      minute: 0,
      includeHome: true,
      includeKeywords: false,
      updatedAt: now,
    })
    .run();
  return {
    enabled: false,
    hour: 8,
    minute: 0,
    includeHome: true,
    includeKeywords: false,
    lastSentOn: null,
    lastStatus: null,
    lastHttpStatus: null,
  };
}

export function saveDigest(db: Db, input: DigestInput, now: Date): DigestSettings {
  readDigest(db, now);
  db.update(digestSchedule)
    .set({
      enabled: input.enabled,
      hour: input.hour,
      minute: input.minute,
      includeHome: input.includeHome,
      includeKeywords: input.includeKeywords,
      updatedAt: now,
    })
    .where(eq(digestSchedule.id, DIGEST_ID))
    .run();
  return readDigest(db, now);
}

function dayWindow(day: string): { start: Date; end: Date } {
  return {
    start: new Date(`${day}T00:00:00+08:00`),
    end: new Date(`${addDays(day, 1)}T00:00:00+08:00`),
  };
}

function homeLines(db: Db, now: Date, day: string, modelOpen: boolean, room: number): DigestLine[] {
  const domains = loadTrust(db).domains;
  const cards = homepageCards(loadHomeRows(db), now, modelOpen, domains).filter(
    (card) => card.publishedAt != null && shanghaiDate(new Date(card.publishedAt)) === day,
  );
  return cards.slice(0, room).map((card) => ({
    storyId: card.id,
    title: lineTitle(card.eventTitle, card.title),
    summary: oneLine(card.summaryZh) || oneLine(card.summary) || '无摘要',
    url: card.sources.find((source) => source.url && /^https?:\/\//i.test(source.url))?.url ?? null,
  }));
}

function keywordLines(db: Db, day: string, seen: Set<string>, room: number): DigestLine[] {
  if (room <= 0) return [];
  const { start, end } = dayWindow(day);
  const notes = db
    .select()
    .from(notifications)
    .where(and(gte(notifications.createdAt, start), lt(notifications.createdAt, end)))
    .orderBy(desc(notifications.createdAt))
    .all();
  const ids: string[] = [];
  for (const note of notes) {
    if (seen.has(note.storyId) || ids.includes(note.storyId)) continue;
    ids.push(note.storyId);
    if (ids.length >= room) break;
  }
  if (ids.length === 0) return [];
  const storyRows = db.select().from(stories).where(inArray(stories.id, ids)).all();
  const byId = new Map(storyRows.map((row) => [row.id, row]));
  const links = db.select().from(storyItems).where(inArray(storyItems.storyId, ids)).all();
  const itemIds = [...new Set(links.map((link) => link.itemId))];
  const itemRows = itemIds.length === 0 ? [] : db.select().from(items).where(inArray(items.id, itemIds)).all();
  const itemById = new Map(itemRows.map((row) => [row.id, row]));
  const urls = new Map<string, string>();
  for (const link of links) {
    if (urls.has(link.storyId)) continue;
    const item = itemById.get(link.itemId);
    if (item?.url && /^https?:\/\//i.test(item.url)) urls.set(link.storyId, item.url);
  }
  const lines: DigestLine[] = [];
  for (const id of ids) {
    const story = byId.get(id);
    if (!story) continue;
    lines.push({
      storyId: id,
      title: lineTitle(story.eventTitle, story.title),
      summary: oneLine(story.summaryZh) || oneLine(story.summary) || '无摘要',
      url: urls.get(id) ?? null,
    });
  }
  return lines;
}

/** Homepage stories whose newest item falls on the Shanghai day of `now`, then that day's keyword hits. */
export function buildDigest(
  db: Db,
  now: Date,
  scope: { includeHome: boolean; includeKeywords: boolean },
  modelOpen: boolean,
): DigestLine[] {
  const day = shanghaiDate(now);
  const lines: DigestLine[] = [];
  const seen = new Set<string>();
  if (scope.includeHome) {
    for (const line of homeLines(db, now, day, modelOpen, DIGEST_CAP)) {
      lines.push(line);
      seen.add(line.storyId);
    }
  }
  if (scope.includeKeywords && lines.length < DIGEST_CAP) {
    lines.push(...keywordLines(db, day, seen, DIGEST_CAP - lines.length));
  }
  return lines;
}

export function formatDigest(day: string, lines: DigestLine[]): { title: string; desp: string } {
  const desp = lines
    .map((line, index) => {
      const parts = [`${index + 1}. ${line.title}`, line.summary];
      if (line.url) parts.push(line.url);
      return parts.join('\n');
    })
    .join('\n\n');
  return { title: `热点日报 ${day}`, desp };
}

export interface DeliverOpts {
  now: Date;
  modelOpen: boolean;
  serverchanKey?: string;
  fetchImpl: typeof fetch;
  mode: 'scheduled' | 'manual';
}

export async function deliverDigest(
  db: Db,
  opts: DeliverOpts,
): Promise<{ reason: DigestReason; count: number; httpStatus: number | null }> {
  const settings = readDigest(db, opts.now);
  const day = shanghaiDate(opts.now);
  if (opts.mode === 'scheduled' && (!settings.enabled || settings.lastSentOn === day)) {
    console.info('[digest] scheduled skipped count=0');
    const skipped = { reason: 'skipped' as const, count: 0, httpStatus: null };
    writeDigestLog(db, opts, skipped);
    return skipped;
  }
  const lines = buildDigest(db, opts.now, settings, opts.modelOpen);
  if (lines.length === 0) {
    return finish(db, opts, { reason: 'empty', count: 0, httpStatus: null }, false);
  }
  const key = opts.serverchanKey?.trim();
  if (!key) {
    return finish(db, opts, { reason: 'unconfigured', count: lines.length, httpStatus: null }, false);
  }
  const message = formatDigest(day, lines);
  try {
    const sent = await postServerchan(opts.fetchImpl, key, message.title, message.desp);
    const reason: DigestReason = sent.ok ? 'sent' : 'failed';
    return finish(db, opts, { reason, count: lines.length, httpStatus: sent.status }, opts.mode === 'scheduled' && sent.ok, day);
  } catch {
    return finish(db, opts, { reason: 'failed', count: lines.length, httpStatus: null }, false);
  }
}

function finish(
  db: Db,
  opts: DeliverOpts,
  result: { reason: DigestReason; count: number; httpStatus: number | null },
  markDay: boolean,
  day?: string,
) {
  db.update(digestSchedule)
    .set({
      lastStatus: result.reason,
      lastHttpStatus: result.httpStatus,
      ...(markDay && day ? { lastSentOn: day } : {}),
      updatedAt: opts.now,
    })
    .where(eq(digestSchedule.id, DIGEST_ID))
    .run();
  writeDigestLog(db, opts, result);
  const http = result.httpStatus == null ? '' : ` http=${result.httpStatus}`;
  console.info(`[digest] ${opts.mode} ${result.reason} count=${result.count}${http}`);
  return result;
}

export function listDigestLogs(db: Db): DigestLog[] {
  return db
    .select()
    .from(digestLog)
    .orderBy(desc(digestLog.sentAt))
    .limit(30)
    .all()
    .map((row) => ({
      id: row.id,
      sentAt: row.sentAt.toISOString(),
      mode: row.mode === 'manual' ? 'manual' : 'scheduled',
      reason: REASONS.has(row.reason as DigestReason) ? (row.reason as DigestReason) : 'failed',
      count: row.count,
      httpStatus: row.httpStatus,
    }));
}

function writeDigestLog(
  db: Db,
  opts: DeliverOpts,
  result: { reason: DigestReason; count: number; httpStatus: number | null },
): void {
  db.insert(digestLog)
    .values({
      id: randomUUID(),
      sentAt: opts.now,
      mode: opts.mode,
      reason: result.reason,
      count: result.count,
      httpStatus: result.httpStatus,
    })
    .run();
  const extra = db.select({ id: digestLog.id }).from(digestLog).orderBy(desc(digestLog.sentAt)).all().slice(30);
  if (extra.length > 0) db.delete(digestLog).where(inArray(digestLog.id, extra.map((row) => row.id))).run();
}
