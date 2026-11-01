import type { CollectResponse, DigestResponse, DigestSendResponse, DiscoverResponse, HealthResponse, SourcesResponse, StoriesResponse, TrustedResponse, WatchesResponse } from '@hot/shared';
import express from 'express';
import { z } from 'zod';
import { aiEnvForNet, aiEnvFromProcess, readAiStatus } from './ai/score.ts';
import { embeddingLayerStatus } from './collect/embed.ts';
import { capsFromNet, type Collector } from './collect/run.ts';
import { ensureSources, listHomepage, listSourceStatus, setSourceEnabled } from './collect/store.ts';
import type { Net } from './collect/types.ts';
import { integrationStatus } from './config.ts';
import type { Db } from './db/index.ts';
import { aliasesForTerms } from './discover/aliases.ts';
import { createInterest, deleteInterest, listDiscoveryFeed, listInterests, peekInterest, updateInterest } from './discover/interests.ts';
import { deliverDigest, listDigestLogs, readDigest, saveDigest } from './notify/digest.ts';
import { createWatch, deleteWatch, listWatchState, setWatchPaused } from './notify/watch.ts';
import { addTrusted, deleteTrusted, listTrusted } from './trust.ts';

import { getRun, HEARTBEAT_JOB } from './scheduler.ts';

const limitSchema = z.coerce.number().int().min(1).max(100);
const keywordSchema = z.object({ keyword: z.string().trim().min(1).max(40) });
const pauseSchema = z.object({ paused: z.boolean() });
const interestSchema = z.object({
  label: z.string().trim().min(1).max(40),
  terms: z.array(z.string().trim().min(1).max(40)).min(1).max(5),
});
const digestSchema = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  includeHome: z.boolean(),
  includeKeywords: z.boolean(),
});
const enabledSchema = z.object({ enabled: z.boolean() });
const trustSchema = z.object({
  kind: z.enum(['domain', 'handle']),
  value: z.string().trim().min(1).max(80),
});

function routeId(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function createApp(
  db: Db,
  opts: { heartbeatSec: number; collector?: Collector; net?: Net; onDigestChange?: () => void },
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  const embedding = () => embeddingLayerStatus();
  const caps = () => (opts.net ? capsFromNet(opts.net) : { search: 80, twitter: 150 });
  const ai = () => readAiStatus(db, opts.net ? aiEnvForNet(opts.net) : aiEnvFromProcess(process.env));

  app.get('/api/v1/health', (_req, res) => {
    const run = getRun(db, HEARTBEAT_JOB);
    const body: HealthResponse = {
      ok: true,
      serverTime: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      heartbeat: {
        lastAt: run ? run.lastRunAt.toISOString() : null,
        count: run?.runCount ?? 0,
        intervalSec: opts.heartbeatSec,
      },
      integrations: integrationStatus(),
    };
    res.json(body);
  });

  app.get('/api/v1/stories', (req, res) => {
    const parsed = limitSchema.safeParse(req.query.limit ?? 30);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    const env = opts.net ? aiEnvForNet(opts.net) : aiEnvFromProcess(process.env);
    const now = opts.net?.now() ?? new Date();
    const body: StoriesResponse = {
      ok: true,
      embedding: embedding(),
      ai: ai(),
      stories: listHomepage(db, parsed.data, now, readAiStatus(db, env).enabled),
    };
    res.json(body);
  });

  app.get('/api/v1/sources', (_req, res) => {
    const now = opts.net?.now() ?? new Date();
    const twitterConfigured = Boolean((opts.net?.twitterKey ?? process.env.TWITTERAPI_IO_API_KEY)?.trim());
    const payload = listSourceStatus(db, now, {
      twitterConfigured,
      caps: caps(),
      running: opts.collector?.running() ?? false,
      embedding: embedding(),
    });
    const body: SourcesResponse = {
      ok: true,
      ...payload,
      ai: ai(),
      progress: opts.collector?.progress() ?? { sourceName: null, items: 0 },
    };
    res.json(body);
  });

  app.get('/api/v1/watches', (_req, res) => {
    const body: WatchesResponse = { ok: true, ...listWatchState(db) };
    res.json(body);
  });

  app.post('/api/v1/watches', (req, res) => {
    const parsed = keywordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    const result = createWatch(db, parsed.data.keyword, new Date());
    if (!result.ok) {
      res.status(409).json(result);
      return;
    }
    res.status(201).json(result);
  });

  app.patch('/api/v1/watches/:id', (req, res) => {
    const parsed = pauseSchema.safeParse(req.body);
    const id = z.string().uuid().safeParse(routeId(req.params.id));
    if (!parsed.success || !id.success) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    if (!setWatchPaused(db, id.data, parsed.data.paused, new Date())) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  });

  app.delete('/api/v1/watches/:id', (req, res) => {
    const id = z.string().uuid().safeParse(routeId(req.params.id));
    if (!id.success || !deleteWatch(db, id.data)) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/v1/digest', (_req, res) => {
    const body: DigestResponse = { ok: true, digest: readDigest(db, opts.net?.now() ?? new Date()), logs: listDigestLogs(db) };
    res.json(body);
  });

  app.put('/api/v1/digest', (req, res) => {
    const parsed = digestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    const digest = saveDigest(db, parsed.data, opts.net?.now() ?? new Date());
    opts.onDigestChange?.();
    const body: DigestResponse = { ok: true, digest, logs: listDigestLogs(db) };
    res.json(body);
  });

  app.post('/api/v1/digest/send', (_req, res) => {
    const env = opts.net ? aiEnvForNet(opts.net) : aiEnvFromProcess(process.env);
    void deliverDigest(db, {
      now: opts.net?.now() ?? new Date(),
      modelOpen: readAiStatus(db, env).enabled,
      serverchanKey: opts.net ? opts.net.serverchanKey : process.env.SERVERCHAN_SENDKEY,
      fetchImpl: opts.net?.fetch ?? globalThis.fetch,
      mode: 'manual',
    }).then(
      (result) => {
        if (res.headersSent) return;
        const body: DigestSendResponse = { ok: true, ...result };
        res.json(body);
      },
      () => {
        if (!res.headersSent) res.status(500).json({ ok: false, error: 'send_failed' });
      },
    );
  });

  app.get('/api/v1/discover', (_req, res) => {
    const now = opts.net?.now() ?? new Date();
    const found = listDiscoveryFeed(db, now);
    const body: DiscoverResponse = { ok: true, interests: listInterests(db), stories: found.stories, holds: found.holds };
    res.json(body);
  });

  const aiEnv = () => (opts.net ? aiEnvForNet(opts.net) : aiEnvFromProcess(process.env));

  app.post('/api/v1/discover', async (req, res) => {
    const parsed = interestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    const aliases = await aliasesForTerms(db, aiEnv(), parsed.data.terms);
    const result = createInterest(db, parsed.data.label, parsed.data.terms, opts.net?.now() ?? new Date(), aliases);
    if (!result.ok) {
      res.status(result.error === 'duplicate' ? 409 : 400).json(result);
      return;
    }
    res.status(201).json(result);
  });

  app.patch('/api/v1/discover/:id', async (req, res) => {
    const parsed = interestSchema.safeParse(req.body);
    const id = z.string().uuid().safeParse(routeId(req.params.id));
    if (!parsed.success || !id.success) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    const current = peekInterest(db, id.data);
    if (!current) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    const sameTerms =
      current.terms.length === parsed.data.terms.length &&
      current.terms.every((term, index) => term.toLowerCase() === parsed.data.terms[index]?.toLowerCase());
    const aliases = sameTerms ? current.aliases : await aliasesForTerms(db, aiEnv(), parsed.data.terms);
    const result = updateInterest(db, id.data, parsed.data.label, parsed.data.terms, aliases);
    if (!result.ok) {
      res.status(result.error === 'missing' ? 404 : result.error === 'duplicate' ? 409 : 400).json(
        result.error === 'missing' ? { ok: false, error: 'not_found' } : result,
      );
      return;
    }
    res.json(result);
  });

  app.delete('/api/v1/discover/:id', (req, res) => {
    const id = z.string().uuid().safeParse(routeId(req.params.id));
    if (!id.success || !deleteInterest(db, id.data)) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  });

  app.patch('/api/v1/sources/:id', (req, res) => {
    const parsed = enabledSchema.safeParse(req.body);
    const id = z.string().trim().min(1).max(80).safeParse(routeId(req.params.id));
    if (!parsed.success || !id.success) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    ensureSources(db, caps());
    if (!setSourceEnabled(db, id.data, parsed.data.enabled)) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/v1/trusted', (_req, res) => {
    const body: TrustedResponse = { ok: true, sources: listTrusted(db) };
    res.json(body);
  });

  app.post('/api/v1/trusted', (req, res) => {
    const parsed = trustSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    const result = addTrusted(db, parsed.data.kind, parsed.data.value, opts.net?.now() ?? new Date());
    if (!result.ok) {
      res.status(result.error === 'duplicate' ? 409 : 400).json(result);
      return;
    }
    res.status(201).json(result);
  });

  app.delete('/api/v1/trusted/:id', (req, res) => {
    const id = z.string().uuid().safeParse(routeId(req.params.id));
    if (!id.success || !deleteTrusted(db, id.data)) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/v1/collect', (_req, res) => {
    if (!opts.collector) {
      res.status(503).json({ ok: false, error: 'collector_unavailable' });
      return;
    }
    const { started } = opts.collector.start();
    const body: CollectResponse = { ok: true, running: true, started };
    res.status(started ? 202 : 409).json(body);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'not_found' });
  });

  return app;
}
