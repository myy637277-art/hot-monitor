import { describe, expect, it } from 'vitest';
import type { HotStory } from '@hot/shared';
import { orderHomepage } from '../src/lib/feed-view.ts';

function story(patch: Partial<HotStory> & Pick<HotStory, 'id'>): HotStory {
  return {
    title: patch.id,
    summary: null,
    summaryZh: null,
    hotness: null,
    credibility: null,
    credibilityReason: null,
    aiMode: 'rules',
    updatedAt: '2026-10-28T00:00:00.000Z',
    publishedAt: '2026-10-28T00:00:00.000Z',
    eventTitle: null,
    feedReason: null,
    feedVerdict: null,
    sourceStrength: 0,
    unverified: false,
    feedBadge: null,
    sources: [],
    ...patch,
  };
}

describe('homepage order', () => {
  const rows = [
    story({ id: 'low', credibility: 20, hotness: 90, sourceStrength: 0, publishedAt: '2026-10-28T01:00:00.000Z', feedVerdict: 'uncertain' }),
    story({ id: 'high', credibility: 80, hotness: 10, sourceStrength: 2, publishedAt: '2026-10-27T01:00:00.000Z', feedVerdict: 'reliable' }),
    story({ id: 'open', credibility: 50, hotness: 40, sourceStrength: 1, publishedAt: '2026-10-29T01:00:00.000Z', unverified: true }),
  ];

  it('keeps the server order until a sort is chosen', () => {
    expect(orderHomepage(rows, 'composite', 'all').map((row) => row.id)).toEqual(['low', 'high', 'open']);
  });

  it('sorts by credibility, strength, hotness, and publish time', () => {
    expect(orderHomepage(rows, 'credibility', 'all').map((row) => row.id)).toEqual(['high', 'open', 'low']);
    expect(orderHomepage(rows, 'strength', 'all').map((row) => row.id)).toEqual(['high', 'open', 'low']);
    expect(orderHomepage(rows, 'hotness', 'all').map((row) => row.id)).toEqual(['low', 'open', 'high']);
    expect(orderHomepage(rows, 'newest', 'all').map((row) => row.id)).toEqual(['open', 'low', 'high']);
  });

  it('filters the judged verdict without dropping the homepage gate', () => {
    expect(orderHomepage(rows, 'composite', 'reliable').map((row) => row.id)).toEqual(['high']);
    expect(orderHomepage(rows, 'composite', 'uncertain').map((row) => row.id)).toEqual(['low']);
    expect(orderHomepage(rows, 'newest', 'unverified').map((row) => row.id)).toEqual(['open']);
  });
});
