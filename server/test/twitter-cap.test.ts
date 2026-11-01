import { afterEach, describe, expect, it } from 'vitest';
import { collectTwitter } from '../src/collect/adapters.ts';
import { ensureSources, recordAttempt } from '../src/collect/store.ts';
import { shanghaiDate } from '../src/collect/time.ts';
import { usageDaily } from '../src/db/schema.ts';
import { fakeClock, fixture, memoryDb, testNet, textResponse } from './helpers.ts';

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

describe('twitterapi.io cap', () => {
  it('stops for the day when the credit response says the balance is used up', async () => {
    const clock = fakeClock('2026-10-26T02:00:00.000Z');
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return textResponse(fixture('twitter-credit.json'), 402, 'application/json');
    };
    const { db, close } = memoryDb();
    opened.push(close);
    ensureSources(db, { search: 80, twitter: 150 });
    const net = testNet(clock, fetchImpl, { twitterKey: 'test-key' });
    const first = await collectTwitter(db, net);
    recordAttempt(db, first, net.now(), false);
    expect(first.pauseReason).toBe('额度已用完');
    expect(first.pauseUntil?.toISOString()).toBe('2026-10-26T16:00:00.000Z');
    const second = await collectTwitter(db, net);
    expect(second.status).toBe('paused');
    expect(fetches).toBe(1);
  });

  it('does not send a request after the daily tweet cap is reached', async () => {
    const clock = fakeClock('2026-10-26T02:00:00.000Z');
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return textResponse('{"tweets":[]}', 200, 'application/json');
    };
    const { db, close } = memoryDb();
    opened.push(close);
    ensureSources(db, { search: 80, twitter: 150 });
    db.insert(usageDaily)
      .values({ day: shanghaiDate(clock.now()), sourceId: 'twitter', requests: 150, items: 150 })
      .run();
    const net = testNet(clock, fetchImpl, { twitterKey: 'test-key' });
    const attempt = await collectTwitter(db, net);
    expect(attempt.status).toBe('cap');
    expect(attempt.pauseReason).toBe('已达每日上限');
    expect(fetches).toBe(0);
  });
});
