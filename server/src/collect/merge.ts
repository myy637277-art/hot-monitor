import { cosine, EMBEDDING_THRESHOLD } from './embed.ts';
import { hamming, SIMHASH_DISTANCE } from './simhash.ts';

export interface MatchCandidate {
  storyId: string;
  dedupeKey: string;
  simhash: bigint | null;
  embedding: Float32Array | null;
}

function isTweet(dedupeKey: string): boolean {
  return dedupeKey.startsWith('twitter:');
}

/**
 * Same dedupe key first (normalized URL / tweet id / BV / hot word).
 * An X item joins only on that key: SimHash and embeddings never attach it to another source.
 * Other sources still use SimHash within distance 3, then cosine ≥ 0.90 when both embeddings exist and the layer is enabled.
 */
export function decideMatch(
  incoming: { dedupeKey: string; simhash: bigint | null; embedding: Float32Array | null },
  existing: MatchCandidate[],
  useEmbedding: boolean,
): string | null {
  const byKey = existing.find((row) => row.dedupeKey === incoming.dedupeKey);
  if (byKey) return byKey.storyId;
  if (isTweet(incoming.dedupeKey)) return null;

  const pool = existing.filter((row) => !isTweet(row.dedupeKey));

  if (incoming.simhash != null) {
    let best: { storyId: string; dist: number } | null = null;
    for (const row of pool) {
      if (row.simhash == null) continue;
      const dist = hamming(incoming.simhash, row.simhash);
      if (dist <= SIMHASH_DISTANCE && (best == null || dist < best.dist)) best = { storyId: row.storyId, dist };
    }
    if (best) return best.storyId;
  }

  if (useEmbedding && incoming.embedding) {
    let best: { storyId: string; score: number } | null = null;
    for (const row of pool) {
      if (!row.embedding) continue;
      const score = cosine(incoming.embedding, row.embedding);
      if (score >= EMBEDDING_THRESHOLD && (best == null || score > best.score)) best = { storyId: row.storyId, score };
    }
    if (best) return best.storyId;
  }

  return null;
}
