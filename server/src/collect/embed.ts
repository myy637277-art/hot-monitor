import type { EmbeddingNote } from '@hot/shared';

export const EMBEDDING_THRESHOLD = 0.9;

export function embeddingLayerStatus(): EmbeddingNote {
  return { skipped: true, reason: '已跳过 Embedding 去重，当前只按网址和 SimHash 合并' };
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function bufferToFloats(buf: Buffer): Float32Array {
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
}

export function floatsToBuffer(values: Float32Array): Buffer {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}
