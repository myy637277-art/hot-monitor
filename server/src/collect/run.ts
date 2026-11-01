import type { CollectProgress, EmbeddingNote } from '@hot/shared';
import { eq } from 'drizzle-orm';
import { judgeHomepage } from '../ai/judge.ts';
import { aiEnvForNet, readAiStatus, scoreStories } from '../ai/score.ts';
import type { Db } from '../db/index.ts';
import { sources, watches } from '../db/schema.ts';
import { interestSearchTerms, reviewInterests } from '../discover/interests.ts';
import { matchWatches } from '../notify/watch.ts';
import { getRun, recordRun } from '../scheduler.ts';
import { collectArxiv, collectBilibili, collectGithub, collectHn, collectRssFeed, collectTwitter, collectWeibo } from './adapters.ts';
import { HOME_WINDOW_MS } from './home.ts';
import { buildCatalog, DEFAULT_SEARCH_QUERY, RSS_FEEDS, SEARCH_ENGINES } from './catalog.ts';
import { embeddingLayerStatus } from './embed.ts';
import { crawlerUa } from './http.ts';
import { collectSearch } from './search.ts';
import { activePause, ensureSources, getSearchUsed, markHomeBadges, pruneStorage, recordAttempt } from './store.ts';
import { shanghaiDate } from './time.ts';
import { failedAttempt, type Attempt, type Net } from './types.ts';

export interface CollectReport {
  embedding: EmbeddingNote;
  attempts: Attempt[];
}

const emptyProgress = (): CollectProgress => ({ sourceName: null, items: 0 });

/** Resolves with `fallback` when `work` is still pending after `ms`, so one hung fetch cannot stall the rest. */
function withDeadline<T>(work: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => finish(fallback()), ms);
    work.then(
      (value) => finish(value),
      () => finish(fallback()),
    );
  });
}

export type CollectPhase = 'full' | 'main' | 'keywords';

export async function runCollect(
  db: Db,
  net: Net,
  caps: { search: number; twitter: number },
  onProgress?: (progress: CollectProgress) => void,
  phase: CollectPhase = 'full',
  signal?: AbortSignal,
): Promise<CollectReport> {
  pruneStorage(db, net.now());
  ensureSources(db, caps);
  const enabled = new Set(db.select().from(sources).all().filter((row) => row.enabled).map((row) => row.id));
  const embedding = embeddingLayerStatus();
  const useEmbedding = !embedding.skipped;
  const attempts: Attempt[] = [];
  const names = new Map(buildCatalog(caps).map((entry) => [entry.id, entry.name]));
  const active = new Set<string>();
  let items = 0;

  const publish = () => onProgress?.({ sourceName: [...active].join('、') || null, items });
  const record = (attempt: Attempt, touchSource: boolean) => {
    try {
      recordAttempt(db, attempt, net.now(), useEmbedding, { touchSource });
    } catch (err) {
      attempt.status = 'error';
      attempt.error = err instanceof Error ? err.message : '写入失败';
    }
    attempts.push(attempt);
    items += attempt.items.length;
    active.delete(names.get(attempt.sourceId) ?? attempt.sourceId);
    publish();
  };
  const timed = async (id: string, ms: number, work: (signal: AbortSignal) => Promise<Attempt>, touchSource = true) => {
    if (signal?.aborted) return;
    const name = names.get(id) ?? id;
    active.add(name);
    publish();
    const ctrl = new AbortController();
    const onParent = () => ctrl.abort();
    if (signal?.aborted) ctrl.abort();
    else signal?.addEventListener('abort', onParent, { once: true });
    const attempt = await withDeadline(work(ctrl.signal), ms, () => {
      ctrl.abort();
      return failedAttempt(id, 'error', '请求超时', { requests: 0 });
    });
    signal?.removeEventListener('abort', onParent);
    record(attempt, touchSource);
  };

  const feedLimit = net.feedTimeoutMs + 500;
  const searchLimit = net.minGapMs + 30_000 + net.searchTimeoutMs + 5_000;
  if (phase !== 'keywords') {
    const feeds: Array<[string, number, (signal: AbortSignal) => Promise<Attempt>]> = [
      ['weibo_hot', feedLimit, (child) => collectWeibo(net, child)],
      ['bili_hot', feedLimit, (child) => collectBilibili(net, child)],
      ['hn', net.hnTimeoutMs + 500, (child) => collectHn(net, child)],
      ['github', feedLimit, (child) => collectGithub(net, child)],
      ['arxiv', feedLimit, (child) => collectArxiv(net, child)],
      ['twitter', feedLimit, (child) => collectTwitter(db, net, 'AI', 24 * 60 * 60 * 1000, child)],
      ...RSS_FEEDS.map(
        (feed) => [feed.id, feedLimit, (child: AbortSignal) => collectRssFeed(net, feed, child)] as [string, number, (signal: AbortSignal) => Promise<Attempt>],
      ),
    ];
    await Promise.all(feeds.filter(([id]) => enabled.has(id)).map(([id, ms, work]) => timed(id, ms, work)));

    for (const engine of SEARCH_ENGINES) {
      if (signal?.aborted) break;
      if (!enabled.has(engine.id)) continue;
      await timed(engine.id, searchLimit, (child) => collectSearch(db, engine.engine, net, net.searchQuery, child));
    }
  }

  if (phase !== 'main' && !signal?.aborted) {
    const keywords = db.select().from(watches).where(eq(watches.paused, false)).all();
    for (const watch of keywords) {
      if (signal?.aborted) break;
      const engine = keywordEngine(db, net, enabled);
      if (engine) await timed(engine.id, searchLimit, (child) => collectSearch(db, engine.engine, net, watch.keyword, child), false);
      if (enabled.has('twitter') && net.twitterKey?.trim()) {
        await timed('twitter', feedLimit, (child) => collectTwitter(db, net, watch.keyword, HOME_WINDOW_MS, child), false);
      }
    }

    for (const term of interestSearchTerms(db)) {
      if (signal?.aborted) break;
      const engine = keywordEngine(db, net, enabled);
      if (engine) await timed(engine.id, searchLimit, (child) => collectSearch(db, engine.engine, net, term, child), false);
      if (enabled.has('twitter') && net.twitterKey?.trim()) {
        await timed('twitter', feedLimit, (child) => collectTwitter(db, net, term, HOME_WINDOW_MS, child), false);
      }
    }
  }

  return { embedding, attempts };
}

function keywordEngine(db: Db, net: Net, enabled: Set<string>) {
  const now = net.now();
  const day = shanghaiDate(now);
  for (const engine of SEARCH_ENGINES) {
    if (engine.engine === 'google') continue;
    if (!enabled.has(engine.id)) continue;
    if (activePause(db, engine.id, now)) continue;
    if (getSearchUsed(db, engine.id, day) >= net.searchDailyCap) continue;
    return engine;
  }
  return null;
}

export interface Collector {
  /** `full` is the manual round. `main` stops before keyword search. `keywords` is only that search. */
  start: (phase?: CollectPhase) => { started: boolean };
  cancel: () => void;
  running: () => boolean;
  progress: () => CollectProgress;
  /** Resolves when the current collect finishes. Resolves immediately when none is running. */
  finished: () => Promise<void>;
}

export function createCollector(db: Db, net: Net, caps: { search: number; twitter: number }): Collector {
  let current: Promise<CollectReport> | null = null;
  let progress = emptyProgress();
  let stop = () => {};
  const show = (name: string) => {
    progress = { sourceName: name, items: progress.items };
  };
  return {
    start(phase: CollectPhase = 'full') {
      if (current) return { started: false };
      progress = emptyProgress();
      const ctrl = new AbortController();
      stop = () => ctrl.abort();
      let note: string | null = null;
      current = runCollect(db, net, caps, (next) => {
        progress = next;
      }, phase, ctrl.signal)
        .then(async (report) => {
          if (ctrl.signal.aborted) return report;
          show('中文摘要');
          await scoreStories(db, aiEnvForNet(net), ctrl.signal);
          if (ctrl.signal.aborted) return report;
          await judgeHomepage(db, aiEnvForNet(net), ctrl.signal);
          markHomeBadges(db, net.now(), readAiStatus(db, aiEnvForNet(net)).enabled);
          if (phase !== 'main') {
            show('核对');
            await reviewInterests(db, aiEnvForNet(net), net.now(), ctrl.signal);
          }
          if (ctrl.signal.aborted) return report;
          show('关键词匹配');
          await matchWatches(db, {
            now: net.now(),
            serverchanKey: net.serverchanKey,
            fetchImpl: net.fetch,
            env: aiEnvForNet(net),
            signal: ctrl.signal,
          });
          const failed = report.attempts.filter((attempt) => attempt.status === 'error').length;
          const line = failed > 0 ? `${phase === 'keywords' ? '词搜失败' : '失败'} ${failed} 个来源` : null;
          if (phase === 'keywords') {
            const prev = getRun(db, 'collect')?.lastError ?? null;
            note = [prev, line].filter(Boolean).join('；') || null;
          } else {
            note = line;
          }
          return report;
        })
        .catch((err) => {
          note = ctrl.signal.aborted ? null : err instanceof Error ? err.message : '采集失败';
          if (note) console.error('[collect] failed', note);
          return { embedding: embeddingLayerStatus(), attempts: [] };
        })
        .finally(() => {
          if (!ctrl.signal.aborted) recordRun(db, 'collect', net.now(), note);
          current = null;
          progress = emptyProgress();
          stop = () => {};
        });
      return { started: true };
    },
    cancel: () => stop(),
    running: () => current !== null,
    progress: () => progress,
    finished: () => (current ? current.then(() => undefined, () => undefined) : Promise.resolve()),
  };
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function netFromEnv(env: NodeJS.ProcessEnv): Net {
  return {
    fetch: globalThis.fetch,
    now: () => new Date(),
    sleep: (ms, signal) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(timer);
          reject(abortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ua: crawlerUa(env.CRAWLER_CONTACT),
    jitterMs: () => Math.floor(Math.random() * 30_001),
    minGapMs: Math.max(90, positive(env.SEARCH_MIN_INTERVAL_SEC, 90)) * 1000,
    searchDailyCap: Math.min(80, positive(env.SEARCH_DAILY_CAP_PER_ENGINE, 80)),
    searchTimeoutMs: 10_000,
    hnTimeoutMs: 5_000,
    feedTimeoutMs: 10_000,
    twitterCap: Math.min(150, positive(env.TWITTER_DAILY_TWEET_CAP, 150)),
    twitterKey: env.TWITTERAPI_IO_API_KEY,
    deepseekKey: env.DEEPSEEK_API_KEY,
    serverchanKey: env.SERVERCHAN_SENDKEY,
    searchQuery: DEFAULT_SEARCH_QUERY,
  };
}

export function capsFromNet(net: Net): { search: number; twitter: number } {
  return { search: net.searchDailyCap, twitter: net.twitterCap };
}
