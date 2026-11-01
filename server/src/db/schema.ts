import { blob, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const jobRuns = sqliteTable('job_runs', {
  name: text('name').primaryKey(),
  lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }).notNull(),
  runCount: integer('run_count').notNull().default(0),
  lastError: text('last_error'),
});

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  autoPause: integer('auto_pause', { mode: 'boolean' }).notNull().default(false),
  lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
  lastError: text('last_error'),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp_ms' }),
  lastStatus: text('last_status'),
});

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    simhash: text('simhash'),
    embedding: blob('embedding', { mode: 'buffer' }),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('items_dedupe_idx').on(t.dedupeKey), index('items_fetched_idx').on(t.fetchedAt)],
);

export const stories = sqliteTable(
  'stories',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    summary: text('summary'),
    summaryZh: text('summary_zh'),
    relevant: integer('relevant', { mode: 'boolean' }),
    hotness: integer('hotness'),
    credibility: integer('credibility'),
    credibilityReason: text('credibility_reason'),
    aiMode: text('ai_mode'),
    scoredAt: integer('scored_at', { mode: 'timestamp_ms' }),
    eventTitle: text('event_title'),
    feedVerdict: text('feed_verdict'),
    feedReason: text('feed_reason'),
    feedJudgedAt: integer('feed_judged_at', { mode: 'timestamp_ms' }),
    /** Visible homepage source count after the last collect that listed this story. */
    homeSourceCount: integer('home_source_count'),
    /** Shown until the next collect: 新上榜, or 多了 N 个来源. */
    feedBadge: text('feed_badge'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('stories_updated_idx').on(t.updatedAt), index('stories_created_idx').on(t.createdAt)],
);

export const storyItems = sqliteTable(
  'story_items',
  {
    storyId: text('story_id').notNull(),
    itemId: text('item_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.itemId] }), index('story_items_item_idx').on(t.itemId)],
);

export const fetchCache = sqliteTable('fetch_cache', {
  cacheKey: text('cache_key').primaryKey(),
  body: text('body').notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export const crawlBudget = sqliteTable(
  'crawl_budget',
  {
    sourceId: text('source_id').notNull(),
    day: text('day').notNull(),
    used: integer('used').notNull().default(0),
    pausedUntil: integer('paused_until', { mode: 'timestamp_ms' }),
    pauseReason: text('pause_reason'),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.day] })],
);

export const searchState = sqliteTable('search_state', {
  id: text('id').primaryKey(),
  lastRequestAt: integer('last_request_at', { mode: 'timestamp_ms' }),
});

export const aiCache = sqliteTable('ai_cache', {
  cacheKey: text('cache_key').primaryKey(),
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const domainReputation = sqliteTable('domain_reputation', {
  domain: text('domain').primaryKey(),
  kind: text('kind').notNull(),
  score: integer('score').notNull(),
});

export const xAccountReputation = sqliteTable('x_account_reputation', {
  handle: text('handle').primaryKey(),
  kind: text('kind').notNull(),
});

export const interests = sqliteTable('interests', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  terms: text('terms').notNull(),
  aliases: text('aliases').notNull().default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const digestSchedule = sqliteTable('digest_schedule', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  hour: integer('hour').notNull(),
  minute: integer('minute').notNull(),
  includeHome: integer('include_home', { mode: 'boolean' }).notNull().default(true),
  includeKeywords: integer('include_keywords', { mode: 'boolean' }).notNull().default(false),
  lastSentOn: text('last_sent_on'),
  lastStatus: text('last_status'),
  lastHttpStatus: integer('last_http_status'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const digestLog = sqliteTable('digest_log', {
  id: text('id').primaryKey(),
  sentAt: integer('sent_at', { mode: 'timestamp_ms' }).notNull(),
  mode: text('mode').notNull(),
  reason: text('reason').notNull(),
  count: integer('count').notNull(),
  httpStatus: integer('http_status'),
});

export const trustedSources = sqliteTable(
  'trusted_sources',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('trusted_sources_kind_value').on(t.kind, t.value)],
);

export const claimChecks = sqliteTable(
  'claim_checks',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    ownerId: text('owner_id').notNull(),
    storyId: text('story_id').notNull(),
    status: text('status').notNull(),
    relevant: integer('relevant', { mode: 'boolean' }),
    authentic: integer('authentic', { mode: 'boolean' }),
    reason: text('reason').notNull(),
    judgedAt: integer('judged_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('claim_checks_owner').on(t.kind, t.ownerId, t.storyId)],
);

export const watches = sqliteTable('watches', {
  id: text('id').primaryKey(),
  keyword: text('keyword').notNull(),
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  /** Stories created before this time are not notified. Moves forward when a watch resumes. */
  since: integer('since', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    watchId: text('watch_id').notNull(),
    storyId: text('story_id').notNull(),
    keyword: text('keyword').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    channel: text('channel').notNull(),
    httpStatus: integer('http_status'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('notifications_watch_story_idx').on(t.watchId, t.storyId)],
);

export const usageDaily = sqliteTable(
  'usage_daily',
  {
    day: text('day').notNull(),
    sourceId: text('source_id').notNull(),
    requests: integer('requests').notNull().default(0),
    items: integer('items').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.sourceId] })],
);
