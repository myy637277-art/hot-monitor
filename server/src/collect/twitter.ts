import { fetchUrl } from './http.ts';
import type { ParsedTweet } from './parse.ts';
import type { Net, RawItem } from './types.ts';

export const X_MIN_VIEWS = 1000;
export const X_MIN_FOLLOWERS = 100_000;

/**
 * Org accounts for this CS/AI monitor. Blue-check is not enough.
 * OpenAI's published X accounts, plus the orgs already in the source list
 * (Anthropic, Google / DeepMind, Hugging Face, NVIDIA, Microsoft, GitHub)
 * and DeepSeek, xAI, Meta AI.
 */
export const OFFICIAL_X_HANDLES = new Set([
  'openai',
  'openaidevs',
  'chatgptapp',
  'openainewsroom',
  'deepseek_ai',
  'anthropicai',
  'google',
  'googleai',
  'googledeepmind',
  'xai',
  'aiatmeta',
  'huggingface',
  'nvidia',
  'nvidiaai',
  'microsoft',
  'microsoftai',
  'github',
]);

export function normalizeXHandle(handle: string | null | undefined): string | null {
  if (!handle) return null;
  const name = handle.trim().replace(/^@/, '').toLowerCase();
  return name || null;
}

export function isOfficialXHandle(handle: string | null | undefined): boolean {
  return isKnownHandle(handle);
}

function isKnownHandle(handle: string | null | undefined, trusted?: ReadonlySet<string>): boolean {
  const name = normalizeXHandle(handle);
  if (!name) return false;
  return trusted ? trusted.has(name) : OFFICIAL_X_HANDLES.has(name);
}

/** Official account, or a non-official account with enough followers. Missing views drop everyone except official accounts. */
export function keepXPost(
  post: { handle: string | null; followers: number | null; viewCount: number | null },
  trusted?: ReadonlySet<string>,
): boolean {
  if (post.viewCount != null && post.viewCount < X_MIN_VIEWS) return false;
  const official = isKnownHandle(post.handle, trusted);
  if (post.viewCount == null && !official) return false;
  if (official) return true;
  return post.followers != null && post.followers >= X_MIN_FOLLOWERS;
}

async function lookupFollowers(net: Net, userName: string, signal?: AbortSignal): Promise<number | null> {
  if (!net.twitterKey?.trim()) return null;
  const url = `https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(userName)}`;
  try {
    const res = await fetchUrl(net.fetch, url, {
      timeoutMs: net.feedTimeoutMs,
      ua: net.ua,
      headers: { 'x-api-key': net.twitterKey },
      signal,
    });
    if (!res.ok) return null;
    const json = JSON.parse(res.body) as { data?: { followers?: unknown } };
    const followers = json.data?.followers;
    return typeof followers === 'number' && Number.isFinite(followers) ? followers : null;
  } catch {
    return null;
  }
}

/** Drop posts before they are stored. One user lookup per handle when the tweet payload has no follower count. */
export async function selectXPosts(
  net: Net,
  posts: ParsedTweet[],
  trusted?: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<{ items: RawItem[]; lookups: number }> {
  const resolved = posts.map((post) => ({ ...post }));
  const missing = new Map<string, number[]>();
  resolved.forEach((post, index) => {
    if (post.followers != null || isKnownHandle(post.handle, trusted)) return;
    if (post.viewCount == null || post.viewCount < X_MIN_VIEWS) return;
    const handle = normalizeXHandle(post.handle);
    if (!handle) return;
    const indexes = missing.get(handle) ?? [];
    indexes.push(index);
    missing.set(handle, indexes);
  });

  let lookups = 0;
  for (const [handle, indexes] of missing) {
    if (signal?.aborted) break;
    lookups += 1;
    const followers = await lookupFollowers(net, handle, signal);
    for (const index of indexes) {
      const post = resolved[index];
      if (post) post.followers = followers;
    }
  }

  return { items: resolved.filter((post) => keepXPost(post, trusted)).map((post) => post.item), lookups };
}
