import { randomUUID } from 'node:crypto';
import type { TrustKind, TrustedSource } from '@hot/shared';
import { and, eq } from 'drizzle-orm';
import { OFFICIAL_DOMAINS, type TrustList } from './ai/formula.ts';
import { OFFICIAL_X_HANDLES } from './collect/twitter.ts';
import type { Db } from './db/index.ts';
import { jobRuns, trustedSources } from './db/schema.ts';

const SEED_JOB = 'trust-seed';

export function loadTrust(db: Db): TrustList {
  const seeded = db.select().from(jobRuns).where(eq(jobRuns.name, SEED_JOB)).get();
  if (!seeded) {
    const now = new Date();
    for (const domain of OFFICIAL_DOMAINS) insertTrust(db, 'domain', domain, now);
    for (const handle of OFFICIAL_X_HANDLES) insertTrust(db, 'handle', handle, now);
    db.insert(jobRuns).values({ name: SEED_JOB, lastRunAt: now, runCount: 1 }).onConflictDoNothing().run();
  }
  const rows = db.select().from(trustedSources).all();
  return {
    domains: rows.filter((row) => row.kind === 'domain').map((row) => row.value),
    handles: rows.filter((row) => row.kind === 'handle').map((row) => row.value),
  };
}

export function listTrusted(db: Db): TrustedSource[] {
  loadTrust(db);
  return db
    .select()
    .from(trustedSources)
    .all()
    .map((row) => ({
      id: row.id,
      kind: row.kind === 'handle' ? 'handle' : 'domain',
      value: row.value,
      createdAt: row.createdAt.toISOString(),
    }));
}

export function normalizeTrust(kind: TrustKind, value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (kind === 'handle') {
    const name = raw.replace(/^@/, '');
    return /^[a-z0-9_]{1,15}$/.test(name) ? name : null;
  }
  const host = raw.replace(/^https?:\/\//, '').split('/')[0]?.replace(/\.$/, '') ?? '';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host.includes('..')) return null;
  return host;
}

export function addTrusted(db: Db, kind: TrustKind, value: string, now: Date): { ok: true; source: TrustedSource } | { ok: false; error: 'bad_value' | 'duplicate' } {
  const normalized = normalizeTrust(kind, value);
  if (!normalized) return { ok: false, error: 'bad_value' };
  const existing = db
    .select()
    .from(trustedSources)
    .where(and(eq(trustedSources.kind, kind), eq(trustedSources.value, normalized)))
    .get();
  if (existing) return { ok: false, error: 'duplicate' };
  const row = { id: randomUUID(), kind, value: normalized, createdAt: now };
  db.insert(trustedSources).values(row).run();
  return {
    ok: true,
    source: { id: row.id, kind, value: row.value, createdAt: now.toISOString() },
  };
}

export function deleteTrusted(db: Db, id: string): boolean {
  const row = db.select().from(trustedSources).where(eq(trustedSources.id, id)).get();
  if (!row) return false;
  db.delete(trustedSources).where(eq(trustedSources.id, id)).run();
  return true;
}

function insertTrust(db: Db, kind: TrustKind, value: string, now: Date): void {
  db.insert(trustedSources)
    .values({ id: randomUUID(), kind, value, createdAt: now })
    .onConflictDoNothing()
    .run();
}
