import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { HealthResponse } from '@hot/shared';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/db/index.ts';
import { HEARTBEAT_JOB, recordRun } from '../src/scheduler.ts';

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

function setup() {
  const { db, close } = openDb(':memory:');
  opened.push(close);
  return { db, app: createApp(db, { heartbeatSec: 30 }) };
}

describe('GET /api/v1/health', () => {
  it('returns ok with no heartbeat before the scheduler runs', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/health').expect(200);
    const body = res.body as HealthResponse;
    expect(body.ok).toBe(true);
    expect(body.heartbeat).toEqual({ lastAt: null, count: 0, intervalSec: 30 });
  });

  it('reports the last heartbeat time and run count', async () => {
    const { db, app } = setup();
    recordRun(db, HEARTBEAT_JOB, new Date('2026-10-26T08:00:00Z'));
    recordRun(db, HEARTBEAT_JOB, new Date('2026-10-26T08:00:30Z'));
    const body = (await request(app).get('/api/v1/health').expect(200)).body as HealthResponse;
    expect(body.heartbeat.lastAt).toBe('2026-10-26T08:00:30.000Z');
    expect(body.heartbeat.count).toBe(2);
  });

  it('reports integrations as booleans only', async () => {
    const { app } = setup();
    const body = (await request(app).get('/api/v1/health').expect(200)).body as HealthResponse;
    for (const v of Object.values(body.integrations)) expect(typeof v).toBe('boolean');
  });

  it('returns JSON 404 for unknown api routes', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/nope').expect(404);
    expect(res.body).toEqual({ ok: false, error: 'not_found' });
  });
});
