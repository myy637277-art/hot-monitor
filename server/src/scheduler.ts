import { Cron } from 'croner';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { jobRuns } from './db/schema.ts';
import { readDigest } from './notify/digest.ts';

export const HEARTBEAT_JOB = 'heartbeat';
const SHANGHAI = 'Asia/Shanghai';

export function recordRun(db: Db, name: string, at = new Date(), lastError: string | null = null): void {
  db.insert(jobRuns)
    .values({ name, lastRunAt: at, runCount: 1, lastError })
    .onConflictDoUpdate({
      target: jobRuns.name,
      set: { lastRunAt: at, runCount: sql`${jobRuns.runCount} + 1`, lastError },
    })
    .run();
}

export function getRun(db: Db, name: string) {
  return db.select().from(jobRuns).where(eq(jobRuns.name, name)).get() ?? null;
}

export function digestCron(hour: number, minute: number): string {
  return `0 ${minute} ${hour} * * *`;
}

/** One daily run in Asia/Shanghai. A restart after that minute waits until the next day. */
export function createDigestJob(hour: number, minute: number, task: () => void): Cron {
  return new Cron(
    digestCron(hour, minute),
    {
      name: 'digest',
      timezone: SHANGHAI,
      protect: true,
      catch: () => console.error('[scheduler] digest failed'),
    },
    task,
  );
}

export function startScheduler(
  db: Db,
  heartbeatSec: number,
  digest?: { run: () => Promise<void> },
): { stop: () => void; rescheduleDigest: () => void; nextRun: (from?: Date) => Date | null } {
  const heartbeat = new Cron(
    `*/${heartbeatSec} * * * * *`,
    { name: HEARTBEAT_JOB, protect: true, catch: (err) => console.error('[scheduler] heartbeat failed', err) },
    () => recordRun(db, HEARTBEAT_JOB),
  );
  recordRun(db, HEARTBEAT_JOB);
  let digestJob: Cron | null = null;

  const rescheduleDigest = () => {
    digestJob?.stop();
    digestJob = null;
    if (!digest) return;
    const settings = readDigest(db);
    if (!settings.enabled) return;
    digestJob = createDigestJob(settings.hour, settings.minute, () => {
      void digest.run().catch(() => console.error('[scheduler] digest failed'));
    });
  };

  rescheduleDigest();
  return {
    rescheduleDigest,
    nextRun: (from?: Date) => digestJob?.nextRun(from) ?? null,
    stop: () => {
      heartbeat.stop();
      digestJob?.stop();
    },
  };
}
