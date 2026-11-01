import { afterEach, describe, expect, it } from 'vitest';
import { isVerification } from '../src/collect/http.ts';
import { fakeClock, fixture, memoryDb, runSearch, testNet, textResponse } from './helpers.ts';

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

describe('verification pause', () => {
  it('detects a block by status or page keywords', () => {
    expect(isVerification(429, '')).toBe(true);
    expect(isVerification(403, 'ok')).toBe(true);
    expect(isVerification(200, fixture('google-verify.html'))).toBe(true);
    expect(isVerification(200, fixture('google.html'))).toBe(false);
  });

  it('pauses the engine until the next Shanghai midnight and resumes after that', async () => {
    const clock = fakeClock('2026-10-26T02:00:00.000Z');
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      if (fetches === 1) return textResponse(fixture('google-verify.html'), 200);
      return textResponse(fixture('google.html'));
    };
    const { db, close } = memoryDb();
    opened.push(close);
    const net = testNet(clock, fetchImpl);
    const paused = await runSearch(db, 'google', net);
    expect(paused.status).toBe('paused');
    expect(paused.pauseReason).toBe('验证页或被拦截');
    expect(paused.pauseUntil?.toISOString()).toBe('2026-10-26T16:00:00.000Z');

    const again = await runSearch(db, 'google', net);
    expect(again.status).toBe('paused');
    expect(fetches).toBe(1);

    clock.set('2026-10-26T16:00:00.000Z');
    const resumed = await runSearch(db, 'google', net);
    expect(resumed.status).toBe('ok');
    expect(fetches).toBe(2);
  });
});
