import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiEnvFromProcess } from './score.ts';
import { gradeClaim, judgeClaim, loadClaimFixtures } from './claim.ts';
import { openDb } from '../db/index.ts';

const fixtures = loadClaimFixtures(resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/claim-judge.json'));
const { db, close } = openDb(':memory:');
const env = aiEnvFromProcess(process.env);
let agreed = 0;
for (const row of fixtures) {
  const actual = await judgeClaim(db, env, { label: row.keyword, title: row.title, summary: row.text, urls: row.urls });
  const ok = gradeClaim(row, actual);
  if (ok) agreed += 1;
  console.log(`${ok ? 'ok' : 'miss'} ${row.name} relevant=${String(actual.relevant)} authentic=${String(actual.authentic)} ${actual.reason}`);
}
console.log(`${agreed}/${fixtures.length}`);
close();
process.exit(agreed === fixtures.length ? 0 : 1);
