import { z } from 'zod';
import type { RawItem } from './types.ts';
import { biliDedupeKey, dedupeKeyForUrl, weiboDedupeKey } from './url.ts';

export interface ParsedHit {
  title: string;
  url: string;
  summary: string | null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function stripTags(value: string): string {
  const unwrapped = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(unwrapped.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function cleanHref(href: string, base: string): string | null {
  let value = decodeEntities(href).trim();
  try {
    if (value.includes('uddg=')) {
      const real = new URL(value, base).searchParams.get('uddg');
      if (real) value = real;
    } else if (value.includes('/url?') && value.includes('q=')) {
      const real = new URL(value, base).searchParams.get('q');
      if (real) value = real;
    }
    if (value.startsWith('//')) value = `https:${value}`;
    if (value.startsWith('/')) value = new URL(value, base).href;
  } catch {
    return null;
  }
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host.endsWith('google.com') && url.pathname.startsWith('/search')) return null;
    if ((host === 'sogou.com' || host.endsWith('.sogou.com')) && (url.pathname === '/web' || url.pathname === '/')) return null;
    if (host.includes('duckduckgo.com') && !url.searchParams.get('uddg')) return null;
  } catch {
    return null;
  }
  return value;
}

function pushHit(out: ParsedHit[], titleHtml: string, href: string, summaryHtml: string | null, base: string) {
  const title = stripTags(titleHtml);
  const url = cleanHref(href, base);
  if (!url || title.length < 2 || out.some((hit) => hit.url === url)) return;
  const summary = summaryHtml ? stripTags(summaryHtml) : null;
  out.push({ title, url, summary: summary || null });
}

export function parseSogou(html: string): ParsedHit[] {
  const out: ParsedHit[] = [];
  const re = /<h3[^>]*class="[^"]*vr-?title[^"]*"[^>]*>([\s\S]*?)<\/h3>/gi;
  for (const match of html.matchAll(re)) {
    const inner = match[1] ?? '';
    const link = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(inner);
    if (!link?.[1] || !link[2]) continue;
    const after = html.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 500);
    const summary = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(after)?.[1] ?? null;
    pushHit(out, link[2], link[1], summary, 'https://www.sogou.com');
    if (out.length >= 10) break;
  }
  return out;
}

export function parseGoogle(html: string): ParsedHit[] {
  const out: ParsedHit[] = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]{0,400}?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  for (const match of html.matchAll(re)) {
    if (!match[1] || !match[2]) continue;
    const after = html.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 400);
    const summary = /<div[^>]*>([\s\S]*?)<\/div>/i.exec(after)?.[1] ?? null;
    pushHit(out, match[2], match[1], summary, 'https://www.google.com');
    if (out.length >= 10) break;
  }
  return out;
}

export function parseDdg(html: string): ParsedHit[] {
  const out: ParsedHit[] = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    if (!match[1] || !match[2]) continue;
    const after = html.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 500);
    const summary = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(after)?.[1] ?? null;
    pushHit(out, match[2], match[1], summary, 'https://html.duckduckgo.com');
    if (out.length >= 10) break;
  }
  return out;
}

function blocks(xml: string, tagName: string): string[] {
  return xml.match(new RegExp(`<${tagName}[\\s>][\\s\\S]*?</${tagName}>`, 'gi')) ?? [];
}

function innerTag(block: string, name: string): string | null {
  return new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)?.[1] ?? null;
}

export function parseFeed(xml: string, sourceId: string, limit = 15): RawItem[] {
  const chunks = blocks(xml, 'item').concat(blocks(xml, 'entry'));
  const items: RawItem[] = [];
  for (const chunk of chunks) {
    const title = stripTags(innerTag(chunk, 'title') ?? '');
    const linkText = innerTag(chunk, 'link');
    const href = /<link[^>]+href="([^"]+)"/i.exec(chunk)?.[1] ?? (linkText ? stripTags(linkText) : '');
    const summary = stripTags(innerTag(chunk, 'description') ?? innerTag(chunk, 'summary') ?? innerTag(chunk, 'content') ?? '');
    const publishedRaw = stripTags(innerTag(chunk, 'pubDate') ?? innerTag(chunk, 'published') ?? innerTag(chunk, 'updated') ?? '');
    const published = publishedRaw ? new Date(publishedRaw) : null;
    if (!title || !/^https?:\/\//i.test(href)) continue;
    items.push({
      sourceId,
      title,
      url: href,
      summary: summary || null,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
      dedupeKey: dedupeKeyForUrl(href),
    });
    if (items.length >= limit) break;
  }
  return items;
}

const weiboSchema = z.object({
  data: z
    .object({
      realtime: z
        .array(
          z.object({
            word: z.string(),
            url: z.string().optional(),
            note: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export function parseWeibo(body: string): RawItem[] {
  const parsed = weiboSchema.parse(JSON.parse(body));
  return (parsed.data?.realtime ?? []).slice(0, 20).map((row) => {
    const url = row.url
      ? row.url.startsWith('http')
        ? row.url
        : `https://s.weibo.com${row.url.startsWith('/') ? '' : '/'}${row.url}`
      : `https://s.weibo.com/weibo?q=${encodeURIComponent(row.word)}`;
    return {
      sourceId: 'weibo_hot',
      title: row.word,
      url,
      summary: row.note ?? null,
      publishedAt: null,
      dedupeKey: weiboDedupeKey(row.word),
    };
  });
}

const biliSchema = z.object({
  code: z.number().optional(),
  data: z
    .object({
      list: z
        .array(
          z.object({
            bvid: z.string(),
            title: z.string(),
            desc: z.string().optional(),
            short_link_v2: z.string().optional(),
            pubdate: z.number().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export function parseBilibili(body: string): RawItem[] {
  const parsed = biliSchema.parse(JSON.parse(body));
  if (parsed.code != null && parsed.code !== 0) throw new Error(`bilibili code ${parsed.code}`);
  return (parsed.data?.list ?? []).slice(0, 20).map((row) => ({
    sourceId: 'bili_hot',
    title: row.title,
    url: row.short_link_v2 && row.short_link_v2.startsWith('http') ? row.short_link_v2 : `https://www.bilibili.com/video/${row.bvid}`,
    summary: row.desc || null,
    publishedAt: row.pubdate ? new Date(row.pubdate * 1000) : null,
    dedupeKey: biliDedupeKey(row.bvid),
  }));
}

const hnItemSchema = z.object({
  id: z.number(),
  type: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  time: z.number().optional(),
});

export function parseHnTop(body: string): number[] {
  const ids = z.array(z.number()).parse(JSON.parse(body));
  return ids.slice(0, 10);
}

export function parseHnItem(body: string): RawItem | null {
  const row = hnItemSchema.parse(JSON.parse(body));
  if (!row.title || row.type === 'comment' || row.type === 'job') return null;
  const url = row.url && /^https?:\/\//i.test(row.url) ? row.url : `https://news.ycombinator.com/item?id=${row.id}`;
  return {
    sourceId: 'hn',
    title: row.title,
    url,
    summary: null,
    publishedAt: row.time ? new Date(row.time * 1000) : null,
    dedupeKey: dedupeKeyForUrl(url),
  };
}

const githubSchema = z.object({
  items: z.array(
    z.object({
      html_url: z.string(),
      full_name: z.string(),
      description: z.string().nullable().optional(),
      pushed_at: z.string().optional(),
    }),
  ),
});

export function parseGithub(body: string): RawItem[] {
  const parsed = githubSchema.parse(JSON.parse(body));
  return parsed.items.slice(0, 10).map((row) => {
    const published = row.pushed_at ? new Date(row.pushed_at) : null;
    return {
      sourceId: 'github',
      title: row.full_name,
      url: row.html_url,
      summary: row.description ?? null,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
      dedupeKey: dedupeKeyForUrl(row.html_url),
    };
  });
}

const countSchema = z.union([z.number(), z.string()]).nullish();

const tweetSchema = z.object({
  tweets: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]),
        text: z.string().optional(),
        url: z.string().optional(),
        createdAt: z.string().optional(),
        viewCount: countSchema,
        author: z
          .object({
            userName: z.string().nullish(),
            followers: countSchema,
          })
          .nullish(),
      }),
    )
    .optional(),
  message: z.string().optional(),
  error: z.union([z.string(), z.number()]).optional(),
});

export interface ParsedTweet {
  item: RawItem;
  handle: string | null;
  followers: number | null;
  viewCount: number | null;
}

function finiteCount(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function handleFromTweet(url: string, userName: string | null | undefined): string | null {
  const named = userName?.trim().replace(/^@/, '');
  if (named) return named;
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[1]?.toLowerCase() === 'status' && parts[0] && parts[0].toLowerCase() !== 'i') return parts[0];
  } catch {
    return null;
  }
  return null;
}

export function parseTweets(body: string): ParsedTweet[] {
  const parsed = tweetSchema.parse(JSON.parse(body));
  return (parsed.tweets ?? []).map((row) => {
    const id = String(row.id);
    const url = row.url && /^https?:\/\//i.test(row.url) ? row.url : `https://x.com/i/status/${id}`;
    const published = row.createdAt ? new Date(row.createdAt) : null;
    return {
      item: {
        sourceId: 'twitter',
        title: (row.text ?? '').slice(0, 180) || `tweet ${id}`,
        url,
        summary: row.text ?? null,
        publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
        dedupeKey: `twitter:${id}`,
      },
      handle: handleFromTweet(url, row.author?.userName),
      followers: finiteCount(row.author?.followers),
      viewCount: finiteCount(row.viewCount),
    };
  });
}

export function hitsToItems(sourceId: string, hits: ParsedHit[]): RawItem[] {
  return hits.map((hit) => ({
    sourceId,
    title: hit.title,
    url: hit.url,
    summary: hit.summary,
    publishedAt: null,
    dedupeKey: dedupeKeyForUrl(hit.url),
  }));
}
