/**
 * Rule scores from plan section 2.4.
 * Hotness never calls a model.
 * Credibility rule score is blended 50/50 with a model score when one exists.
 * A blacklist or lookalike hit caps the blended score at 30.
 */

const HOUR = 60 * 60 * 1000;

export const OFFICIAL_DOMAINS = [
  'openai.com',
  'anthropic.com',
  'deepmind.google',
  'ai.google',
  'blog.google',
  'huggingface.co',
  'github.com',
  'arxiv.org',
  'nvidia.com',
  'microsoft.com',
  'meta.com',
];

const PRESS_DOMAINS = [
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'nytimes.com',
  'wsj.com',
  'theverge.com',
  'techcrunch.com',
  'nature.com',
  'science.org',
  '36kr.com',
  'jiqizhixin.com',
  'qbitai.com',
];

const BLACKLIST_DOMAINS = ['news-openai.com', 'openai-giveaway.com'];

/** Brand stems used only for lookalike detection. Official domains above are never lookalikes. */
const BRANDS = ['openai', 'chatgpt', 'anthropic', 'deepmind', 'huggingface', 'nvidia'];

const OFFICIAL_HANDLES = ['openai', 'anthropicai', 'googledeepmind', 'huggingface', 'nvidia', 'github'];

const SCAM = [/加微信/, /稳赚/, /内部渠道/, /免费领取/, /日入/, /保本/];

export interface ScoreItem {
  url: string;
  title: string;
  summary: string | null;
  sourceId: string;
  sourceType: string;
  publishedAt: Date | null;
}

export interface HotnessInput {
  items: ScoreItem[];
  updatedAt: Date;
}

export interface CredibilityRule {
  score: number;
  hardCap: boolean;
  reason: string;
}

export interface TrustList {
  domains: string[];
  handles: string[];
}

const EMPTY_TRUST: TrustList = { domains: [], handles: [] };

function listedDomain(host: string, trust: TrustList): boolean {
  return trust.domains.some((domain) => hostMatches(host, domain));
}

function listedHandle(handle: string, trust: TrustList): boolean {
  const name = handle.replace(/^@/, '').toLowerCase();
  return trust.handles.includes(name);
}

export function hotnessScore(input: HotnessInput, now: Date): number {
  const sources = new Set(input.items.map((item) => item.sourceId)).size;
  const cross = Math.min(40, Math.max(0, sources - 1) * 20);
  const volume = Math.min(25, input.items.length * 5);
  const hotList = input.items.some((item) => item.sourceType === 'weibo_hot' || item.sourceType === 'bili_hot') ? 20 : 0;
  const newest = input.items.reduce<number>((max, item) => {
    const at = item.publishedAt?.getTime() ?? input.updatedAt.getTime();
    return Math.max(max, at);
  }, input.updatedAt.getTime());
  const age = Math.max(0, now.getTime() - newest);
  const fresh = age <= 6 * HOUR ? 15 : age <= 24 * HOUR ? 8 : age <= 7 * 24 * HOUR ? 3 : 0;
  return clamp(cross + volume + hotList + fresh);
}

export function credibilityRule(items: ScoreItem[], trust: TrustList = EMPTY_TRUST): CredibilityRule {
  const hosts = items.map((item) => hostOf(item.url)).filter((host): host is string => Boolean(host));
  const handles = items.flatMap((item) => handlesOf(item.url));
  const text = items.map((item) => `${item.title}\n${item.summary ?? ''}`).join('\n');
  const trusted = hosts.some((host) => listedDomain(host, trust)) || handles.some((handle) => listedHandle(handle, trust));
  const lookalike =
    hosts.some((host) => !listedDomain(host, trust) && isLookalikeHost(host)) ||
    handles.some((handle) => !listedHandle(handle, trust) && isLookalikeHandle(handle));
  const blacklisted = hosts.some((host) => BLACKLIST_DOMAINS.some((domain) => hostMatches(host, domain)));
  const scam = SCAM.some((pattern) => pattern.test(text));
  const hardCap = lookalike || blacklisted || scam;

  const domainPts = blacklisted || lookalike ? 0 : trusted ? 40 : hosts.some(isPress) ? 28 : 12;
  const sourceCount = new Set(items.map((item) => item.sourceId)).size;
  const corroboration = sourceCount >= 3 ? 35 : sourceCount === 2 ? 20 : 0;
  const officialBonus = trusted && !lookalike ? 15 : 0;
  const content = scam ? 0 : text.trim().length >= 8 ? 10 : 0;
  const score = hardCap ? Math.min(30, domainPts + corroboration + officialBonus + content) : clamp(domainPts + corroboration + officialBonus + content);

  const bits: string[] = [];
  if (lookalike) bits.push('域名或账号仿冒官方');
  if (blacklisted) bits.push('命中域名黑名单');
  if (scam) bits.push('内容命中诈骗用语');
  if (trusted && !lookalike) bits.push('包含可信来源');
  else if (hosts.some(isPress)) bits.push('来自已知媒体域名');
  bits.push(sourceCount >= 2 ? `${sourceCount} 个来源相互印证` : '仅单一来源');
  return { score, hardCap, reason: bits.join('，') };
}

/** Final credibility. Model score is ignored when the model did not return one. */
export function blendCredibility(ruleScore: number, modelScore: number | null, hardCap: boolean): number {
  const blended = modelScore == null ? ruleScore : Math.round(ruleScore * 0.5 + modelScore * 0.5);
  return hardCap ? Math.min(30, clamp(blended)) : clamp(blended);
}

const AI_TERMS =
  /人工智能|大模型|机器学习|深度学习|神经网络|芯片|算力|机器人|量子|英伟达|生成式|语言模型|\bAI\b|\bLLM\b|\bGPT\b|OpenAI|Claude|Gemini|Anthropic|DeepMind|Hugging\s*Face|NVIDIA|ChatGPT/i;

export function locallyRelevant(items: ScoreItem[]): boolean {
  const text = items.map((item) => `${item.title}\n${item.summary ?? ''}`).join('\n');
  return AI_TERMS.test(text);
}

export function hasHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

/** Rules-only summary. Chinese text is kept; English-only text gets an explicit Chinese note. */
export function rulesSummary(title: string, summary: string | null): string {
  const text = `${title}\n${summary ?? ''}`.replace(/\s+/g, ' ').trim();
  if (hasHan(text)) return text.slice(0, 160);
  return '仅规则判断，未生成中文摘要。';
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return null;
  }
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 2 official blog, 1 known tech press (including 机器之心 and 量子位), 0 otherwise. */
export function sourceStrength(host: string): number {
  if (OFFICIAL_DOMAINS.some((domain) => hostMatches(host, domain))) return 2;
  if (PRESS_DOMAINS.some((domain) => hostMatches(host, domain))) return 1;
  return 0;
}

export function isAuthorityHost(host: string, extraDomains: readonly string[] = []): boolean {
  if (sourceStrength(host) > 0) return true;
  return extraDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isPress(host: string): boolean {
  return PRESS_DOMAINS.some((domain) => hostMatches(host, domain));
}

export function isLookalikeHost(host: string): boolean {
  if (OFFICIAL_DOMAINS.some((domain) => hostMatches(host, domain))) return false;
  if (BLACKLIST_DOMAINS.some((domain) => hostMatches(host, domain))) return true;
  const labels = host.split('.').filter((label) => label !== 'www');
  const flat = normalize(labels.join(''));
  if (BRANDS.some((brand) => flat.includes(brand))) return true;
  return labels.some((label) => BRANDS.some((brand) => editDistance(normalize(label), brand) === 1));
}

function handlesOf(url: string): string[] {
  const host = hostOf(url);
  if (!host || !(host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com'))) return [];
  try {
    const part = new URL(url).pathname.split('/').filter(Boolean)[0];
    return part ? [part.toLowerCase()] : [];
  } catch {
    return [];
  }
}

function isLookalikeHandle(handle: string): boolean {
  const name = handle.replace(/^@/, '').toLowerCase();
  if (OFFICIAL_HANDLES.includes(name)) return false;
  const flat = normalize(name);
  if (BRANDS.some((brand) => flat.includes(brand))) return true;
  return BRANDS.some((brand) => editDistance(flat, brand) === 1);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l').replace(/[^a-z]/g, '');
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 99;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i]![0] = i;
  for (let j = 0; j < cols; j++) dp[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[a.length]![b.length]!;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
