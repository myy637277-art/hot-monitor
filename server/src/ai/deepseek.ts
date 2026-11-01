import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { aiCache, usageDaily } from '../db/schema.ts';
import { shanghaiDate } from '../collect/time.ts';

const AI_TIMEOUT_MS = 20_000;
const COMPLETIONS = 'https://api.deepseek.com/chat/completions';
const PRIMARY_MODEL = 'deepseek-v4-flash';
const FALLBACK_MODEL = 'deepseek-flash';
const MAX_TOKENS = 4096;
export const AI_USAGE_ID = 'deepseek';

export interface AiEnv {
  apiKey?: string;
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Ignored unless it is deepseek-v4-flash or deepseek-flash. */
  model?: string;
}

export type AiFailure = 'timeout' | 'circuit' | 'bad_json' | 'http_401' | 'http_402' | 'http_429' | 'http_other';

export interface CompletionResult {
  json: unknown | null;
  failure: AiFailure | null;
  status?: number;
}

let circuitUntil = 0;
let circuitFailures = 0;
let modelNote: string | null = null;
let rememberedModel: string | null = null;

export function resetAiGuard(): void {
  circuitUntil = 0;
  circuitFailures = 0;
  modelNote = null;
  rememberedModel = null;
}

export function aiModelNote(): string | null {
  return modelNote;
}

export function circuitOpen(now: Date): boolean {
  return now.getTime() < circuitUntil;
}

/** deepseek-chat is retired. The primary id is deepseek-v4-flash. */
export function resolveChatModel(id?: string): string {
  const trimmed = id?.trim();
  if (trimmed === FALLBACK_MODEL || trimmed === PRIMARY_MODEL) return trimmed;
  return PRIMARY_MODEL;
}

export function aiUsed(db: Db, now: Date): number {
  return readUsed(db, shanghaiDate(now));
}

export function setAiUsed(db: Db, now: Date, used: number): void {
  const day = shanghaiDate(now);
  const requests = Math.max(0, Math.floor(used));
  db.insert(usageDaily)
    .values({ day, sourceId: AI_USAGE_ID, requests, items: 0 })
    .onConflictDoUpdate({ target: [usageDaily.day, usageDaily.sourceId], set: { requests } })
    .run();
}

export function hasAiKey(env: AiEnv): boolean {
  return Boolean(env.apiKey?.trim());
}

export function aiFailureText(failure: AiFailure, status?: number): string {
  switch (failure) {
    case 'timeout':
      return 'DeepSeek 超时';
    case 'circuit':
      return '模型连续失败，暂仅规则判断';
    case 'bad_json':
      return 'DeepSeek 返回无法解析';
    case 'http_401':
      return 'DeepSeek 鉴权失败';
    case 'http_402':
      return 'DeepSeek 额度不足';
    case 'http_429':
      return 'DeepSeek 限流';
    default:
      return status ? `DeepSeek HTTP ${status}` : 'DeepSeek 请求失败';
  }
}

/**
 * One chat completion. Returns null only when no key is configured.
 * Never includes the API key in an error message or log line.
 */
export async function completeJson(db: Db, env: AiEnv, user: string): Promise<CompletionResult | null> {
  if (!hasAiKey(env)) return null;
  const now = env.now();
  if (circuitOpen(now)) return { json: null, failure: 'circuit' };

  const model = rememberedModel ?? resolveChatModel(env.model);
  const cacheKey = createHash('sha256').update(`${model}\n${user}`).digest('hex');
  const cached = db.select().from(aiCache).where(eq(aiCache.cacheKey, cacheKey)).get();
  if (cached) {
    const json = parseJson(cached.body);
    return json ? { json, failure: null } : { json: null, failure: 'bad_json' };
  }

  const first = await postCompletion(db, env, model, user);
  if (first.rejectedModel && model !== FALLBACK_MODEL) {
    rememberedModel = FALLBACK_MODEL;
    modelNote = 'deepseek-v4-flash 被拒绝，已改用 deepseek-flash';
    const second = await postCompletion(db, env, FALLBACK_MODEL, user);
    if (second.json != null && second.failure == null) writeCache(db, createHash('sha256').update(`${FALLBACK_MODEL}\n${user}`).digest('hex'), second.raw, env.now());
    return { json: second.json, failure: second.failure, status: second.status };
  }
  if (first.json != null && first.failure == null) writeCache(db, cacheKey, first.raw, env.now());
  return { json: first.json, failure: first.failure, status: first.status };
}

function readUsed(db: Db, day: string): number {
  const row = db
    .select()
    .from(usageDaily)
    .where(and(eq(usageDaily.day, day), eq(usageDaily.sourceId, AI_USAGE_ID)))
    .get();
  return row?.requests ?? 0;
}

function addAiUsed(db: Db, now: Date, requests: number): void {
  const day = shanghaiDate(now);
  db.insert(usageDaily)
    .values({ day, sourceId: AI_USAGE_ID, requests, items: 0 })
    .onConflictDoUpdate({
      target: [usageDaily.day, usageDaily.sourceId],
      set: { requests: sql`${usageDaily.requests} + ${requests}` },
    })
    .run();
}

function writeCache(db: Db, cacheKey: string, body: string, now: Date): void {
  db.insert(aiCache)
    .values({ cacheKey, body, createdAt: now })
    .onConflictDoUpdate({ target: aiCache.cacheKey, set: { body, createdAt: now } })
    .run();
}

async function postCompletion(
  db: Db,
  env: AiEnv,
  model: string,
  user: string,
): Promise<{ json: unknown | null; raw: string; failure: AiFailure | null; status?: number; rejectedModel?: boolean }> {
  const payload = {
    model,
    temperature: 0,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'disabled' },
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '只输出 JSON 对象，不要输出 Markdown。摘要和理由必须使用中文。' },
      { role: 'user', content: user },
    ],
  };
  let res: Response;
  try {
    res = await env.fetch(COMPLETIONS, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (err) {
    const failure: AiFailure = abortFailure(err) ? 'timeout' : 'http_other';
    logFailure(failure);
    noteCircuit(env.now());
    return { json: null, raw: '', failure };
  }
  addAiUsed(db, env.now(), 1);
  let raw: string;
  try {
    raw = await res.text();
  } catch (err) {
    const failure: AiFailure = abortFailure(err) ? 'timeout' : 'http_other';
    logFailure(failure, res.status);
    noteCircuit(env.now());
    return { json: null, raw: '', failure, status: res.status };
  }
  if (rejectedModel(res.status, raw)) {
    logFailure('http_other', res.status);
    return { json: null, raw: '', failure: 'http_other', status: res.status, rejectedModel: true };
  }
  if (res.status === 429) {
    if (/insufficient|quota|balance|payment required|余额|额度/i.test(raw)) {
      logFailure('http_402', res.status);
      noteCircuit(env.now());
      return { json: null, raw: '', failure: 'http_402', status: res.status };
    }
    logFailure('http_429', res.status);
    noteCircuit(env.now());
    return { json: null, raw: '', failure: 'http_429', status: res.status };
  }
  if (res.status === 401 || res.status === 403) {
    logFailure('http_401', res.status);
    noteCircuit(env.now());
    return { json: null, raw: '', failure: 'http_401', status: res.status };
  }
  if (res.status === 402) {
    logFailure('http_402', res.status);
    noteCircuit(env.now());
    return { json: null, raw: '', failure: 'http_402', status: res.status };
  }
  if (!res.ok) {
    logFailure('http_other', res.status);
    noteCircuit(env.now());
    return { json: null, raw: '', failure: 'http_other', status: res.status };
  }
  circuitFailures = 0;
  const content = messageContent(raw);
  const json = parseJson(content);
  if (json == null) {
    logFailure('bad_json', res.status);
    return { json: null, raw: content, failure: 'bad_json', status: res.status };
  }
  return { json, raw: content, failure: null, status: res.status };
}

function rejectedModel(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false;
  return /model/i.test(body);
}

function abortFailure(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

function logFailure(failure: AiFailure, status?: number): void {
  console.error(`[ai] completion failed class=${failure}${status ? ` status=${status}` : ''}`);
}

function noteCircuit(now: Date): void {
  circuitFailures += 1;
  if (circuitFailures >= 3) circuitUntil = now.getTime() + 5 * 60 * 1000;
}

function messageContent(raw: string): string {
  try {
    const body = JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : raw;
  } catch {
    return raw;
  }
}

export function parseJson(text: string): unknown | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}
