import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IntegrationName } from '@hot/shared';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnvFile(): void {
  const envPath = resolve(serverRoot, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

const has = (...names: string[]) => names.every((n) => Boolean(process.env[n]?.trim()));

export function readConfig() {
  return {
    port: Number(process.env.PORT ?? 3001),
    host: process.env.HOST ?? '127.0.0.1',
    dbFile: resolve(serverRoot, process.env.DB_FILE ?? 'data/hot.sqlite'),
    // Used as the step in the cron seconds field, so it must stay within 1-59.
    heartbeatSec: Math.min(59, Math.max(1, Number(process.env.HEARTBEAT_INTERVAL_SEC ?? 30) || 30)),
  };
}

export function integrationStatus(): Record<IntegrationName, boolean> {
  return {
    deepseek: has('DEEPSEEK_API_KEY'),
    twitterapiIo: has('TWITTERAPI_IO_API_KEY'),
    serverchan: has('SERVERCHAN_SENDKEY'),
  };
}
