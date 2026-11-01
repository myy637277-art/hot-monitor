import type { Db } from '../db/index.ts';
import { RSS_FEEDS } from './catalog.ts';
import { fetchUrl, isAbort, isTimeout, isTooLarge, isVerification } from './http.ts';
import { parseBilibili, parseFeed, parseGithub, parseHnItem, parseHnTop, parseTweets, parseWeibo } from './parse.ts';
import { selectXPosts } from './twitter.ts';
import { loadTrust } from '../trust.ts';
import { activePause, getUsage } from './store.ts';
import { nextShanghaiMidnight, shanghaiDate } from './time.ts';
import { failedAttempt, okAttempt, type Attempt, type Net, type RawItem } from './types.ts';

const HN_TOP = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const ARXIV =
  'https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&start=0&max_results=10';

function pauseForBlock(sourceId: string, now: Date, reason: string): Attempt {
  return failedAttempt(sourceId, 'paused', reason, {
    requests: 1,
    pauseUntil: nextShanghaiMidnight(now),
    pauseReason: reason,
  });
}

async function pull(
  net: Net,
  opts: {
    sourceId: string;
    url: string;
    timeoutMs: number;
    headers?: Record<string, string>;
    onTimeout: 'skip' | 'error';
    parse: (body: string) => RawItem[];
    /** RSS/Atom sources: an HTML page with zero entries is a failed fetch, not an empty feed. */
    expectFeed?: boolean;
    signal?: AbortSignal;
  },
): Promise<Attempt> {
  try {
    const res = await fetchUrl(net.fetch, opts.url, {
      timeoutMs: opts.timeoutMs,
      ua: net.ua,
      headers: opts.headers,
      signal: opts.signal,
    });
    if (isVerification(res.status, res.body)) return pauseForBlock(opts.sourceId, net.now(), '验证页或被拦截');
    if (!res.ok) return failedAttempt(opts.sourceId, 'error', `HTTP ${res.status}`, { requests: 1 });
    const items = opts.parse(res.body);
    if (opts.expectFeed && items.length === 0 && !/<(rss|feed)\b/i.test(res.body)) {
      return failedAttempt(opts.sourceId, 'error', '返回的不是 RSS/Atom', { requests: 1 });
    }
    return okAttempt(opts.sourceId, items);
  } catch (err) {
    if (isAbort(err)) return failedAttempt(opts.sourceId, 'skipped', '已取消');
    if (isTooLarge(err)) return failedAttempt(opts.sourceId, 'error', '响应过大', { requests: 1 });
    if (isTimeout(err)) {
      const error = opts.onTimeout === 'skip' ? '超时，已跳过本轮' : '请求超时';
      return failedAttempt(opts.sourceId, opts.onTimeout === 'skip' ? 'skipped' : 'error', error, { requests: 1 });
    }
    return failedAttempt(opts.sourceId, 'error', err instanceof Error ? err.message : '请求失败');
  }
}

export function collectWeibo(net: Net, signal?: AbortSignal): Promise<Attempt> {
  return pull(net, {
    sourceId: 'weibo_hot',
    url: 'https://weibo.com/ajax/side/hotSearch',
    timeoutMs: net.feedTimeoutMs,
    headers: { Referer: 'https://weibo.com', 'X-Requested-With': 'XMLHttpRequest' },
    onTimeout: 'error',
    parse: parseWeibo,
    signal,
  });
}

export function collectBilibili(net: Net, signal?: AbortSignal): Promise<Attempt> {
  return pull(net, {
    sourceId: 'bili_hot',
    url: 'https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1',
    timeoutMs: net.feedTimeoutMs,
    headers: { Referer: 'https://www.bilibili.com' },
    onTimeout: 'error',
    parse: parseBilibili,
    signal,
  });
}

export async function collectHn(net: Net, signal?: AbortSignal): Promise<Attempt> {
  const started = Date.now();
  const left = () => net.hnTimeoutMs - (Date.now() - started);
  try {
    if (left() <= 0) return failedAttempt('hn', 'skipped', '超时，已跳过本轮');
    const top = await fetchUrl(net.fetch, HN_TOP, { timeoutMs: Math.max(1, left()), ua: net.ua, signal });
    if (isVerification(top.status, top.body)) return pauseForBlock('hn', net.now(), '验证页或被拦截');
    if (!top.ok) return failedAttempt('hn', 'error', `HTTP ${top.status}`, { requests: 1 });
    const ids = parseHnTop(top.body);
    const found: RawItem[] = [];
    for (const id of ids) {
      if (left() <= 0) return failedAttempt('hn', 'skipped', '超时，已跳过本轮', { requests: 1 });
      const res = await fetchUrl(net.fetch, `https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        timeoutMs: Math.max(1, left()),
        ua: net.ua,
        signal,
      });
      if (!res.ok) continue;
      const item = parseHnItem(res.body);
      if (item) found.push(item);
    }
    return okAttempt('hn', found);
  } catch (err) {
    if (isAbort(err)) return failedAttempt('hn', 'skipped', '已取消');
    if (isTooLarge(err)) return failedAttempt('hn', 'error', '响应过大', { requests: 1 });
    if (isTimeout(err)) return failedAttempt('hn', 'skipped', '超时，已跳过本轮', { requests: 1 });
    return failedAttempt('hn', 'error', err instanceof Error ? err.message : '请求失败');
  }
}

export function collectRssFeed(net: Net, feed: (typeof RSS_FEEDS)[number], signal?: AbortSignal): Promise<Attempt> {
  return pull(net, {
    sourceId: feed.id,
    url: feed.feedUrl,
    timeoutMs: net.feedTimeoutMs,
    onTimeout: 'skip',
    expectFeed: true,
    parse: (body) => parseFeed(body, feed.id),
    signal,
  });
}

export function collectRss(net: Net): Promise<Attempt[]> {
  return Promise.all(RSS_FEEDS.map((feed) => collectRssFeed(net, feed)));
}

export function collectGithub(net: Net, signal?: AbortSignal): Promise<Attempt> {
  const day = shanghaiDate(new Date(net.now().getTime() - 7 * 24 * 60 * 60 * 1000));
  const q = encodeURIComponent(`created:>${day} topic:llm`);
  return pull(net, {
    sourceId: 'github',
    url: `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=10`,
    timeoutMs: net.feedTimeoutMs,
    headers: { Accept: 'application/vnd.github+json' },
    onTimeout: 'skip',
    parse: parseGithub,
    signal,
  });
}

export function collectArxiv(net: Net, signal?: AbortSignal): Promise<Attempt> {
  return pull(net, {
    sourceId: 'arxiv',
    url: ARXIV,
    timeoutMs: net.feedTimeoutMs,
    onTimeout: 'skip',
    parse: (body) => parseFeed(body, 'arxiv', 10),
    signal,
  });
}

function isCreditError(status: number, body: string): boolean {
  if (status === 401 || status === 402) return true;
  try {
    const json = JSON.parse(body) as { tweets?: unknown; message?: unknown; error?: unknown };
    if (Array.isArray(json.tweets)) return false;
    return /insufficient|not enough|quota|payment required|额度|余额/i.test(`${json.message ?? ''} ${json.error ?? ''}`);
  } catch {
    return false;
  }
}

export async function collectTwitter(
  db: Db,
  net: Net,
  query = 'AI',
  windowMs = 24 * 60 * 60 * 1000,
  signal?: AbortSignal,
): Promise<Attempt> {
  if (!net.twitterKey?.trim()) return failedAttempt('twitter', 'unconfigured', '未配置 TWITTERAPI_IO_API_KEY');
  const pause = activePause(db, 'twitter', net.now());
  if (pause) return failedAttempt('twitter', 'paused', pause.reason ?? '暂停至明天', { pauseReason: pause.reason });
  const usage = getUsage(db, 'twitter', shanghaiDate(net.now()));
  if (usage.requests >= net.twitterCap || usage.items >= net.twitterCap) {
    const reason = '已达每日上限';
    return failedAttempt('twitter', 'cap', reason, {
      pauseUntil: nextShanghaiMidnight(net.now()),
      pauseReason: reason,
    });
  }
  const since = Math.floor((net.now().getTime() - windowMs) / 1000);
  const q = query.trim() || 'AI';
  const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?query=${encodeURIComponent(`${q} since_time:${since}`)}&queryType=Latest`;
  try {
    const res = await fetchUrl(net.fetch, url, {
      timeoutMs: net.feedTimeoutMs,
      ua: net.ua,
      headers: { 'x-api-key': net.twitterKey },
      signal,
    });
    if (isCreditError(res.status, res.body)) {
      const reason = '额度已用完';
      return failedAttempt('twitter', 'paused', reason, {
        requests: 1,
        pauseUntil: nextShanghaiMidnight(net.now()),
        pauseReason: reason,
      });
    }
    if (isVerification(res.status, res.body)) return pauseForBlock('twitter', net.now(), '验证页或被拦截');
    if (!res.ok) return failedAttempt('twitter', 'error', `HTTP ${res.status}`, { requests: 1 });
    const cutoff = net.now().getTime() - windowMs;
    const drafts = parseTweets(res.body).filter((draft) => draft.item.publishedAt != null && draft.item.publishedAt.getTime() >= cutoff);
    const trusted = new Set(loadTrust(db).handles);
    const selected = await selectXPosts(net, drafts, trusted, signal);
    return {
      ...okAttempt('twitter', selected.items),
      requests: 1 + selected.lookups,
      usageItems: Math.max(drafts.length, 1),
    };
  } catch (err) {
    if (isAbort(err)) return failedAttempt('twitter', 'skipped', '已取消', { requests: 1 });
    if (isTooLarge(err)) return failedAttempt('twitter', 'error', '响应过大', { requests: 1 });
    if (isTimeout(err)) return failedAttempt('twitter', 'skipped', '超时，已跳过本轮', { requests: 1 });
    return failedAttempt('twitter', 'error', err instanceof Error ? err.message : '请求失败');
  }
}
