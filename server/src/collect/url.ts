const TRACKING = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'si',
  'feature',
  'ref',
  'ref_src',
  'cmpid',
  'ocid',
  'spm',
  'spm_id_from',
]);

function isTracking(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith('utm_') || k.startsWith('spm') || TRACKING.has(k);
}

export function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol === 'http:') url.protocol = 'https:';
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.port = '';
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTracking(key))
    .sort(([a], [b]) => a.localeCompare(b) || 0);
  url.search = '';
  for (const [key, value] of params) url.searchParams.append(key, value);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

export function twitterIdFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/(^|\.)((twitter|x)\.com)$/i.test(url.hostname)) return null;
    return url.pathname.match(/\/status\/(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function biliIdFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/(^|\.)bilibili\.com$/i.test(url.hostname)) return null;
    return url.pathname.match(/BV[0-9A-Za-z]{10}/)?.[0] ?? null;
  } catch {
    return null;
  }
}

export function twitterDedupeKey(id: string): string {
  return `twitter:${id}`;
}

export function weiboDedupeKey(word: string): string {
  return `weibo:${word.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export function biliDedupeKey(bvid: string): string {
  return `bili:${bvid}`;
}

/** URL layer: tweets by id, Bilibili by BV, everything else by the canonical URL. */
export function dedupeKeyForUrl(raw: string): string {
  const tweet = twitterIdFromUrl(raw);
  if (tweet) return twitterDedupeKey(tweet);
  const bv = biliIdFromUrl(raw);
  if (bv) return biliDedupeKey(bv);
  return `url:${canonicalUrl(raw)}`;
}
