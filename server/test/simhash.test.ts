import { describe, expect, it } from 'vitest';
import { hamming, simhash } from '../src/collect/simhash.ts';

describe('SimHash', () => {
  it('is zero for identical text and large for unrelated text', () => {
    const left = simhash('机器之心报道，某实验室发布了面向中文的开源语言模型，并公开了训练数据说明与评测结果。');
    const right = simhash('机器之心报道，某实验室发布了面向中文的开源语言模型，并公开了训练数据说明与评测结果。');
    const other = simhash('周末城市骑行路线经过滨江公园，适合带孩子看日落。');
    expect(left).not.toBeNull();
    expect(hamming(left!, right!)).toBe(0);
    expect(hamming(left!, other!)).toBeGreaterThan(3);
  });

  it('treats a tiny edit to a long text as a near duplicate', () => {
    const base = '开源模型评测显示中文推理能力明显提升。'.repeat(12);
    const near = `${base}开源`;
    const distance = hamming(simhash(base)!, simhash(near)!);
    expect(distance).toBeLessThanOrEqual(3);
  });

  it('counts bit differences directly', () => {
    expect(hamming(0b1111n, 0b0001n)).toBe(3);
  });
});
