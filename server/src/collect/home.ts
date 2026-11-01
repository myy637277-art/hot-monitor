import type { HotStory, SourceType } from '@hot/shared';
import { hasHan, hostOf, isAuthorityHost, sourceStrength } from '../ai/formula.ts';
import type { RawItem } from './types.ts';

export const HOME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const HOME_PREVIEW = 15;

const SEARCH = new Set(['search_sogou', 'search_google', 'search_ddg']);
const POST = new Set(['twitter', 'hn', 'github']);
const BLOCKED = new Set(['weibo_hot', 'bili_hot']);

export interface HomeItem {
  sourceId: string;
  sourceType: string;
  sourceName: string;
  url: string | null;
  title: string;
  summary: string | null;
  publishedAt: Date | null;
}

export interface HomeRow {
  id: string;
  title: string;
  summary: string | null;
  summaryZh: string | null;
  eventTitle: string | null;
  hotness: number | null;
  credibility: number | null;
  credibilityReason: string | null;
  aiMode: 'model' | 'rules' | null;
  updatedAt: Date;
  relevant: boolean | null;
  feedVerdict: string | null;
  feedReason: string | null;
  feedJudgedAt: Date | null;
  feedBadge: string | null;
  items: HomeItem[];
}

export function parseLooseDate(text: string, now: Date): Date | null {
  const abs = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(text);
  if (abs?.[1] && abs[2] && abs[3]) {
    const parsed = new Date(Date.UTC(Number(abs[1]), Number(abs[2]) - 1, Number(abs[3])));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const days = /(\d{1,2})\s*天前/.exec(text);
  if (days?.[1]) return new Date(now.getTime() - Number(days[1]) * 24 * 60 * 60 * 1000);
  const hours = /(\d{1,2})\s*小时前/.exec(text);
  if (hours?.[1]) return new Date(now.getTime() - Number(hours[1]) * 60 * 60 * 1000);
  if (text.includes('昨天')) return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return null;
}

/** Keyword hits keep a publish time inside the homepage window and an authority host. */
export function filterKeywordHits(items: RawItem[], now: Date, extraDomains: readonly string[] = []): RawItem[] {
  const cutoff = now.getTime() - HOME_WINDOW_MS;
  const kept: RawItem[] = [];
  for (const item of items) {
    const publishedAt = item.publishedAt ?? parseLooseDate(`${item.title}\n${item.summary ?? ''}`, now);
    if (!publishedAt || publishedAt.getTime() < cutoff) continue;
    const host = hostOf(item.url);
    if (!host || !isAuthorityHost(host, extraDomains)) continue;
    kept.push({ ...item, publishedAt });
  }
  return kept;
}

export function visibleItems(items: HomeItem[], now: Date, extraDomains: readonly string[] = []): HomeItem[] {
  const cutoff = now.getTime() - HOME_WINDOW_MS;
  return items.filter((item) => {
    if (BLOCKED.has(item.sourceType)) return false;
    if (!item.publishedAt || item.publishedAt.getTime() < cutoff) return false;
    if (!SEARCH.has(item.sourceType)) return true;
    const host = item.url ? hostOf(item.url) : null;
    return host != null && isAuthorityHost(host, extraDomains);
  });
}

export function passesHomeGate(items: HomeItem[]): boolean {
  if (items.length === 0) return false;
  const postsOnly = items.every((item) => POST.has(item.sourceType));
  if (!postsOnly) return true;
  if (items.every((item) => item.sourceType === 'twitter')) return true;
  return new Set(items.map((item) => item.sourceId)).size >= 2;
}

export function homepageCards(rows: HomeRow[], now: Date, modelOpen: boolean, extraDomains: readonly string[] = []): HotStory[] {
  const ready = rows.flatMap((row) => {
    if (row.relevant === false) return [];
    const items = visibleItems(row.items, now, extraDomains);
    if (!passesHomeGate(items)) return [];
    return [{ row, items }];
  });
  ready.sort((a, b) => {
    const agree = sourceCount(b.items) - sourceCount(a.items);
    if (agree !== 0) return agree;
    const strength = bestSourceStrength(b.items) - bestSourceStrength(a.items);
    if (strength !== 0) return strength;
    return newest(b.items) - newest(a.items);
  });
  const cards: HotStory[] = [];
  for (const entry of ready) {
    const verdict = entry.row.feedVerdict;
    if (verdict === 'unreliable') continue;
    const judged = verdict === 'reliable' || verdict === 'uncertain';
    if (!judged && modelOpen) continue;
    cards.push(toCard(entry.row, entry.items, !judged));
  }
  return cards;
}

/** Rows the model should judge: they pass the homepage gate and have no current verdict. */
export function rowsToJudge(rows: HomeRow[], now: Date, extraDomains: readonly string[] = []): Array<{ row: HomeRow; items: HomeItem[] }> {
  return rows.flatMap((row) => {
    if (row.relevant === false) return [];
    const items = visibleItems(row.items, now, extraDomains);
    if (!passesHomeGate(items)) return [];
    const judged = row.feedVerdict === 'reliable' || row.feedVerdict === 'uncertain' || row.feedVerdict === 'unreliable';
    if (judged && (!row.feedJudgedAt || row.updatedAt <= row.feedJudgedAt)) return [];
    return [{ row, items }];
  });
}

function sourceCount(items: HomeItem[]): number {
  return new Set(items.map((item) => item.sourceId)).size;
}

export function bestSourceStrength(items: HomeItem[]): number {
  return items.reduce((max, item) => {
    const host = item.url ? hostOf(item.url) : null;
    return Math.max(max, host ? sourceStrength(host) : 0);
  }, 0);
}

function newest(items: HomeItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.publishedAt?.getTime() ?? 0), 0);
}

function toCard(row: HomeRow, items: HomeItem[], unverified: boolean): HotStory {
  const seen = new Set<string>();
  const sources: HotStory['sources'] = [];
  for (const item of items) {
    const url = item.url && /^https?:\/\//i.test(item.url) ? item.url : null;
    const key = url ?? `source:${item.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      id: item.sourceId,
      name: item.sourceName,
      type: item.sourceType as SourceType,
      url,
    });
  }
  const published = newest(items);
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
    feedReason: unverified ? null : row.feedReason,
    feedVerdict: row.feedVerdict === 'reliable' || row.feedVerdict === 'uncertain' ? row.feedVerdict : null,
    sourceStrength: bestSourceStrength(items),
    unverified,
    feedBadge: row.feedBadge,
    sources,
  };
}
