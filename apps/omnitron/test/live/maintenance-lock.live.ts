/**
 * The deployer's maintenance lock against a real gateway — run by hand:
 *
 *   DAOS_NGINX=<daos>/infra/nginx npx tsx apps/omnitron/test/live/maintenance-lock.live.ts
 *
 * Starts `<prefix>-redis` and `<prefix>-gateway` locally with the daos gateway
 * config mounted the way omnitron mounts it, and drives `MaintenanceLock` with
 * a runner that is plain `bash -c` here where it is SSH on a node — the same
 * `docker exec` strings, the same quoting, the same Lua. Not in the unit run:
 * it needs docker. The unit court (a-deployment-under-whoever-was-acting)
 * holds the control flow; this holds the commands.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MaintenanceLock,
  holdByHand,
  readMaintenanceState,
  releaseByHand,
  DEFAULT_MAINTENANCE_TIMING,
} from '../../src/services/maintenance-lock.js';

const NGINX = process.env['DAOS_NGINX'];
if (!NGINX) throw new Error('DAOS_NGINX: the daos infra/nginx directory');
const PREFIX = `mlk${process.pid}`;
const PORT = 18095;
const run = (script: string) =>
  new Promise<string>((resolve, reject) =>
    execFile('bash', ['-c', script], { timeout: 60_000 }, (err, stdout, stderr) =>
      err ? reject(new Error(`${stderr || stdout || err.message}`.trim())) : resolve(stdout.trim()),
    ),
  );
const page = async (path = '/') => (await run(`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT}${path}`)).trim();
const logger = {
  info: (o: unknown, m?: string) => console.log(`  · ${m ?? ''} ${JSON.stringify(o)}`),
  warn: (o: unknown, m?: string) => console.log(`  ! ${m ?? ''} ${JSON.stringify(o)}`),
  error: (o: unknown, m?: string) => console.log(`  ✗ ${m ?? ''} ${JSON.stringify(o)}`),
  debug: () => undefined,
} as never;

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  const statics = mkdtempSync(join(tmpdir(), 'mlk-'));
  writeFileSync(join(statics, 'index.html'), 'INDEX-OK');
  await run(`docker network create ${PREFIX}-net >/dev/null`);
  await run(`docker run -d --name ${PREFIX}-redis --network ${PREFIX}-net redis:7-alpine >/dev/null`);
  await run(
    `docker run -d --name ${PREFIX}-gateway --network ${PREFIX}-net -p 127.0.0.1:${PORT}:80 ` +
      `-e REDIS_HOST=${PREFIX}-redis -e REDIS_DB=15 -e UPSTREAM_MAIN_HOST=127.0.0.1 ` +
      `-v ${NGINX}/nginx.conf:/etc/nginx/templates/nginx.conf:ro -v ${NGINX}/docker-entrypoint.sh:/docker-entrypoint.sh:ro ` +
      `-v ${NGINX}/lua:/etc/nginx/lua:ro -v ${NGINX}/maintenance.html:/etc/nginx/html/maintenance.html:ro ` +
      `-v ${statics}:/var/www/portal:ro --entrypoint /bin/sh openresty/openresty:alpine /docker-entrypoint.sh >/dev/null`,
  );
  for (let i = 0; i < 40 && (await page('/nginx-health').catch(() => '000')) !== '200'; i++) await new Promise((r) => setTimeout(r, 500));

  const site = { run, prefix: PREFIX, db: 15, release: 'live-r1' };
  check('open: the platform is open before', (await page()) === '200');

  const timing = { ...DEFAULT_MAINTENANCE_TIMING, noticeSeconds: 6, etaSeconds: 120 };
  let noticeSeen = false;
  const watcher = (async () => {
    for (let i = 0; i < 20 && !noticeSeen; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const s = await readMaintenanceState(site).catch(() => null);
      if (s?.notice && s.notice.reason === 'deploy' && !s.active) noticeSeen = true;
    }
  })();
  const lock = await MaintenanceLock.open(site, logger, timing);
  await watcher;
  check('notice: open pages were told before the hold', noticeSeen);
  check('hold: a lock came back', lock !== null);
  check('hold: a page is 503 while held', (await page()) === '503');
  check('hold: the API is 503 MAINTENANCE', (await run(`curl -s -X POST http://127.0.0.1:${PORT}/api/main/netron/invoke -d '{}'`)).includes('"MAINTENANCE"'));
  const held = await readMaintenanceState(site);
  check('hold: the gateway says deploy, retry ~120 s', held.active && held.reason === 'deploy' && (held.retryAfter ?? 0) > 100, JSON.stringify(held));

  await lock!.renew();
  check('renew: still held after a renewal (new token)', (await page()) === '503');
  // The gateway caches the key for 2 s: a probe right after a renewal carries
  // a token the gateway has not read yet. liftWhenAnswering asks again.
  await new Promise((r) => setTimeout(r, 2_500));
  const probe = await lock!.probe(['/', '/api/main/netron/invoke']);
  check('probe: `/` answers with the token, a path off the list does not', probe.length === 1 && probe[0] === '/api/main/netron/invoke', probe.join(','));

  const lifted = await lock!.liftWhenAnswering(['/']);
  check('lift: lifted when `/` answered', lifted.lifted, JSON.stringify(lifted));
  await new Promise((r) => setTimeout(r, 2_500));
  check('lift: the platform is open again', (await page()) === '200');

  await holdByHand(site, 1);
  await new Promise((r) => setTimeout(r, 2_500));
  check('by hand: on holds', (await page()) === '503');
  const ttl = Number(await run(`docker exec ${PREFIX}-redis redis-cli -n 15 TTL omnitron:maintenance:deploy`));
  check('by hand: and expires by itself (TTL ≤ 60 s)', ttl > 0 && ttl <= 60, `ttl ${ttl}`);
  await releaseByHand(site);
  await new Promise((r) => setTimeout(r, 2_500));
  check('by hand: off lets go', (await page()) === '200');
  let refused = false;
  await holdByHand(site, 61).catch(() => (refused = true));
  check('by hand: never longer than an hour', refused);
}

main()
  .catch((err) => {
    fail++;
    console.log(`FAIL the run itself — ${(err as Error).message}`);
  })
  .finally(async () => {
    await run(`docker rm -f ${PREFIX}-gateway ${PREFIX}-redis >/dev/null 2>&1; docker network rm ${PREFIX}-net >/dev/null 2>&1`).catch(() => undefined);
    console.log(`\nmaintenance lock, live: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
