import { afterEach, describe, expect, it } from 'vitest';
import { collectTwitter } from '../src/collect/adapters.ts';
import { parseTweets } from '../src/collect/parse.ts';
import { ensureSources, listStories, recordAttempt } from '../src/collect/store.ts';
import { keepXPost, selectXPosts } from '../src/collect/twitter.ts';
import { fakeClock, memoryDb, testNet, textResponse } from './helpers.ts';

const opened: Array<() => void> = [];
afterEach(() => opened.splice(0).forEach((close) => close()));

const when = '2026-10-28T01:00:00.000Z';

function tweet(extra: Record<string, unknown>) {
  return {
    id: '1',
    text: 'a model note',
    url: 'https://x.com/someone/status/1',
    createdAt: when,
    ...extra,
  };
}

describe('x post filter', () => {
  it('drops a 19-view post before it is stored', async () => {
    const parsed = parseTweets(JSON.stringify({ tweets: [tweet({ id: '19', viewCount: 19, author: { userName: 'someone', followers: 500000 } })] }));
    expect(keepXPost(parsed[0]!)).toBe(false);
    expect(keepXPost({ handle: 'OpenAI', followers: null, viewCount: 19 })).toBe(false);

    const clock = fakeClock('2026-10-28T08:00:00.000Z');
    const fetchImpl: typeof fetch = async () => textResponse(JSON.stringify({ tweets: [tweet({ id: '19', url: 'https://x.com/someone/status/19', viewCount: 19, author: { userName: 'someone', followers: 500000 } })] }), 200, 'application/json');
    const { db, close } = memoryDb();
    opened.push(close);
    ensureSources(db, { search: 80, twitter: 150 });
    const net = testNet(clock, fetchImpl, { twitterKey: 'test-key' });
    const attempt = await collectTwitter(db, net);
    expect(attempt.items).toEqual([]);
    recordAttempt(db, attempt, net.now(), false);
    expect(listStories(db, 10)).toEqual([]);
  });

  it('keeps an official account when views are missing', () => {
    const parsed = parseTweets(JSON.stringify({ tweets: [tweet({ url: 'https://x.com/OpenAI/status/2', author: { userName: 'OpenAI' } })] }));
    expect(parsed[0]?.viewCount).toBeNull();
    expect(parsed[0]?.followers).toBeNull();
    expect(keepXPost(parsed[0]!)).toBe(true);
  });

  it('keeps a non-official account at 100000 followers and 1000 views', () => {
    const parsed = parseTweets(JSON.stringify({ tweets: [tweet({ viewCount: 1000, author: { userName: 'blogger', followers: 100000 } })] }));
    expect(keepXPost(parsed[0]!)).toBe(true);
  });

  it('drops a low-follower post and ignores a blue check', () => {
    const parsed = parseTweets(
      JSON.stringify({ tweets: [tweet({ viewCount: 50000, author: { userName: 'small', followers: 99999, isBlueVerified: true } })] }),
    );
    expect(keepXPost(parsed[0]!)).toBe(false);
  });

  it('looks up followers when the tweet payload omits them', async () => {
    const drafts = parseTweets(JSON.stringify({ tweets: [tweet({ viewCount: 1500, author: { userName: 'SomeBlogger' } })] }));
    expect(drafts[0]?.followers).toBeNull();
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      urls.push(String(url));
      return textResponse(JSON.stringify({ data: { followers: 100000 }, status: 'success' }), 200, 'application/json');
    };
    const net = testNet(fakeClock('2026-10-28T08:00:00.000Z'), fetchImpl, { twitterKey: 'test-key' });
    const kept = await selectXPosts(net, drafts);
    expect(urls).toEqual(['https://api.twitterapi.io/twitter/user/info?userName=someblogger']);
    expect(kept.lookups).toBe(1);
    expect(kept.items).toHaveLength(1);

    const fetchFail: typeof fetch = async () => textResponse(JSON.stringify({ data: {}, status: 'success' }), 200, 'application/json');
    const dropped = await selectXPosts(testNet(fakeClock('2026-10-28T08:00:00.000Z'), fetchFail, { twitterKey: 'test-key' }), drafts);
    expect(dropped.items).toEqual([]);
  });
});
