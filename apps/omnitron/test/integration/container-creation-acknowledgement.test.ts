import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createContainer } from '../../src/infrastructure/container-runtime.js';

it.each(['acknowledged', 'lost'])('joins late Docker creation and publication across CLI processes when the start reply is %s', async reply => {
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
    "  fs.renameSync(f('pending'), f('visible'));", // This inspect missed the allocation. The next native observer sees it.
    "  fail('Error response from daemon: No such container: ' + ref);",
    "} else {",
    "  const state = JSON.parse(fs.readFileSync(f('visible')));",
    "  if (op === 'start' && ref === state.Id && state.State.Status === 'created') {",
    "    state.State.Status = 'running';",
    "    fs.writeFileSync(f('visible'), JSON.stringify(state));",
    reply === 'lost' ? "    fail('error reading from Docker: EOF');" : "    process.stdout.write(state.Id);",
    "  } else if (op === 'inspect' && [state.Id, state.Name.slice(1)].includes(ref)) {",
    "    const format = args[args.indexOf('--format') + 1];",
    "    if (!format.includes('.Config.Labels') || format.includes('.Config.Env')) throw Error('unexpected inspection fields');",
    "    if (state.State.Status === 'running') {",
    "      if (fs.existsSync(f('published'))) state.NetworkSettings.Ports = state.HostConfig.PortBindings;",
    "      else fs.writeFileSync(f('published'), ref);", // Return this empty port snapshot before the forwarded address appears.
    "    }",
    "    process.stdout.write(JSON.stringify([state], null, 2));",
    "  } else throw Error('unexpected native operation: ' + JSON.stringify([op, ref]));",
    '}',
  ].join('\n');
  try {
    await writeFile(file('docker'), docker, { mode: 0o700 });
    vi.stubEnv('PATH', dir + path.delimiter + process.env['PATH']);
    vi.stubEnv('DOCKER_HOST', 'unix://' + file('absent.sock'));
    vi.stubEnv('DOCKER_CONTEXT', '');
    const operation = createContainer({
      name, image: 'fixture:1', ports: [{ container: 80, host: 19800 }], volumes: [], environment: {},
      labels: { description: 'password=example-only' }, restart: 'no',
    }, { fullId: true, pull: 'never' });
    await expect(operation).resolves.toBe(id);
    const calls = (await readFile(file('calls'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(calls).toEqual([['create', null], ['inspect', name], ['inspect', name],
      ['start', id], ['inspect', id], ['inspect', id]]);
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
