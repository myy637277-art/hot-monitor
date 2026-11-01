import type { Db } from '../db/index.ts';
import { SEARCH_ENGINES, searchUrl, type SearchEngine } from './catalog.ts';
import { fetchUrl, isAbort, isTimeout, isTooLarge, isVerification } from './http.ts';
import { filterKeywordHits } from './home.ts';
import { hitsToItems, parseDdg, parseGoogle, parseSogou } from './parse.ts';
import { activePause, getCachedBody, getSearchUsed, setCachedBody, setLastSearchAt, getLastSearchAt } from './store.ts';
import { loadTrust } from '../trust.ts';
import { nextShanghaiMidnight, shanghaiDate } from './time.ts';
import { failedAttempt, okAttempt, type Attempt, type Net } from './types.ts';

const parsers = { sogou: parseSogou, google: parseGoogle, ddg: parseDdg };

/**
 * One global queue for every search engine.
 * Requests are serial, at least `minGapMs` apart (plus jitter), capped per engine per day.
 * No captcha solving, proxy rotation, or browser-fingerprint spoofing — only an identifiable User-Agent.
 */
export async function collectSearch(
  db: Db,
  engine: SearchEngine,
  net: Net,
  query = net.searchQuery,
  signal?: AbortSignal,
): Promise<Attempt> {
  const meta = SEARCH_ENGINES.find((entry) => entry.engine === engine);
  if (!meta) throw new Error(`unknown engine ${engine}`);
  const q = query.trim() || net.searchQuery;
  const now = net.now();
  const extraDomains = loadTrust(db).domains;
  const pause = activePause(db, meta.id, now);
  if (pause) return failedAttempt(meta.id, 'paused', pause.reason ?? '暂停至明天', { pauseReason: pause.reason });

  const dayUsed = getSearchUsed(db, meta.id, shanghaiDate(now));
  if (dayUsed >= net.searchDailyCap) {
    const reason = '已达每日上限';
    return failedAttempt(meta.id, 'cap', reason, {
      pauseUntil: nextShanghaiMidnight(now),
      pauseReason: reason,
    });
  }

  const cacheKey = `search:${engine}:${q.toLowerCase()}`;
  const cached = getCachedBody(db, cacheKey, now);
  if (cached) {
    if (isVerification(200, cached)) {
      const reason = '验证页或被拦截';
      return failedAttempt(meta.id, 'paused', reason, {
        pauseUntil: nextShanghaiMidnight(now),
        pauseReason: reason,
      });
    }
    const replay = okAttempt(meta.id, finishHits(hitsToItems(meta.id, parsers[engine](cached)), q, net, extraDomains), 0);
    replay.usageItems = 0;
    return replay;
  }

  if (signal?.aborted) return failedAttempt(meta.id, 'skipped', '已取消');
  const last = getLastSearchAt(db);
  const need = net.minGapMs + Math.max(0, net.jitterMs());
  if (last) {
    const elapsed = now.getTime() - last.getTime();
    if (elapsed < need) {
      try {
        await net.sleep(need - elapsed, signal);
      } catch {
        if (signal?.aborted) return failedAttempt(meta.id, 'skipped', '已取消');
        return failedAttempt(meta.id, 'error', '请求失败');
      }
    }
  }
  if (signal?.aborted) return failedAttempt(meta.id, 'skipped', '已取消');
  const sentAt = net.now();
  setLastSearchAt(db, sentAt);

  const until = nextShanghaiMidnight(sentAt);
  try {
    const res = await fetchUrl(net.fetch, searchUrl(engine, q), {
      timeoutMs: net.searchTimeoutMs,
      ua: net.ua,
      signal,
    });
    if (isVerification(res.status, res.body)) {
      return failedAttempt(meta.id, 'paused', '验证页或被拦截', {
        requests: 1,
        pauseUntil: until,
        pauseReason: '验证页或被拦截',
      });
    }
    if (!res.ok) {
      const reason = `请求失败 HTTP ${res.status}`;
      return failedAttempt(meta.id, 'paused', reason, { requests: 1, pauseUntil: until, pauseReason: reason });
    }
    setCachedBody(db, cacheKey, res.body, sentAt);
    return okAttempt(meta.id, finishHits(hitsToItems(meta.id, parsers[engine](res.body)), q, net, extraDomains));
  } catch (err) {
    if (isAbort(err)) return failedAttempt(meta.id, 'skipped', '已取消', { requests: 1 });
    if (isTooLarge(err)) return failedAttempt(meta.id, 'error', '响应过大', { requests: 1 });
    const reason = isTimeout(err) ? '请求超时' : '请求失败';
    return failedAttempt(meta.id, 'paused', reason, { requests: 1, pauseUntil: until, pauseReason: reason });
  }
}

function finishHits(
  items: ReturnType<typeof hitsToItems>,
  query: string,
  net: Net,
  extraDomains: readonly string[],
): ReturnType<typeof hitsToItems> {
  const keyword = query.trim().toLowerCase() !== net.searchQuery.trim().toLowerCase();
  return keyword ? filterKeywordHits(items, net.now(), extraDomains) : items;
}
