import { completeJson, hasAiKey, type AiEnv } from '../ai/deepseek.ts';
import type { Db } from '../db/index.ts';

/** Per typed term. Collect searches the typed terms only, so this cap keeps that work from growing with aliases. */
export const ALIAS_CAP = 4;

export async function aliasesForTerms(db: Db, env: AiEnv, terms: string[]): Promise<Record<string, string[]>> {
  try {
    if (!hasAiKey(env) || terms.length === 0) return {};
    const parsed = await completeJson(db, env, aliasPrompt(terms));
    if (!parsed?.json) return {};
    return aliasesFromModel(parsed.json, terms);
  } catch {
    console.error('[discover] alias expansion failed');
    return {};
  }
}

export function aliasesFromModel(json: unknown, terms: string[]): Record<string, string[]> {
  if (!json || typeof json !== 'object' || !Array.isArray((json as { items?: unknown }).items)) return {};
  const byTerm = new Map(terms.map((term) => [term.toLowerCase(), term]));
  const bag: Record<string, string[]> = {};
  for (const item of (json as { items: unknown[] }).items) {
    if (!item || typeof item !== 'object') continue;
    const termRaw = (item as { term?: unknown }).term;
    const aliases = (item as { aliases?: unknown }).aliases;
    if (typeof termRaw !== 'string' || !Array.isArray(aliases)) continue;
    const term = byTerm.get(termRaw.trim().toLowerCase());
    if (!term) continue;
    bag[term] = aliases.filter((alias): alias is string => typeof alias === 'string');
  }
  return clipAliasMap(bag, terms);
}

export function clipAliasMap(raw: Record<string, string[]>, terms: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const term of terms) {
    const seen = new Set<string>([term.toLowerCase()]);
    const kept: string[] = [];
    for (const alias of raw[term] ?? []) {
      const text = alias.trim();
      if (!text || text.length > 40) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(text);
      if (kept.length === ALIAS_CAP) break;
    }
    if (kept.length > 0) out[term] = kept;
  }
  return out;
}

function aliasPrompt(terms: string[]): string {
  return `为每个搜索词给出最多 ${ALIAS_CAP} 个清晰相关的中文和英文说法，用来匹配同一话题的标题。英文说法保留英文。不要解释。只输出 JSON 对象 {"items":[{"term":"","aliases":["",""]}]}
词：${JSON.stringify(terms)}`;
}
