import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StorySourceLink, StoryTitleLink } from '../src/components/story-link.tsx';

describe('story links', () => {
  it('renders a source URL as a link and skips a missing URL', () => {
    const linked = renderToStaticMarkup(
      <StorySourceLink source={{ id: 'hn', name: 'Hacker News', type: 'hn', url: 'https://news.ycombinator.com/item?id=1' }}>
        Hacker News
      </StorySourceLink>,
    );
    expect(linked).toContain('href="https://news.ycombinator.com/item?id=1"');
    expect(linked).toContain('target="_blank"');
    expect(linked).toContain('Hacker News');

    const plain = renderToStaticMarkup(
      <StorySourceLink source={{ id: 'hn', name: 'Hacker News', type: 'hn', url: null }}>Hacker News</StorySourceLink>,
    );
    expect(plain.includes('<a ')).toBe(false);
    expect(plain).toContain('Hacker News');

    const title = renderToStaticMarkup(<StoryTitleLink title="DeepSeek" href="https://example.com/a" />);
    expect(title).toContain('href="https://example.com/a"');
    expect(title).toContain('target="_blank"');

    const dead = renderToStaticMarkup(<StoryTitleLink title="无链接" href={null} />);
    expect(dead.includes('<a ')).toBe(false);
    expect(dead).toContain('无链接');
  });
});
