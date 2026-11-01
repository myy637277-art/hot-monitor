import type { HotStory } from '@hot/shared';

export type FeedSort = 'composite' | 'credibility' | 'strength' | 'hotness' | 'newest';
export type VerdictFilter = 'all' | 'reliable' | 'uncertain' | 'unverified';

export function orderHomepage(stories: HotStory[], sort: FeedSort, verdict: VerdictFilter): HotStory[] {
  const filtered =
    verdict === 'all'
      ? stories
      : stories.filter((story) => (verdict === 'unverified' ? story.unverified : story.feedVerdict === verdict));
  if (sort === 'composite') return filtered;
  return [...filtered].sort((a, b) => {
    if (sort === 'credibility') return (b.credibility ?? -1) - (a.credibility ?? -1);
    if (sort === 'hotness') return (b.hotness ?? -1) - (a.hotness ?? -1);
    if (sort === 'strength') return b.sourceStrength - a.sourceStrength;
    return timeOf(b) - timeOf(a);
  });
}

function timeOf(story: HotStory): number {
  const at = Date.parse(story.publishedAt ?? story.updatedAt);
  return Number.isNaN(at) ? 0 : at;
}

export function asFeedSort(value: string): FeedSort {
  if (value === 'credibility' || value === 'strength' || value === 'hotness' || value === 'newest') return value;
  return 'composite';
}

export function asVerdictFilter(value: string): VerdictFilter {
  if (value === 'reliable' || value === 'uncertain' || value === 'unverified') return value;
  return 'all';
}
