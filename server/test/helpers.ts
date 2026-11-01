import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlerUa } from '../src/collect/http.ts';
import { collectSearch } from '../src/collect/search.ts';
import { recordAttempt } from '../src/collect/store.ts';
import type { Net } from '../src/collect/types.ts';
import type { SearchEngine } from '../src/collect/catalog.ts';
import { openDb, type Db } from '../src/db/index.ts';

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export const fixture = (name: string) => readFileSync(resolve(fixtureDir, name), 'utf8');

export function textResponse(body: string, status = 200, contentType = 'text/html; charset=utf-8') {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

export function fakeClock(startIso: string) {
  let t = new Date(startIso).getTime();
  return {
    now: () => new Date(t),
    sleep: async (ms: number) => {
      t += ms;
    },
    set(iso: string) {
      t = new Date(iso).getTime();
    },
  };
}

export function testNet(clock: ReturnType<typeof fakeClock>, fetchImpl: typeof fetch, extra?: Partial<Net>): Net {
  return {
    fetch: fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
    ua: crawlerUa('test@example.com'),
    jitterMs: () => 0,
    minGapMs: 90_000,
    searchDailyCap: 80,
    searchTimeoutMs: 10_000,
    hnTimeoutMs: 5_000,
    feedTimeoutMs: 10_000,
    twitterCap: 150,
    searchQuery: '人工智能',
    ...extra,
  };
}

export async function runSearch(db: Db, engine: SearchEngine, net: Net) {
  const attempt = await collectSearch(db, engine, net);
  recordAttempt(db, attempt, net.now(), false);
  return attempt;
}

export function memoryDb() {
  return openDb(':memory:');
}
