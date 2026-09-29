/**
 * A deployment under whoever was acting.
 *
 * A deployment stopped and started every app under the people using the
 * platform, and nothing told them: requests landed in restarts and failed as
 * an outage would, and a tester's report described the deployment instead of
 * the product. Measured on daos/test on 2026-09-29, polling through the
 * gateway once a second while release d531ab26 went out: main's API answered
 * 503 for ~3 s in the middle of it, with no warning before and nothing to say
 * why — and every other app restarted at its own moment.
 *
 * `MaintenanceLock` holds the platform at the gateway for the length of a
 * deployment, warned `noticeSeconds` ahead, renewed while the deployment
 * lives and expiring by itself when it does not, lifted only when the
 * platform answers through the gateway. These cases drive it against a node
 * that runs the same shell it is given — a Redis kept in memory, and a
 * gateway that answers `/_/maintenance` and the probe as the real Lua does
 * (daos `infra/nginx/lua/maintenance_check.lua`, proven live there).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  DEPLOY_KEY,
  NOTICE_KEY,
  MaintenanceLock,
  gatewayCommand,
  redisCommand,
  type MaintenanceTiming,
} from '../../src/services/maintenance-lock.js';

/** POSIX-ish words: single quotes, `'\''`, backslash outside quotes. */
function words(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let started = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      cur += s.slice(i + 1, end);
      started = true;
      i = end;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[++i];
      started = true;
    } else if (/\s/.test(c)) {
      if (started) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += c;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

interface Node {
  run: (script: string) => Promise<string>;
  keys: Map<string, { value: string; ttl: number | null }>;
  log: string[];
  /** Whether the gateway reads the database the lock writes. */
  gatewayDb: number;
  running: boolean;
  appsAnswer: boolean;
}

function node(opts: Partial<Pick<Node, 'gatewayDb' | 'running' | 'appsAnswer'>> = {}): Node {
  const keys = new Map<string, { value: string; ttl: number | null }>();
  const log: string[] = [];
  const n: Node = {
    keys,
    log,
    gatewayDb: opts.gatewayDb ?? 15,
    running: opts.running ?? true,
    appsAnswer: opts.appsAnswer ?? true,
    run: async (script) => {
      const w = words(script);
      if (w[0] === 'docker' && w[1] === 'inspect') {
        return n.running ? '/daos-test-gateway true\n/daos-test-redis true\n' : '';
      }
      if (w[0] === 'docker' && w[1] === 'exec' && w[2] === 'daos-test-redis' && w[3] === 'sh' && w[4] === '-c') {
        const inner = w[5]!;
        const cli = words(inner.slice(inner.indexOf('exec redis-cli ') + 'exec redis-cli '.length));
        const db = Number(cli[cli.indexOf('-n') + 1]);
        const [cmd, ...args] = cli.slice(cli.indexOf('-n') + 2);
        log.push(`${cmd} ${args[0]}`);
        const store = db === 15 ? keys : new Map(); // only DB 15 is modelled
        if (cmd === 'SET') {
          const ex = args.indexOf('EX');
          store.set(args[0]!, { value: args[1]!, ttl: ex >= 0 ? Number(args[ex + 1]) : null });
          return 'OK';
        }
        if (cmd === 'DEL') {
          for (const k of args) store.delete(k);
          return '1';
        }
        throw new Error(`unexpected redis command ${cmd}`);
      }
      if (w[0] === 'docker' && w[1] === 'exec' && w[2] === 'daos-test-gateway' && w[3] === 'wget') {
        const url = w[w.length - 1]!;
        const path = url.replace('http://127.0.0.1', '');
        const header = w.find((x) => x.startsWith('X-Maintenance-Probe: '));
        // The gateway reads ITS database; a lock written elsewhere it does not see.
        const seen = n.gatewayDb === 15 ? keys : new Map<string, { value: string }>();
        const deploy = seen.get(DEPLOY_KEY);
        if (path === '/_/maintenance') {
          return JSON.stringify(deploy ? { active: true, reason: 'deploy' } : { active: false, reason: null });
        }
        if (deploy) {
          const probe = (JSON.parse(deploy.value) as { probe: string }).probe;
          if (header !== `X-Maintenance-Probe: ${probe}`) throw new Error('wget: server returned error: HTTP/1.1 503');
        }
        if (!n.appsAnswer) throw new Error('wget: server returned error: HTTP/1.1 503');
        return 'ok';
      }
      throw new Error(`unexpected script: ${script}`);
    },
  };
  return n;
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn() } as never;
const noWait = async () => undefined;
const FAST: MaintenanceTiming = {
  noticeSeconds: 60,
  etaSeconds: 180,
  ttlSeconds: 600,
  renewSeconds: 60,
  capSeconds: 1800,
  seenWithinMs: 50,
  probeWithinMs: 50,
};
const site = (n: Node) => ({ run: n.run, prefix: 'daos-test', db: 15, release: 'daos-r1' });

describe('the commands it sends', () => {
  it('writes to the gateway’s database, and reads no password onto a command line', () => {
    const cmd = redisCommand({ prefix: 'daos-test', db: 15 }, ['SET', DEPLOY_KEY, '{"a":"b\'c"}', 'EX', '600']);
    expect(cmd).toContain("docker exec 'daos-test-redis' sh -c");
    expect(cmd).toContain('-n 15');
    expect(cmd).toContain('REDISCLI_AUTH="$REDIS_PASSWORD"');
    // A value with a quote in it arrives whole.
    const inner = words(cmd)[5]!;
    expect(words(inner.slice(inner.indexOf('exec redis-cli ') + 15))).toEqual([
      '--no-auth-warning', '-n', '15', 'SET', DEPLOY_KEY, '{"a":"b\'c"}', 'EX', '600',
    ]);
  });

  it('asks the gateway from its own loopback — the probe is not honoured from the onion', () => {
    expect(gatewayCommand({ prefix: 'daos-test' }, '/api/main/health', 'tok')).toBe(
      "docker exec 'daos-test-gateway' wget -q -T 10 -O - --header 'X-Maintenance-Probe: tok' 'http://127.0.0.1/api/main/health'",
    );
  });
});

describe('warned, then held', () => {
  it('announces first, then holds with an expiry, and clears the warning', async () => {
    const n = node();
    const waits: number[] = [];
    const lock = await MaintenanceLock.open(site(n), logger, FAST, async (ms) => void waits.push(ms));
    expect(lock).not.toBeNull();
    expect(n.log.slice(0, 3)).toEqual([`SET ${NOTICE_KEY}`, `SET ${DEPLOY_KEY}`, `DEL ${NOTICE_KEY}`]);
    expect(waits[0]).toBe(60_000);
    const held = n.keys.get(DEPLOY_KEY)!;
    expect(held.ttl).toBe(600);
    expect(JSON.parse(held.value)).toMatchObject({ reason: 'deploy', release: 'daos-r1' });
    expect((JSON.parse(held.value) as { probe: string }).probe).toMatch(/^[0-9a-f]{48}$/);
    await lock!.lift('deployed');
  });

  it('holds nothing where there is no gateway and Redis — a first deployment', async () => {
    const n = node({ running: false });
    expect(await MaintenanceLock.open(site(n), logger, FAST, noWait)).toBeNull();
    expect(n.log).toEqual([]);
  });

  it('a node it cannot even ask leaves the deployment unheld — never failed', async () => {
    // What three courts' fake deployer handed over: no runner at all. And a
    // runner that throws before it returns a promise, which `.catch` on its
    // result never saw.
    for (const run of [undefined, () => { throw new Error('ssh: connect to host 10.0.0.9 port 22: Connection refused'); }]) {
      const warn = vi.fn();
      const opened = MaintenanceLock.open(
        { run: run as never, prefix: 'daos-test', db: 15, release: 'daos-r1' },
        { ...(logger as object), warn } as never,
        FAST,
        noWait,
      );
      await expect(opened).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'daos-test' }), expect.stringMatching(/Could not ask the node for its gateway/));
    }
  });

  it('says so when the gateway does not see the lock — the way it failed before', async () => {
    const n = node({ gatewayDb: 1 });
    const error = vi.fn();
    const lock = await MaintenanceLock.open(site(n), { ...(logger as object), error } as never, FAST, noWait);
    expect(error).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/does not see the maintenance lock/));
    await lock?.lift('failed');
  });
});

describe('never longer than the deployment — or the cap', () => {
  it('each renewal rotates the probe token and keeps the expiry', async () => {
    const n = node();
    const lock = (await MaintenanceLock.open(site(n), logger, { ...FAST, noticeSeconds: 0 }, noWait))!;
    const before = (JSON.parse(n.keys.get(DEPLOY_KEY)!.value) as { probe: string }).probe;
    await lock.renew();
    const after = JSON.parse(n.keys.get(DEPLOY_KEY)!.value) as { probe: string };
    expect(after.probe).not.toBe(before);
    expect(n.keys.get(DEPLOY_KEY)!.ttl).toBe(600);
    await lock.lift('deployed');
  });

  it('past the cap it lets go even while the deployment runs', async () => {
    const n = node();
    const lock = (await MaintenanceLock.open(site(n), logger, { ...FAST, noticeSeconds: 0, capSeconds: 0 }, noWait))!;
    await lock.renew();
    expect(n.keys.has(DEPLOY_KEY)).toBe(false);
  });
});

describe('lifted when the platform answers through the gateway', () => {
  it('asks with its own token, and lets go', async () => {
    const n = node();
    const lock = (await MaintenanceLock.open(site(n), logger, { ...FAST, noticeSeconds: 0 }, noWait))!;
    const result = await lock.liftWhenAnswering(['/', '/api/main/health']);
    expect(result).toMatchObject({ lifted: true, failed: [] });
    expect(n.keys.has(DEPLOY_KEY)).toBe(false);
  });

  it('keeps the lock when it does not — to expire by itself, not to be renewed', async () => {
    const n = node({ appsAnswer: false });
    const lock = (await MaintenanceLock.open(site(n), logger, { ...FAST, noticeSeconds: 0 }, noWait))!;
    const result = await lock.liftWhenAnswering(['/', '/api/main/health']);
    expect(result).toMatchObject({ lifted: false, failed: ['/', '/api/main/health'] });
    expect(n.keys.get(DEPLOY_KEY)?.ttl).toBe(600);
    // No renewal after this: the key's own expiry ends it.
    n.log.length = 0;
    await new Promise((r) => setTimeout(r, 5));
    expect(n.log).toEqual([]);
  });

  it('lifting twice lets go once', async () => {
    const n = node();
    const lock = (await MaintenanceLock.open(site(n), logger, { ...FAST, noticeSeconds: 0 }, noWait))!;
    await lock.lift('deployed');
    const dels = n.log.filter((l) => l.startsWith('DEL')).length;
    await lock.lift('deployed');
    expect(n.log.filter((l) => l.startsWith('DEL')).length).toBe(dels);
  });
});
