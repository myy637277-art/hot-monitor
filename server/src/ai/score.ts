import type { AiStatus } from '@hot/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Net } from '../collect/types.ts';
import type { Db } from '../db/index.ts';
import { domainReputation, items, sources, stories, storyItems, watches, xAccountReputation } from '../db/schema.ts';
import { listDirections, termsMatch } from '../discover/interests.ts';
import { keywordHits } from '../notify/watch.ts';
import { loadTrust } from '../trust.ts';
import {
  blendCredibility,
  credibilityRule,
  hasHan,
  hotnessScore,
  locallyRelevant,
  rulesSummary,
  type ScoreItem,
} from './formula.ts';
import {
  aiFailureText,
  aiModelNote,
  aiUsed,
  circuitOpen,
  completeJson,
  hasAiKey,
  type AiEnv,
  type AiFailure,
} from './deepseek.ts';

const ANALYSIS_BATCH = 4;
const OFFICIAL_DOMAINS: Array<[string, number]> = [
  ['openai.com', 40],
  ['anthropic.com', 40],
  ['deepmind.google', 40],
  ['huggingface.co', 40],
  ['arxiv.org', 40],
  ['nvidia.com', 40],
];
const PRESS_DOMAINS: Array<[string, number]> = [
  ['reuters.com', 28],
  ['jiqizhixin.com', 28],
  ['qbitai.com', 28],
  ['theverge.com', 28],
];
const OFFICIAL_HANDLES = ['openai', 'anthropicai', 'googledeepmind', 'huggingface', 'nvidia'];

let tail: Promise<void> = Promise.resolve();
let active = 0;

export function aiScoring(): boolean {
  return active > 0;
}

export function aiEnvFromProcess(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = globalThis.fetch): AiEnv {
  return {
    apiKey: env.DEEPSEEK_API_KEY,
    fetch: fetchImpl,
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    model: env.DEEPSEEK_MODEL,
  };
}

/** The collector's key wins, so a test net without a key cannot see the machine environment. */
export function aiEnvForNet(net: Net): AiEnv {
  return { ...aiEnvFromProcess(process.env, net.fetch), apiKey: net.deepseekKey, now: net.now, sleep: net.sleep, fetch: net.fetch };
}

export function readAiStatus(db: Db, env: AiEnv): AiStatus {
  const used = aiUsed(db, env.now());
  const key = hasAiKey(env);
  let reason: string | null = null;
  if (!key) reason = '未配置 DEEPSEEK_API_KEY，当前为仅规则模式';
  else if (circuitOpen(env.now())) reason = '模型连续失败，5 分钟内仅规则判断';
  return {
    enabled: reason == null,
    used,
    cap: null,
    reason,
    modelNote: key ? aiModelNote() : null,
    scoring: aiScoring(),
  };
}

export function withAiLock(job: () => Promise<void>): Promise<void> {
  active += 1;
  const run = tail.then(job);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run.finally(() => {
    active -= 1;
  });
}

export function scoreStories(db: Db, env: AiEnv, signal?: AbortSignal): Promise<void> {
  return withAiLock(() => scoreNow(db, env, signal));
}

async function scoreNow(db: Db, env: AiEnv, signal?: AbortSignal): Promise<void> {
  seedReputation(db);
  const fresh = db
    .select()
    .from(stories)
    .where(sql`${stories.scoredAt} is null or ${stories.updatedAt} > ${stories.scoredAt}`)
    .all();
  const freshIds = new Set(fresh.map((row) => row.id));
  const keywords = db
    .select({ keyword: watches.keyword })
    .from(watches)
    .where(eq(watches.paused, false))
    .all()
    .map((row) => row.keyword);
  const directions = listDirections(db);
  const extras =
    canCallModel(db, env) && (keywords.length > 0 || directions.length > 0)
      ? db
          .select()
          .from(stories)
          .where(sql`${stories.scoredAt} is not null and (${stories.aiMode} is null or ${stories.aiMode} != 'model')`)
          .all()
          .filter((row) => !freshIds.has(row.id) && !(row.updatedAt > (row.scoredAt ?? row.updatedAt)))
      : [];
  const pool = [...fresh, ...extras];
  if (pool.length === 0) return;

  const ids = pool.map((row) => row.id);
  const links = db.select().from(storyItems).where(inArray(storyItems.storyId, ids)).all();
  const itemIds = [...new Set(links.map((link) => link.itemId))];
  const itemRows = itemIds.length === 0 ? [] : db.select().from(items).where(inArray(items.id, itemIds)).all();
  const sourceRows = db.select().from(sources).all();
  const itemById = new Map(itemRows.map((row) => [row.id, row]));
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const snippetByStory = new Map<string, string>();
  for (const link of links) {
    const item = itemById.get(link.itemId);
    if (!item) continue;
    snippetByStory.set(link.storyId, `${snippetByStory.get(link.storyId) ?? ''}\n${item.title}\n${item.summary ?? ''}`);
  }

  const prepared = pool.flatMap((story) => {
    const scored: ScoreItem[] = [];
    for (const link of links) {
      if (link.storyId !== story.id) continue;
      const item = itemById.get(link.itemId);
      if (!item) continue;
      const source = sourceById.get(item.sourceId);
      scored.push({
        url: item.url,
        title: item.title,
        summary: item.summary,
        sourceId: item.sourceId,
        sourceType: source?.type ?? '',
        publishedAt: item.publishedAt,
      });
    }
    if (scored.length === 0) {
      scored.push({
        url: '',
        title: story.title,
        summary: story.summary,
        sourceId: 'story',
        sourceType: '',
        publishedAt: story.updatedAt,
      });
    }
    const extra = `${story.summary ?? ''}\n${snippetByStory.get(story.id) ?? ''}`;
    const keyword = keywords.some((keyword) => keywordHits(keyword, story.title, story.summaryZh, extra));
    const interest = directions.some((direction) =>
      termsMatch(
        direction.terms,
        `${story.eventTitle ?? ''}\n${story.title}`,
        story.summaryZh,
        story.summary ?? '',
        direction.aliases,
      ),
    );
    if (!freshIds.has(story.id) && !keyword && !interest) return [];
    return [{ story, items: scored, relevant: locallyRelevant(scored), keyword, interest }];
  });
  if (prepared.length === 0) return;

  const summaries = new Map<string, { relevant: boolean; summary: string; fromModel: boolean }>();
  const verdicts = new Map<string, { score: number; reason: string } | null>();
  const failures = new Map<string, AiFailure>();
  const failureStatus = new Map<string, number>();
  const targets = prepared.filter((row) => row.relevant || row.keyword || row.interest);
  const keyed = hasAiKey(env);
  let halted = false;
  let haltFailure: AiFailure | null = null;
  let haltStatus: number | undefined;

  const noteFailure = (batch: typeof targets, failure: AiFailure, status?: number) => {
    for (const row of batch) {
      failures.set(row.story.id, failure);
      if (status != null) failureStatus.set(row.story.id, status);
    }
    if (failure !== 'bad_json') {
      halted = true;
      haltFailure = failure;
      haltStatus = status;
    }
  };

  if (keyed && targets.length > 0) {
    for (const batch of chunks(targets, ANALYSIS_BATCH)) {
      if (halted || signal?.aborted) break;
      const parsed = await completeJson(db, env, analysisPrompt(batch));
      if (!parsed) break;
      if (parsed.failure) {
        noteFailure(batch, parsed.failure, parsed.status);
        continue;
      }
      const got = readAnalysis(parsed.json);
      for (const row of batch) {
        const hit = got?.get(row.story.id);
        if (!hit || !hasHan(hit.summary)) {
          summaries.set(row.story.id, { relevant: row.relevant, summary: rulesSummary(row.story.title, row.story.summary), fromModel: false });
          failures.set(row.story.id, 'bad_json');
        } else {
          summaries.set(row.story.id, { relevant: hit.relevant, summary: hit.summary.slice(0, 200), fromModel: true });
          if (Number.isFinite(hit.score)) verdicts.set(row.story.id, { score: hit.score, reason: hit.reason });
        }
      }
    }
  }

  if (haltFailure) {
    for (const row of targets) {
      if (summaries.has(row.story.id) || failures.has(row.story.id)) continue;
      failures.set(row.story.id, haltFailure);
      if (haltStatus != null) failureStatus.set(row.story.id, haltStatus);
    }
  }

  const now = env.now();
  const trust = loadTrust(db);
  for (const row of prepared) {
    const summaryHit = summaries.get(row.story.id);
    const fail = failures.get(row.story.id);
    const needsModel = row.relevant || row.keyword || row.interest;
    if (keyed && needsModel && !summaryHit && !fail) continue;
    const rule = credibilityRule(row.items, trust);
    const verdict = verdicts.get(row.story.id);
    const modelScore = verdict && Number.isFinite(verdict.score) ? Math.max(0, Math.min(100, Math.round(verdict.score))) : null;
    const previousSummary = row.story.aiMode === 'model' && row.story.summaryZh && hasHan(row.story.summaryZh) ? row.story.summaryZh : null;
    const fromModel = summaryHit?.fromModel === true || Boolean(previousSummary && fail);
    let reason = `${rule.reason}。仅规则判断`;
    if (verdict && hasHan(verdict.reason)) reason = verdict.reason.slice(0, 80);
    else if (fromModel && modelScore != null) reason = `${rule.reason}。模型分 ${modelScore}`;
    else if (fail) reason = aiFailureText(fail, failureStatus.get(row.story.id));
    else if (fromModel) reason = `${rule.reason}。AI 未判定`;
    if (rule.hardCap) reason = `${rule.reason}。可信度封顶 30`;
    const relevant = row.keyword ? true : summaryHit ? summaryHit.relevant && row.relevant : row.relevant;
    const summaryZh = summaryHit?.fromModel ? summaryHit.summary : (previousSummary ?? summaryHit?.summary ?? rulesSummary(row.story.title, row.story.summary));
    db.update(stories)
      .set({
        summaryZh,
        relevant,
        hotness: hotnessScore({ items: row.items, updatedAt: row.story.updatedAt }, now),
        credibility: blendCredibility(rule.score, fromModel || modelScore != null ? modelScore : null, rule.hardCap),
        credibilityReason: reason,
        aiMode: fromModel || modelScore != null ? 'model' : 'rules',
        scoredAt: now,
      })
      .where(eq(stories.id, row.story.id))
      .run();
  }
}

function canCallModel(db: Db, env: AiEnv): boolean {
  return hasAiKey(env) && !circuitOpen(env.now());
}

function analysisPrompt(batch: Array<{ story: { id: string; title: string; summary: string | null }; items: ScoreItem[] }>): string {
  const rows = batch.map((row) => ({
    id: row.story.id,
    text: clip(`${row.story.title}\n${row.items.map((item) => `${item.title} ${item.summary ?? ''}`).join('\n')}`),
    urls: row.items.map((item) => item.url).filter(Boolean).slice(0, 6),
  }));
  return `判断每条材料是否与人工智能或科技热点相关。为相关条目写一句中文摘要，并给出可信度。英文材料也必须输出中文摘要。score 为 0 到 100 的整数，reason 为一句中文理由。仿冒官网和黑名单域名应给低分。\n只输出 JSON 对象 {"items":[{"id":"","relevant":true,"summary":"","score":0,"reason":""}]}\n${JSON.stringify(rows)}`;
}

function clip(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 1500);
}

function readAnalysis(json: unknown): Map<string, { relevant: boolean; summary: string; score: number; reason: string }> | null {
  if (!json || typeof json !== 'object' || !Array.isArray((json as { items?: unknown }).items)) return null;
  const map = new Map<string, { relevant: boolean; summary: string; score: number; reason: string }>();
  for (const item of (json as { items: unknown[] }).items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; relevant?: unknown; summary?: unknown; score?: unknown; reason?: unknown };
    if (typeof row.id !== 'string') continue;
    const score = typeof row.score === 'number' ? row.score : Number(row.score);
    map.set(row.id, {
      relevant: row.relevant === true,
      summary: typeof row.summary === 'string' ? row.summary.trim() : '',
      score,
      reason: typeof row.reason === 'string' ? row.reason.trim() : '',
    });
  }
  return map;
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function seedReputation(db: Db): void {
  for (const [domain, score] of [...OFFICIAL_DOMAINS, ...PRESS_DOMAINS]) {
    const kind = score >= 40 ? 'official' : 'press';
    db.insert(domainReputation)
      .values({ domain, kind, score })
      .onConflictDoNothing()
      .run();
  }
  for (const handle of OFFICIAL_HANDLES) {
    db.insert(xAccountReputation).values({ handle, kind: 'official' }).onConflictDoNothing().run();
  }
}
