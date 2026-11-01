export type IntegrationName = 'deepseek' | 'twitterapiIo' | 'serverchan';

export type SourceType =
  | 'rss'
  | 'hn'
  | 'github'
  | 'arxiv'
  | 'search_sogou'
  | 'search_google'
  | 'search_ddg'
  | 'weibo_hot'
  | 'bili_hot'
  | 'twitter';

export type SourceRunStatus = 'idle' | 'ok' | 'paused' | 'skipped' | 'error' | 'unconfigured' | 'disabled';

export interface EmbeddingNote {
  skipped: boolean;
  /** Set when the embedding dedup layer did not run. */
  reason: string | null;
}

export interface HotStory {
  id: string;
  title: string;
  summary: string | null;
  /** Chinese summary. English sources are summarized in Chinese too. */
  summaryZh: string | null;
  hotness: number | null;
  credibility: number | null;
  credibilityReason: string | null;
  /** `rules` means no model was used for this story. */
  aiMode: 'model' | 'rules' | null;
  updatedAt: string;
  /** Newest item publish time inside the homepage window. */
  publishedAt: string | null;
  /** Chinese event headline. Falls back to the stored title when absent. */
  eventTitle: string | null;
  /** One Chinese reason from the homepage judgment. */
  feedReason: string | null;
  /** Homepage judgment. Null when this card was not judged. */
  feedVerdict: 'reliable' | 'uncertain' | null;
  /** Best visible source: 2 official domain, 1 known press, 0 otherwise. */
  sourceStrength: number;
  /** Shown when the model cannot be called and the story only passed the authority rules. */
  unverified: boolean;
  /** Set after a collect when the story is new on the homepage or gained sources. */
  feedBadge: string | null;
  sources: Array<{ id: string; name: string; type: SourceType; url: string | null }>;
}

export interface AiStatus {
  enabled: boolean;
  used: number;
  /** Null means scoring is not stopped by a local request count. */
  cap: number | null;
  /** Why the pipeline is rules-only. Null while model calls are still allowed. */
  reason: string | null;
  /** Set when a configured model id was replaced with the free router. */
  modelNote: string | null;
  scoring: boolean;
}

export interface StoriesResponse {
  ok: true;
  embedding: EmbeddingNote;
  ai: AiStatus;
  stories: HotStory[];
}

export interface SourceStatus {
  id: string;
  type: SourceType;
  name: string;
  enabled: boolean;
  status: SourceRunStatus;
  statusText: string;
  pauseReason: string | null;
  pausedUntil: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  usage: { requests: number; items: number; cap: number | null };
}

export interface CollectProgress {
  /** Source in flight, or several names while feeds run together. Null before the first one starts. */
  sourceName: string | null;
  items: number;
}

export interface SourcesResponse {
  ok: true;
  day: string;
  running: boolean;
  embedding: EmbeddingNote;
  ai: AiStatus;
  progress: CollectProgress;
  /** When the last collect finished. Null before the first one. */
  lastCollectAt: string | null;
  /** Set when that collect recorded a failure note. */
  lastCollectNote: string | null;
  sources: SourceStatus[];
}

export interface CollectResponse {
  ok: true;
  running: boolean;
  started: boolean;
}

export interface Watch {
  id: string;
  keyword: string;
  paused: boolean;
  createdAt: string;
}

export type NotifyChannel = 'sent' | 'skipped' | 'failed';

export interface WatchNotification {
  id: string;
  watchId: string;
  storyId: string;
  keyword: string;
  title: string;
  body: string;
  channel: NotifyChannel;
  httpStatus: number | null;
  createdAt: string;
  /** First http(s) source URL for this story. Null when none is stored. */
  url: string | null;
}

export interface ClaimHold {
  storyId: string;
  label: string;
  title: string;
  reason: string;
  status: 'reject' | 'pending';
  url: string | null;
}

export interface WatchesResponse {
  ok: true;
  watches: Watch[];
  notifications: WatchNotification[];
  /** String matches that are not final results: rejected, or still waiting on the model. */
  holds: ClaimHold[];
  /** Set after a collect whose active keywords matched nothing. */
  matchNote: string | null;
}

export interface HealthResponse {
  ok: true;
  serverTime: string;
  uptimeSec: number;
  heartbeat: {
    lastAt: string | null;
    count: number;
    intervalSec: number;
  };
  /** Only whether each integration's env vars are set; never the values. */
  integrations: Record<IntegrationName, boolean>;
}

export type DigestReason = 'sent' | 'empty' | 'unconfigured' | 'failed' | 'skipped';

export interface DigestSettings {
  enabled: boolean;
  /** Hour in Asia/Shanghai, 0–23. */
  hour: number;
  /** Minute in Asia/Shanghai, 0–59. */
  minute: number;
  includeHome: boolean;
  includeKeywords: boolean;
  /** Shanghai calendar day of the last successful scheduled send. */
  lastSentOn: string | null;
  lastStatus: DigestReason | null;
  lastHttpStatus: number | null;
}

export interface DigestLog {
  id: string;
  sentAt: string;
  mode: 'scheduled' | 'manual';
  reason: DigestReason;
  count: number;
  httpStatus: number | null;
}

export interface DigestResponse {
  ok: true;
  digest: DigestSettings;
  logs: DigestLog[];
}

export type TrustKind = 'domain' | 'handle';

export interface TrustedSource {
  id: string;
  kind: TrustKind;
  value: string;
  createdAt: string;
}

export interface TrustedResponse {
  ok: true;
  sources: TrustedSource[];
}

export interface DigestSendResponse {
  ok: true;
  reason: DigestReason;
  count: number;
  httpStatus: number | null;
}

export interface Interest {
  id: string;
  label: string;
  terms: string[];
  createdAt: string;
}

export interface DiscoverStory extends HotStory {
  interestLabel: string;
}

export interface DiscoverResponse {
  ok: true;
  interests: Interest[];
  stories: DiscoverStory[];
  holds: ClaimHold[];
}
