/**
 * The onion answered 200 with the gateway's own welcome page.
 *
 * A stack's gateway is configured by files — an nginx template, an entrypoint,
 * Lua modules — and `resolveGateway` mounts them from the MASTER's filesystem
 * (`${projectRoot}/infra/nginx/...`). On a node there is no such directory:
 * measured on the test server, `ls -d /root/daos /opt/daos` finds nothing, and
 * `daos-test-gateway` came up with an empty `Mounts` array, a null entrypoint,
 * zero `UPSTREAM_*` variables and the stock `default.conf` from the image.
 *
 * So its onion served `Welcome to OpenResty!` — HTTP 200, 128 646 bytes, over
 * the real Tor network. I had reported that 200 as "the onion works", which
 * was true about the status code and false about the page. A status code says
 * something is alive on the other end; it does not say it is the thing you
 * meant.
 *
 * The files now travel with the request that asks for the container. These
 * pin the receiving side, because a payload arrives over RPC from another
 * daemon and the sender's own validation is not evidence — an older sender, or
 * a tampered one, is exactly the case the checks exist for.
 */

import { describe, it, expect } from 'vitest';

import {
  isSafeRelativePath,
  isSafeMode,
  validatePayload,
  configFilesHash,
  payloadBytes,
  MAX_PAYLOAD_BYTES,
} from '../../src/infrastructure/config-payload.js';

describe('a path may not leave the directory it is written under', () => {
  it('accepts the shapes a config directory actually has', () => {
    for (const p of ['nginx.conf', 'lua/auth_rate.lua', 'html/maintenance.html', 'a/b/c/d.conf']) {
      expect(isSafeRelativePath(p), p).toBe(true);
    }
  });

  it('refuses every way out of the root', () => {
    for (const p of [
      '../etc/passwd',
      'lua/../../etc/shadow',
      '/etc/passwd',
      '/',
      'a/../../b',
      '..',
      './x',
      'a//b',
      '',
      'C:/windows/system32/drivers/etc/hosts',
      '\\windows\\x',
      'a/\0b',
    ]) {
      expect(isSafeRelativePath(p), p).toBe(false);
    }
  });

  it('refuses what a config directory should never carry', () => {
    // Not sanitisation: these are refused so the request fails loudly rather
    // than a key landing on a node because a directory happened to contain
    // one. A path that needed fixing was not the path the sender meant.
    for (const p of ['.git/config', 'node_modules/x/index.js', '.env', '.env.production', 'tls/server.key', 'certs/ca.pem']) {
      expect(isSafeRelativePath(p), p).toBe(false);
    }
  });
});

describe('a mode may not carry setuid', () => {
  it('accepts ordinary file modes', () => {
    for (const m of ['0644', '0755', '0600', '0400', '0777']) expect(isSafeMode(m), m).toBe(true);
  });

  it('refuses setuid, setgid and sticky', () => {
    for (const m of ['4755', '2755', '1777', '6755']) expect(isSafeMode(m), m).toBe(false);
  });

  it('refuses anything that is not four octal digits', () => {
    for (const m of ['755', '0o644', '0888', '06440', '', 'rwxr-xr-x']) expect(isSafeMode(m), m).toBe(false);
  });

  it('is right in both directions, which the first version was not', () => {
    // The first version read `!/^0[4267]/` — testing the OWNER digit, not the
    // setuid digit — so it rejected `0644` and accepted `0111`. Wrong both
    // ways at once, and only running it on real values showed it. A predicate
    // that looks right is the kind that ships.
    expect(isSafeMode('0644')).toBe(true);
    expect(isSafeMode('0111')).toBe(true); // odd, but not unsafe: no setuid bit
    expect(isSafeMode('4644')).toBe(false);
  });
});

describe('what the receiving daemon accepts', () => {
  const file = (path: string, content = 'x', mode = '0644') => ({ path, content, mode });

  it('accepts a real gateway payload', () => {
    expect(
      validatePayload({
        gateway: [file('nginx.conf', 'server { listen 80; }'), file('docker-entrypoint.sh', '#!/bin/sh\n', '0755'), file('lua/auth_rate.lua')],
      }),
    ).toEqual([]);
  });

  it('refuses a payload that is not an object of lists', () => {
    expect(validatePayload(null)[0]).toMatch(/must be an object/);
    expect(validatePayload([])[0]).toMatch(/must be an object/);
    expect(validatePayload({ gateway: 'nginx.conf' })[0]).toMatch(/expected a list/);
  });

  it('names the service, the path and the reason', () => {
    // A refusal an operator cannot act on is a refusal they will work around.
    const problems = validatePayload({ gateway: [file('../../etc/passwd'), file('ok.conf', 'x', '4755')] });
    expect(problems.join('\n')).toMatch(/gateway.*refusing path.*passwd/);
    expect(problems.join('\n')).toMatch(/gateway.*refusing mode '4755'/);
  });

  it('refuses a service name that is not one', () => {
    expect(validatePayload({ '../gateway': [file('a.conf')] })[0]).toMatch(/is not a service name/);
    expect(validatePayload({ 'a/b': [file('a.conf')] })[0]).toMatch(/is not a service name/);
  });

  it('refuses an entry missing any of its three fields', () => {
    for (const bad of [{ path: 'a' }, { content: 'x' }, { path: 'a', content: 'x' }, {}]) {
      expect(validatePayload({ gateway: [bad] })[0]).toMatch(/missing path, content or mode/);
    }
  });

  it('bounds the total, because a config directory that grew a build output is not one', () => {
    const huge = { gateway: [file('big.bin', 'x'.repeat(MAX_PAYLOAD_BYTES + 1))] };
    expect(validatePayload(huge).join()).toMatch(/over the .* limit/);
    expect(payloadBytes(huge as never)).toBeGreaterThan(MAX_PAYLOAD_BYTES);
  });
});

describe('a changed template must recreate the container', () => {
  const a = [{ path: 'nginx.conf', content: 'server { listen 80; }', mode: '0644' }];

  it('changes when the content changes', () => {
    const b = [{ path: 'nginx.conf', content: 'server { listen 8080; }', mode: '0644' }];
    expect(configFilesHash(a)).not.toBe(configFilesHash(b));
  });

  it('changes when a mode changes', () => {
    // A template that became executable, or an entrypoint that stopped being
    // so, is a different container even with identical bytes.
    expect(configFilesHash(a)).not.toBe(configFilesHash([{ ...a[0]!, mode: '0755' }]));
  });

  it('changes when a file is added or removed', () => {
    expect(configFilesHash(a)).not.toBe(configFilesHash([...a, { path: 'extra.conf', content: '', mode: '0644' }]));
  });

  it('does not change with file ORDER', () => {
    // The order a directory is read in is not a property of the deployment,
    // and a hash that moved with it would recreate the gateway on every
    // provisioning pass — which is worse than not noticing a change, because
    // it looks like progress.
    const one = [a[0]!, { path: 'b.conf', content: 'b', mode: '0644' }];
    expect(configFilesHash(one)).toBe(configFilesHash([...one].reverse()));
  });
});

describe('where a node puts what a master sent it', () => {
  it('partitions by project and stack', async () => {
    const { nodeConfigRoot } = await import('../../src/infrastructure/config-payload.js');

    // Two stacks on one node have two gateways with two different templates,
    // and the only thing telling them apart is which stack asked. Same
    // reasoning as the container prefix — without it the second stack
    // overwrites the first's configuration.
    expect(nodeConfigRoot('/root', 'daos', 'test', 'gateway')).toBe('/root/.omnitron/stack-config/daos/test/gateway');
    expect(nodeConfigRoot('/root', 'daos', 'dev', 'gateway')).not.toBe(nodeConfigRoot('/root', 'daos', 'test', 'gateway'));
  });

  it('never lets a name become a path', async () => {
    const { nodeConfigRoot } = await import('../../src/infrastructure/config-payload.js');

    // The names arrive over RPC like everything else.
    expect(nodeConfigRoot('/root', '../../etc', 'test', 'gateway')).toBe('/root/.omnitron/stack-config/unknown/test/gateway');
    expect(nodeConfigRoot('/root', 'daos', '..', 'gateway')).toContain('/unknown/');
  });
});

describe('writing a configuration is all or nothing', () => {
  function fakeHost() {
    const files = new Map<string, string>();
    return {
      files,
      host: { async writeFile(path: string, content: string) { files.set(path, content); } },
      remove: async (path: string) => { files.delete(path); },
      list: async (_dir: string) => [...files.keys()].map((k) => k.replace(/^\/r\//, '')),
    };
  }

  it('writes every file under the root', async () => {
    const { writeConfigFiles } = await import('../../src/infrastructure/config-payload.js');
    const f = fakeHost();

    const out = await writeConfigFiles(
      '/r',
      [{ path: 'nginx.conf', content: 'a', mode: '0644' }, { path: 'lua/x.lua', content: 'b', mode: '0644' }],
      f.host, f.remove, f.list,
    );

    expect(out.written.sort()).toEqual(['lua/x.lua', 'nginx.conf']);
    expect(f.files.get('/r/nginx.conf')).toBe('a');
  });

  it('writes NOTHING when one path is bad', async () => {
    const { writeConfigFiles } = await import('../../src/infrastructure/config-payload.js');
    const f = fakeHost();

    // A gateway that starts with four of its six files is worse than one that
    // does not start: it serves something, and what it serves is nobody's
    // intention. So the whole payload is validated before the first write.
    await expect(
      writeConfigFiles(
        '/r',
        [{ path: 'nginx.conf', content: 'a', mode: '0644' }, { path: '../escape', content: 'b', mode: '0644' }],
        f.host, f.remove, f.list,
      ),
    ).rejects.toThrow(/refusing path/);

    expect(f.files.size, 'nothing should have been written').toBe(0);
  });

  it('removes a file the payload no longer carries', async () => {
    const { writeConfigFiles } = await import('../../src/infrastructure/config-payload.js');
    const f = fakeHost();
    f.files.set('/r/lua/old.lua', 'stale');

    await writeConfigFiles('/r', [{ path: 'nginx.conf', content: 'a', mode: '0644' }], f.host, f.remove, f.list);

    // A Lua module deleted upstream must stop being mounted here. A stale file
    // in a config directory is still read by whatever globs the directory,
    // which is how a removed rule keeps applying.
    expect(f.files.has('/r/lua/old.lua')).toBe(false);
    expect(f.files.has('/r/nginx.conf')).toBe(true);
  });
});

describe('reading a config directory on the master', () => {
  function fakeFs(tree: Record<string, { content?: string; mode?: number; dir?: true }>) {
    return {
      async readdir(d: string) {
        const prefix = d.replace(/^\/cfg\/?/, '');
        const depth = prefix ? prefix.split('/').length : 0;
        return Object.keys(tree)
          .filter((p) => (prefix ? p.startsWith(prefix + '/') : true))
          .map((p) => p.split('/').slice(depth))
          .filter((parts) => parts.length === 1 && parts[0])
          .map((parts) => {
            const full = prefix ? `${prefix}/${parts[0]}` : parts[0]!;
            return { name: parts[0]!, isDirectory: () => Boolean(tree[full]?.dir) };
          });
      },
      async readFile(p: string) { return tree[p.replace('/cfg/', '')]?.content ?? ''; },
      async stat(p: string) { return { mode: tree[p.replace('/cfg/', '')]?.mode ?? 0o644 }; },
    };
  }

  it('carries the executable bit, because an entrypoint needs it', async () => {
    const { readConfigDirectory } = await import('../../src/infrastructure/config-payload.js');

    // Flattening every mode to 0644 ships a script the container cannot run,
    // and the failure appears at container start as an exec error with no
    // obvious relation to how the file travelled.
    const { files } = await readConfigDirectory('/cfg', fakeFs({
      'nginx.conf': { content: 'a', mode: 0o644 },
      'docker-entrypoint.sh': { content: '#!/bin/sh', mode: 0o755 },
    }));

    expect(files.find((f) => f.path === 'docker-entrypoint.sh')?.mode).toBe('0755');
    expect(files.find((f) => f.path === 'nginx.conf')?.mode).toBe('0644');
  });

  it('descends into subdirectories', async () => {
    const { readConfigDirectory } = await import('../../src/infrastructure/config-payload.js');

    const { files } = await readConfigDirectory('/cfg', fakeFs({
      'nginx.conf': { content: 'a' },
      lua: { dir: true },
      'lua/auth_rate.lua': { content: 'b' },
    }));

    expect(files.map((f) => f.path).sort()).toEqual(['lua/auth_rate.lua', 'nginx.conf']);
  });

  it('skips what must not travel, and says what it skipped', async () => {
    const { readConfigDirectory } = await import('../../src/infrastructure/config-payload.js');

    // A project with a stray key in its nginx directory should still get a
    // working gateway — and the operator should learn the key stayed behind,
    // rather than the whole provisioning failing or the key quietly shipping.
    const { files, skipped } = await readConfigDirectory('/cfg', fakeFs({
      'nginx.conf': { content: 'a' },
      'server.key': { content: 'SECRET' },
      '.env': { content: 'SECRET' },
    }));

    expect(files.map((f) => f.path)).toEqual(['nginx.conf']);
    expect(skipped.sort()).toEqual(['.env', 'server.key']);
    expect(JSON.stringify(files)).not.toContain('SECRET');
  });
});

describe('a static path a master claims it delivered', () => {
  const ALLOWED = '/opt/omnitron/stack-static/';
  /** The confinement the node applies. Same expression as the method. */
  const accepted = (dir: unknown) =>
    typeof dir === 'string' && dir.startsWith(ALLOWED) && !dir.includes('..');

  it('accepts the shape the deployer actually produces', () => {
    expect(accepted('/opt/omnitron/stack-static/gateway/9f2a1c0b4e7d8a35')).toBe(true);
  });

  it('refuses a path outside the directory this daemon owns', () => {
    // A mount SOURCE is a path with root's reach: docker will happily bind
    // `/etc` or `/root/.ssh` into a container, and the path arrives over RPC
    // from another daemon. `/etc` is a directory too.
    for (const dir of [
      '/etc',
      '/root/.ssh',
      '/var/lib/docker',
      '/opt/omnitron/artifacts/daos/main/0.0.1',
      'opt/omnitron/stack-static/x',
      '',
    ]) {
      expect(accepted(dir), dir || '(empty)').toBe(false);
    }
  });

  it('refuses a traversal that starts inside the allowed prefix', () => {
    // The prefix check alone is not enough: a path may begin correctly and
    // climb out afterwards.
    expect(accepted('/opt/omnitron/stack-static/../../etc')).toBe(false);
    expect(accepted('/opt/omnitron/stack-static/gateway/../../../root')).toBe(false);
  });

  it('refuses anything that is not a string', () => {
    for (const dir of [null, undefined, 42, {}, ['/opt/omnitron/stack-static/x']]) {
      expect(accepted(dir)).toBe(false);
    }
  });
});
