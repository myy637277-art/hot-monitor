import type { SourceType } from '@hot/shared';

export interface CatalogEntry {
  id: string;
  type: SourceType;
  name: string;
  autoPause: boolean;
  /** Daily request cap. Null means this source is not counted against a numeric cap. */
  cap: number | null;
  feedUrl?: string;
}

export const DEFAULT_SEARCH_QUERY = '人工智能';

export const SEARCH_ENGINES = [
  { id: 'search_sogou', engine: 'sogou', name: '搜狗', type: 'search_sogou' },
  { id: 'search_google', engine: 'google', name: 'Google', type: 'search_google' },
  { id: 'search_ddg', engine: 'ddg', name: 'DuckDuckGo', type: 'search_ddg' },
] as const;

export type SearchEngine = (typeof SEARCH_ENGINES)[number]['engine'];

const RSS: Array<{ id: string; name: string; feedUrl: string }> = [
  { id: 'rss:jiqizhixin', name: '机器之心', feedUrl: 'https://www.jiqizhixin.com/rss' },
  { id: 'rss:qbitai', name: '量子位', feedUrl: 'https://www.qbitai.com/feed' },
  { id: 'rss:openai', name: 'OpenAI', feedUrl: 'https://openai.com/news/rss.xml' },
  { id: 'rss:anthropic', name: 'Anthropic', feedUrl: 'https://www.anthropic.com/rss.xml' },
  { id: 'rss:google-ai', name: 'Google AI', feedUrl: 'https://blog.google/technology/ai/rss/' },
  { id: 'rss:huggingface', name: 'Hugging Face', feedUrl: 'https://huggingface.co/blog/feed.xml' },
];

export function buildCatalog(caps: { search: number; twitter: number }): CatalogEntry[] {
  return [
    { id: 'search_sogou', type: 'search_sogou', name: '搜狗', autoPause: false, cap: caps.search },
    { id: 'search_google', type: 'search_google', name: 'Google', autoPause: true, cap: caps.search },
    { id: 'search_ddg', type: 'search_ddg', name: 'DuckDuckGo', autoPause: true, cap: caps.search },
    { id: 'weibo_hot', type: 'weibo_hot', name: '微博热搜', autoPause: false, cap: null },
    { id: 'bili_hot', type: 'bili_hot', name: '哔哩哔哩热门', autoPause: false, cap: null },
    { id: 'hn', type: 'hn', name: 'Hacker News', autoPause: false, cap: null },
    ...RSS.map((feed) => ({ id: feed.id, type: 'rss' as const, name: feed.name, autoPause: false, cap: null, feedUrl: feed.feedUrl })),
    { id: 'github', type: 'github', name: 'GitHub', autoPause: false, cap: null },
    { id: 'arxiv', type: 'arxiv', name: 'arXiv', autoPause: false, cap: null },
    { id: 'twitter', type: 'twitter', name: 'X', autoPause: false, cap: caps.twitter },
  ];
}

export const RSS_FEEDS = RSS;

export function searchUrl(engine: SearchEngine, query: string): string {
  const q = encodeURIComponent(query);
  if (engine === 'sogou') return `https://www.sogou.com/web?query=${q}`;
  if (engine === 'google') return `https://www.google.com/search?q=${q}&hl=zh-CN`;
  return `https://html.duckduckgo.com/html/?q=${q}`;
}
