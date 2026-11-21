import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { createContainer } from '../../src/infrastructure/container-runtime.js';

it('joins late Docker creation and a lost start reply across separate CLI processes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'omnitron-creation-'));
  const file = (name: string) => path.join(dir, name);
  const id = 'b'.repeat(64);
  const name = 'late-console';
  const docker = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs'), path = require('node:path');",
    "const f = name => path.join(__dirname, name);",
    'const [scope, op, ...args] = process.argv.slice(2);',
    "if (scope !== 'container') throw Error('unexpected scope: ' + scope);",
    "const ref = args.at(-1);",
    "fs.appendFileSync(f('calls'), JSON.stringify([op, op === 'create' ? null : ref]) + '\\n');",
    "const fail = msg => { console.error(msg); process.exitCode = 1; };",
    "if (op === 'create') {",
    "  const labels = Object.fromEntries(args.flatMap((arg, i) => {",
    "    if (arg !== '--label') return [];",
    "    const label = args[i+1], split = label.indexOf('=');",
    "    return [[label.slice(0, split), label.slice(split+1)]];",
    "  }));",
    "  const state = { Id: 'b'.repeat(64), Name: '/' + args[args.indexOf('--name') + 1],",
    "    Config: { Image: ref, Labels: labels }, State: { Status: 'created' }, NetworkSettings: { Ports: {} },",
    "    HostConfig: { PortBindings: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '19800' }] } } };",
    "  fs.writeFileSync(f('pending'), JSON.stringify(state), { flag: 'wx' });",
    "  fail('error reading from Docker: EOF');",
    "} else if (op === 'inspect' && !fs.existsSync(f('visible'))) {",
    "  fs.writeFileSync(f('first-absent'), ref);",
    "  fail('Error response from daemon: No such container: ' + ref);",
    "} else {",
    "  const state = JSON.parse(fs.readFileSync(f('visible')));",
    "  if (op === 'start' && ref === state.Id && state.State.Status === 'created') {",
    "    state.State.Status = 'running'; state.NetworkSettings.Ports = { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '19800' }] };",
    "    fs.writeFileSync(f('visible'), JSON.stringify(state));",
    "    fail('error reading from Docker: EOF');",
    "  } else if (op === 'inspect' && [state.Id, state.Name.slice(1)].includes(ref)) {",
    "    const format = args[args.indexOf('--format') + 1];",
    "    if (!format.includes('.Config.Labels') || format.includes('.Config.Env')) throw Error('unexpected inspection fields');",
    "    process.stdout.write(JSON.stringify([state], null, 2));",
    "  } else throw Error('unexpected native operation: ' + JSON.stringify([op, ref]));",
    '}',
  ].join('\n');
  const isolated = AbortSignal.timeout(10_000);
  let operation: Promise<string> | undefined;
  try {
    await writeFile(file('docker'), docker, { mode: 0o700 });
    vi.stubEnv('PATH', dir + path.delimiter + process.env['PATH']);
    vi.stubEnv('DOCKER_HOST', 'unix://' + file('absent.sock'));
    vi.stubEnv('DOCKER_CONTEXT', '');
    operation = createContainer({
      name, image: 'fixture:1', ports: [{ container: 80, host: 19800 }], volumes: [], environment: {},
      labels: { description: 'password=example-only' }, restart: 'no',
    }, { fullId: true, pull: 'never' });
    const absence = async () => {
      for (;;) {
        try { return await readFile(file('first-absent'), 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await delay(20, undefined, { signal: isolated });
      }
    };
    expect(await Promise.race([absence(), operation])).toBe(name);
    await rename(file('pending'), file('visible'));
    await expect(operation).resolves.toBe(id);
    const calls = (await readFile(file('calls'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(calls.filter(([op]) => op === 'create')).toEqual([['create', null]]);
    expect(calls.filter(([op]) => op === 'start')).toEqual([['start', id]]);
    expect(calls.at(-1)).toEqual(['inspect', id]);
  } finally {
    // Keep unjoined CLI work inside its isolated environment if the assertion fails.
    if (operation) {
      await rename(file('pending'), file('visible')).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      await operation.catch(() => undefined);
    }
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
