/**
 * A firewall it could not read, called «inactive».
 *
 * The gateway's path to the applications is opened with a ufw rule, and the
 * script asked first whether ufw was on:
 *
 *     ufw status 2>/dev/null | head -1 | grep -q 'Status: active'
 *
 * A pipeline's status is its last command's, and `2>/dev/null` threw away the
 * only line that said why. A `ufw status` that FAILED — a deploy user that is
 * not root gets «ERROR: You need to be root to run this script» — printed
 * nothing, the grep found nothing, and the answer was `ufw-inactive`. The
 * deployer takes that as «nothing to do», silently: no rule, every /api/*
 * request dropped by an active firewall, and the only explanation on record
 * saying there was nothing to drop them.
 *
 * Its check for a rule already in place never matched one either: it read
 * the subnet before the ports, and `ufw status` prints them the other way.
 *
 * The script runs here in a real shell against a stand-in `ufw` for each of
 * its outcomes, and the deployer is asked what it says about the new one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, afterEach } from 'vitest';

import { reachabilityCommand, type ReachabilityRule } from '../../src/infrastructure/gateway-reachability.js';
import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';

const rule: ReachabilityRule = { subnet: '172.20.0.0/16', fromPort: 3001, toPort: 3007, comment: 'omnitron daos/test gateway' } as ReachabilityRule;

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A PATH holding the system's tools and, when given, a `ufw` that behaves as scripted. */
function pathWith(ufw: string | null): string {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-ufw-'));
  cleanup.push(bin);
  if (ufw !== null) fs.writeFileSync(path.join(bin, 'ufw'), `#!/bin/sh\n${ufw}\n`, { mode: 0o755 });
  // /usr/sbin is where a real ufw lives on Linux; leaving it out keeps a
  // developer's machine from answering for the stand-in.
  return `${bin}:/usr/bin:/bin`;
}

function outcome(ufw: string | null): string {
  const r = spawnSync('/bin/sh', ['-c', reachabilityCommand(rule)], { env: { PATH: pathWith(ufw) }, encoding: 'utf8' });
  expect(r.status, 'the script itself never fails a deployment').toBe(0);
  return r.stdout.trim();
}

const active = (rules: string) =>
  `case "$1" in status) printf 'Status: active\\n\\nTo                         Action      From\\n--                         ------      ----\\n${rules}';; allow) exit 0;; esac`;

describe('a firewall it could not read, called inactive', () => {
  it('says it could not read a ufw whose status failed, and why', () => {
    const answer = outcome(`echo 'ERROR: You need to be root to run this script' >&2; exit 1`);

    expect(answer, 'not «ufw-inactive»: nothing is known about it').toBe(
      'ufw-unreadable: ERROR: You need to be root to run this script',
    );
  });

  it('still tells apart the four answers it gave before', () => {
    expect(outcome(null)).toBe('no-ufw');
    expect(outcome(`[ "$1" = status ] && echo 'Status: inactive'; exit 0`)).toBe('ufw-inactive');
    expect(outcome(active('22/tcp                     ALLOW       Anywhere\\n'))).toBe('allowed');
    expect(
      outcome(`case "$1" in status) echo 'Status: active';; allow) exit 1;; esac`),
    ).toBe('failed');
  });

  it('knows a rule it already has, as ufw prints it — port first, source after', () => {
    // The pattern was `<subnet>.*<ports>`, the other way round, so this
    // answer was never given: every deployment asked for the rule again and
    // logged «Opened the gateway's path» for a path open all along.
    expect(
      outcome(active('3001:3007/tcp               ALLOW       172.20.0.0/16              # omnitron daos/test gateway\\n')),
    ).toBe('already-allowed');
  });

  it('is said by the deployer, at warn, with the reason', async () => {
    const said: Array<{ level: string; msg: string; fields: Record<string, unknown> }> = [];
    const at = (level: string) => (fields: Record<string, unknown>, msg: string) => said.push({ level, fields, msg });
    const logger: any = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), child: () => logger };

    // The node, as `openGatewayPath` sees it over SSH: the network's subnet,
    // then the reachability script's answer.
    const execution: any = {
      ssh: async (_target: unknown, command: string) =>
        command.startsWith('docker network inspect')
          ? { stdout: '172.20.0.0/16', stderr: '', exitCode: 0, duration: 1 }
          : { stdout: 'ufw-unreadable: ERROR: You need to be root to run this script', stderr: '', exitCode: 0, duration: 1 },
    };
    const deployer = new RemoteDeployer(logger, execution);

    await (deployer as unknown as { openGatewayPath(t: unknown, p: string, s: string): Promise<void> }).openGatewayPath(
      { host: '37.27.130.185', username: 'deploy' },
      'daos',
      'test',
    );

    const line = said.find((s) => s.msg.startsWith('Could not read the node’s firewall'));
    expect(line?.level).toBe('warn');
    expect(line?.fields['reason']).toBe('ERROR: You need to be root to run this script');
  });
});
