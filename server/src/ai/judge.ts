import { eq } from 'drizzle-orm';
import { hasHan } from './formula.ts';
import { loadTrust } from '../trust.ts';
import { rowsToJudge, type HomeItem, type HomeRow } from '../collect/home.ts';
import { loadHomeRows } from '../collect/store.ts';
import type { Db } from '../db/index.ts';
import { stories } from '../db/schema.ts';
import { completeJson, hasAiKey, type AiEnv } from './deepseek.ts';
import { withAiLock } from './score.ts';

const BATCH = 4;
const VERDICTS = new Set(['reliable', 'uncertain', 'unreliable']);

export function judgeHomepage(db: Db, env: AiEnv, signal?: AbortSignal): Promise<void> {
  return withAiLock(() => judgeNow(db, env, signal));
}

async function judgeNow(db: Db, env: AiEnv, signal?: AbortSignal): Promise<void> {
  if (!hasAiKey(env)) return;
  const pending = rowsToJudge(loadHomeRows(db), env.now(), loadTrust(db).domains);
  if (pending.length === 0) return;
  let halted = false;
  for (const batch of chunks(pending, BATCH)) {
    if (halted || signal?.aborted) break;
    const parsed = await completeJson(db, env, verdictPrompt(batch));
    if (!parsed || parsed.failure) break;
    const got = readVerdicts(parsed.json);
    if (!got) break;
    const now = env.now();
    let wrote = 0;
    for (const entry of batch) {
      const hit = got.get(entry.row.id);
      if (!hit) continue;
      db.update(stories)
        .set({
          eventTitle: hit.title,
          feedVerdict: hit.verdict,
          feedReason: hit.reason,
          feedJudgedAt: now,
        })
        .where(eq(stories.id, entry.row.id))
        .run();
      wrote += 1;
    }
    if (wrote === 0) halted = true;
  }
}

function verdictPrompt(batch: Array<{ row: HomeRow; items: HomeItem[] }>): string {
  const rows = batch.map((entry) => ({
    id: entry.row.id,
    title: entry.row.title,
    summary: entry.row.summaryZh ?? entry.row.summary,
    sources: [...new Set(entry.items.map((item) => item.sourceName))],
    text: entry.items
      .map((item) => `${item.title} ${item.summary ?? ''}`)
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500),
  }));
  return `判断每条材料能不能放上首页。verdict 只能是 reliable、uncertain 或 unreliable。仿冒官网、诈骗用语、来源说不清的标 unreliable。title 是一句中文事件标题，像「某公司发布某模型」，不要照抄英文长标题。reason 是一句中文理由。\n只输出 JSON 对象 {"items":[{"id":"","verdict":"reliable","reason":"","title":""}]}\n${JSON.stringify(rows)}`;
}

function readVerdicts(json: unknown): Map<string, { verdict: string; reason: string; title: string | null }> | null {
  if (!json || typeof json !== 'object' || !Array.isArray((json as { items?: unknown }).items)) return null;
  const map = new Map<string, { verdict: string; reason: string; title: string | null }>();
  for (const item of (json as { items: unknown[] }).items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; verdict?: unknown; reason?: unknown; title?: unknown };
    if (typeof row.id !== 'string' || typeof row.verdict !== 'string' || !VERDICTS.has(row.verdict)) continue;
    const reason = typeof row.reason === 'string' ? row.reason.trim() : '';
    if (!hasHan(reason)) continue;
    const title = typeof row.title === 'string' && hasHan(row.title) ? row.title.trim().slice(0, 80) : null;
    map.set(row.id, { verdict: row.verdict, reason: reason.slice(0, 80), title });
  }
  return map;
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
