import { describe, expect, it } from 'vitest';
import { fetchUrl } from '../src/collect/http.ts';

describe('fetch body cap', () => {
  it('stops once the response passes 2MB', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 8);
    await expect(
      fetchUrl(async () => new Response(big), 'https://example.com/a', { timeoutMs: 5_000, ua: 'test' }),
    ).rejects.toThrow('响应过大');
  });
});
