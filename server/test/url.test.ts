import { describe, expect, it } from 'vitest';
import { biliDedupeKey, canonicalUrl, dedupeKeyForUrl, twitterDedupeKey, weiboDedupeKey } from '../src/collect/url.ts';

describe('URL normalization', () => {
  it('strips tracking params, fragment, www, and trailing slash, and sorts the query', () => {
    expect(canonicalUrl('https://WWW.Example.com/a/?utm_source=x&b=2&a=1#frag')).toBe('https://example.com/a?a=1&b=2');
  });

  it('upgrades http and drops the default port', () => {
    expect(canonicalUrl('http://example.com:80/a/')).toBe('https://example.com/a');
  });

  it('dedupes tweets by id and bilibili videos by BV', () => {
    expect(dedupeKeyForUrl('https://x.com/someone/status/99?s=20')).toBe(twitterDedupeKey('99'));
    expect(dedupeKeyForUrl('https://twitter.com/someone/status/99')).toBe('twitter:99');
    expect(dedupeKeyForUrl('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333')).toBe(biliDedupeKey('BV1xx411c7mD'));
    expect(dedupeKeyForUrl('https://example.com/video/BV1xx411c7mD')).toBe('url:https://example.com/video/BV1xx411c7mD');
  });

  it('normalizes a weibo hot word', () => {
    expect(weiboDedupeKey('  AI   大模型 ')).toBe('weibo:ai 大模型');
  });
});
