import { randomUUID } from 'node:crypto';
import type { ClaimHold, DiscoverStory, Interest } from '@hot/shared';
import { and, desc, eq } from 'drizzle-orm';
import { CLAIM_WAIT, claimRows, judgeClaim, writeClaim } from '../ai/claim.ts';
import type { AiEnv } from '../ai/deepseek.ts';
import { hasHan } from '../ai/formula.ts';
import { HOME_WINDOW_MS, bestSourceStrength, type HomeItem, type HomeRow } from '../collect/home.ts';
import { loadHomeRows } from '../collect/store.ts';
import type { Db } from '../db/index.ts';
import { claimChecks, interests, jobRuns } from '../db/schema.ts';
import { clipAliasMap } from './aliases.ts';

const DIRECTION_CAP = 20;
const TERM_CAP = 5;
// shortcut: 30 cards, add paging if a domain regularly exceeds that
const DISCOVER_CAP = 30;
// shortcut: weibo_hot and bili_hot match the homepage block, update both if another hot list is added
const BLOCKED = new Set(['weibo_hot', 'bili_hot']);
// A needle that is only one of these does not identify a direction.
const GENERIC_NEEDLES = new Set(['方向', '研究', '研究方向', 'github', 'github.com']);
// Fallback when a save did not store model aliases. Arbitrary terms get aliases from DeepSeek at save time.
const RELATED: Record<string, readonly string[]> = {
  大模型: ['language model', '语言模型'],
  语言模型: ['language model', '大模型'],
  'language model': ['大模型', '语言模型'],
};

type WriteResult = { ok: true; interest: Interest } | { ok: false; error: 'bad_request' | 'limit' | 'duplicate' | 'missing' };

function cleanTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed || trimmed.length > 40) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (out.length === TERM_CAP) break;
    out.push(trimmed);
  }
  return out;
}

function readTerms(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return cleanTerms(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return [];
  }
}

export interface Direction {
  id: string;
  label: string;
  terms: string[];
  aliases: Record<string, string[]>;
}

function readAliasMap(raw: string, terms: string[]): Record<string, string[]> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const bag: Record<string, string[]> = {};
    for (const term of terms) {
      const value = (parsed as Record<string, unknown>)[term];
      if (Array.isArray(value)) bag[term] = value.filter((item): item is string => typeof item === 'string');
    }
    return clipAliasMap(bag, terms);
  } catch {
    return {};
  }
}

function toInterest(row: typeof interests.$inferSelect): Interest {
  return {
    id: row.id,
    label: row.label,
    terms: readTerms(row.terms),
    createdAt: row.createdAt.toISOString(),
  };
}

function toDirection(row: typeof interests.$inferSelect): Direction {
  const terms = readTerms(row.terms);
  return { id: row.id, label: row.label, terms, aliases: readAliasMap(row.aliases, terms) };
}

export function listDirections(db: Db): Direction[] {
  return db.select().from(interests).orderBy(desc(interests.createdAt)).all().map(toDirection);
}

export function listInterests(db: Db): Interest[] {
  return db.select().from(interests).orderBy(desc(interests.createdAt)).all().map(toInterest);
}

export function peekInterest(db: Db, id: string): { terms: string[]; aliases: Record<string, string[]> } | null {
  const row = db.select().from(interests).where(eq(interests.id, id)).get();
  if (!row) return null;
  const terms = readTerms(row.terms);
  return { terms, aliases: readAliasMap(row.aliases, terms) };
}

export function createInterest(
  db: Db,
  label: string,
  terms: string[],
  now: Date,
  aliases: Record<string, string[]> = {},
): WriteResult {
  const name = label.trim();
  const cleaned = cleanTerms(terms);
  if (!name || name.length > 40 || cleaned.length === 0) return { ok: false, error: 'bad_request' };
  const rows = db.select().from(interests).all();
  if (rows.length >= DIRECTION_CAP) return { ok: false, error: 'limit' };
  if (rows.some((row) => row.label.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'duplicate' };
  const row = {
    id: randomUUID(),
    label: name,
    terms: JSON.stringify(cleaned),
    aliases: JSON.stringify(clipAliasMap(aliases, cleaned)),
    createdAt: now,
  };
  db.insert(interests).values(row).run();
  return { ok: true, interest: toInterest(row) };
}

export function updateInterest(
  db: Db,
  id: string,
  label: string,
  terms: string[],
  aliases?: Record<string, string[]>,
): WriteResult {
  const name = label.trim();
  const cleaned = cleanTerms(terms);
  if (!name || name.length > 40 || cleaned.length === 0) return { ok: false, error: 'bad_request' };
  const row = db.select().from(interests).where(eq(interests.id, id)).get();
  if (!row) return { ok: false, error: 'missing' };
  const taken = db
    .select()
    .from(interests)
    .all()
    .some((item) => item.id !== id && item.label.toLowerCase() === name.toLowerCase());
  if (taken) return { ok: false, error: 'duplicate' };
  const aliasJson = aliases ? JSON.stringify(clipAliasMap(aliases, cleaned)) : row.aliases;
  db.update(interests).set({ label: name, terms: JSON.stringify(cleaned), aliases: aliasJson }).where(eq(interests.id, id)).run();
  return { ok: true, interest: toInterest({ ...row, label: name, terms: JSON.stringify(cleaned), aliases: aliasJson }) };
}

export function deleteInterest(db: Db, id: string): boolean {
  const row = db.select().from(interests).where(eq(interests.id, id)).get();
  if (!row) return false;
  db.delete(claimChecks).where(and(eq(claimChecks.kind, 'interest'), eq(claimChecks.ownerId, id))).run();
  db.delete(interests).where(eq(interests.id, id)).run();
  return true;
}

/** Typed terms only. Aliases are for matching stories already collected, not extra search queries. */
export function interestSearchTerms(db: Db): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const interest of listDirections(db)) {
    for (const term of interest.terms) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(term);
    }
  }
  return out;
}

function usableNeedle(phrase: string): string | null {
  const text = phrase.trim().toLowerCase();
  if (!text || GENERIC_NEEDLES.has(text)) return null;
  return text;
}

/** Whole phrase only. Latin needles use word boundaries, so "AI" does not match inside "chain" or "email". */
function phraseHits(phrase: string, hay: string): boolean {
  const needle = usableNeedle(phrase);
  if (!needle) return false;
  const folded = hay.toLowerCase();
  if (/[\u3400-\u9fff]/.test(needle)) return folded.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(folded);
}

export function termsMatch(
  terms: readonly string[],
  title: string,
  summaryZh: string | null,
  summary = '',
  aliases: Record<string, string[]> = {},
): boolean {
  const hay = `${title}\n${summaryZh ?? ''}\n${summary}`;
  for (const term of terms) {
    if (phraseHits(term, hay)) return true;
    const phrases = [...(aliases[term] ?? []), ...(RELATED[term.trim().toLowerCase()] ?? [])];
    if (phrases.some((phrase) => phraseHits(phrase, hay))) return true;
  }
  return false;
}

function toStory(row: HomeRow, items: HomeItem[], interestLabel: string): DiscoverStory {
  const seen = new Set<string>();
  const sources: DiscoverStory['sources'] = [];
  let published = 0;
  for (const item of items) {
    const url = item.url && /^https?:\/\//i.test(item.url) ? item.url : null;
    const key = url ?? `source:${item.sourceId}`;
    if (!seen.has(key)) {
      seen.add(key);
      sources.push({
        id: item.sourceId,
        name: item.sourceName,
        type: item.sourceType as DiscoverStory['sources'][number]['type'],
        url,
      });
    }
    published = Math.max(published, item.publishedAt?.getTime() ?? 0);
  }
  const eventTitle = row.eventTitle && hasHan(row.eventTitle) ? row.eventTitle.trim().slice(0, 80) : null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    summaryZh: row.summaryZh,
    hotness: row.hotness,
    credibility: row.credibility,
    credibilityReason: row.credibilityReason,
    aiMode: row.aiMode,
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: published > 0 ? new Date(published).toISOString() : null,
    eventTitle,
    feedReason: row.feedReason,
    feedVerdict: row.feedVerdict === 'reliable' || row.feedVerdict === 'uncertain' ? row.feedVerdict : null,
    sourceStrength: bestSourceStrength(items),
    unverified: row.aiMode !== 'model',
    feedBadge: row.feedBadge,
    sources,
    interestLabel,
  };
}

interface DiscoveryHit {
  story: DiscoverStory;
  interestId: string;
  urls: string[];
  summary: string;
}

function discoveryHits(db: Db, now: Date): DiscoveryHit[] {
  const active = listDirections(db);
  if (active.length === 0) return [];
  const cutoff = now.getTime() - HOME_WINDOW_MS;
  const cards: Array<DiscoveryHit & { at: number }> = [];
  for (const row of loadHomeRows(db)) {
    const visible = row.items.filter((item) => !BLOCKED.has(item.sourceType));
    const fresh = visible.filter((item) => item.publishedAt != null && item.publishedAt.getTime() >= cutoff);
    if (fresh.length === 0) continue;
    const title = [row.eventTitle, row.title].filter((part) => part && part.trim()).join('\n');
    const hit = active.find((interest) =>
      termsMatch(interest.terms, title, row.summaryZh, row.summary ?? '', interest.aliases),
    );
    if (!hit) continue;
    const at = Math.max(...fresh.map((item) => item.publishedAt?.getTime() ?? 0));
    const urls = fresh.map((item) => item.url).filter((url): url is string => Boolean(url && /^https?:\/\//i.test(url)));
    cards.push({
      story: toStory(row, fresh, hit.label),
      interestId: hit.id,
      urls,
      summary: row.summaryZh ?? row.summary ?? '',
      at,
    });
  }
  cards.sort((a, b) => b.at - a.at);
  return cards.slice(0, DISCOVER_CAP);
}

export function listDiscoveries(db: Db, now: Date): DiscoverStory[] {
  return discoveryHits(db, now).map((hit) => hit.story);
}

const SHOWN_BEFORE = '升级前已对上';
const SEED_JOB = 'claim-seed';

/** One-time pass for interest matches that were already on screen before checks existed. */
export function seedShownClaims(db: Db, now: Date): void {
  const seeded = db.select().from(jobRuns).where(eq(jobRuns.name, SEED_JOB)).get();
  if (seeded) return;
  for (const hit of discoveryHits(db, now)) {
    writeClaim(db, {
      kind: 'interest',
      ownerId: hit.interestId,
      storyId: hit.story.id,
      verdict: { status: 'pass', relevant: null, authentic: null, reason: SHOWN_BEFORE },
      at: now,
    });
  }
  db.insert(jobRuns).values({ name: SEED_JOB, lastRunAt: now, runCount: 1, lastError: null }).run();
}

export async function reviewInterests(db: Db, env: AiEnv, now: Date, signal?: AbortSignal): Promise<void> {
  const saved = new Map(claimRows(db, 'interest').map((row) => [`${row.ownerId}:${row.storyId}`, row]));
  for (const hit of discoveryHits(db, now)) {
    if (signal?.aborted) return;
    const existing = saved.get(`${hit.interestId}:${hit.story.id}`);
    if (existing && existing.status !== 'pending') continue;
    const verdict = await judgeClaim(db, env, {
      label: hit.story.interestLabel,
      title: hit.story.eventTitle ?? hit.story.title,
      summary: hit.summary,
      urls: hit.urls,
    });
    writeClaim(db, { kind: 'interest', ownerId: hit.interestId, storyId: hit.story.id, verdict, at: now });
  }
}

export function listDiscoveryFeed(db: Db, now: Date): { stories: DiscoverStory[]; holds: ClaimHold[] } {
  const saved = new Map(claimRows(db, 'interest').map((row) => [`${row.ownerId}:${row.storyId}`, row]));
  const stories: DiscoverStory[] = [];
  const holds: ClaimHold[] = [];
  for (const hit of discoveryHits(db, now)) {
    const check = saved.get(`${hit.interestId}:${hit.story.id}`);
    const url = hit.story.sources.map((source) => source.url).find((item) => item && /^https?:\/\//i.test(item)) ?? null;
    if (check?.status === 'pass') {
      stories.push(hit.story);
      continue;
    }
    const status = check?.status === 'reject' ? 'reject' : 'pending';
    holds.push({
      storyId: hit.story.id,
      label: hit.story.interestLabel,
      title: hit.story.eventTitle ?? hit.story.title,
      reason: check?.reason ?? CLAIM_WAIT,
      status,
      url,
    });
  }
  return { stories, holds };
}
