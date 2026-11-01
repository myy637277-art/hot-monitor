import { judgeHomepage } from './ai/judge.ts';
import { aiEnvFromProcess, readAiStatus, scoreStories } from './ai/score.ts';
import { createApp } from './app.ts';
import { capsFromNet, createCollector, netFromEnv } from './collect/run.ts';
import { loadEnvFile, readConfig } from './config.ts';
import { openDb } from './db/index.ts';
import { seedShownClaims } from './discover/interests.ts';
import { deliverDigest } from './notify/digest.ts';
import { startScheduler } from './scheduler.ts';

loadEnvFile();
const config = readConfig();
const { db, close } = openDb(config.dbFile);
seedShownClaims(db, new Date());
const net = netFromEnv(process.env);
const collector = createCollector(db, net, capsFromNet(net));
const scheduler = startScheduler(db, config.heartbeatSec, {
  run: async () => {
    if (!collector.running()) collector.start('main');
    await collector.finished();
    await deliverDigest(db, {
      now: new Date(),
      modelOpen: readAiStatus(db, aiEnvFromProcess(process.env)).enabled,
      serverchanKey: process.env.SERVERCHAN_SENDKEY,
      fetchImpl: globalThis.fetch,
      mode: 'scheduled',
    }).then(() => undefined);
    if (!collector.running()) collector.start('keywords');
  },
});
const app = createApp(db, {
  heartbeatSec: config.heartbeatSec,
  collector,
  net,
  onDigestChange: () => scheduler.rescheduleDigest(),
});

const server = app.listen(config.port, config.host, () => {
  console.log(`[server] http://${config.host}:${config.port}  db=${config.dbFile}`);
  const env = aiEnvFromProcess(process.env);
  void scoreStories(db, env)
    .then(() => judgeHomepage(db, env))
    .catch((err) => {
      console.error('[ai] score failed', err instanceof Error ? err.message : 'failed');
    });
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  scheduler.stop();
  collector.cancel();
  void collector.finished().then(() => {
    server.close(() => {
      close();
      process.exit(0);
    });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
