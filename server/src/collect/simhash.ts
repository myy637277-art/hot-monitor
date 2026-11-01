const MASK = (1n << 64n) - 1n;

function hash64(input: string): bigint {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const ch of input) {
    h ^= BigInt(ch.codePointAt(0)!);
    h = (h * prime) & MASK;
  }
  return h;
}

export function grams(text: string): string[] {
  const s = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (s.length === 0) return [];
  if (s.length === 1) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** 64-bit SimHash. Returns null when the text has no letters or digits. */
export function simhash(text: string): bigint | null {
  const tokens = grams(text);
  if (tokens.length === 0) return null;
  const weights = Array.from({ length: 64 }, () => 0);
  for (const token of tokens) {
    const h = hash64(token);
    for (let i = 0; i < 64; i++) weights[i]! += ((h >> BigInt(i)) & 1n) === 1n ? 1 : -1;
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) if (weights[i]! > 0) out |= 1n << BigInt(i);
  return out;
}

export function hamming(a: bigint, b: bigint): number {
  let x = (a ^ b) & MASK;
  let n = 0;
  while (x > 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export function simhashHex(text: string): string | null {
  const value = simhash(text);
  return value == null ? null : value.toString(16).padStart(16, '0');
}

export function parseSimhash(hex: string | null): bigint | null {
  if (!hex) return null;
  return BigInt(`0x${hex}`);
}

export const SIMHASH_DISTANCE = 3;
