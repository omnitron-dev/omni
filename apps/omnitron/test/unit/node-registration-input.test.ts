import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { confirmedNodeStackActivation, nodeStackActivationCommand, prepareNodeConfigPublication } from '../../src/services/node-registration.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function publication(body: string) {
  const directory = await mkdtemp(join(tmpdir(), 'omni-private-config-'));
  directories.push(directory);
  return { directory, ...prepareNodeConfigPublication({ directory, project: 'fixture', operation: 'test', artifacts: [], body }) };
}

it('publishes an environment secret through stdin without placing it in argv or output', async () => {
  const value = 'synthetic-private-key-72cc';
  const request = await publication(`export default ${JSON.stringify({ apps: [{ name: 'api', env: { API_KEY: value } }] })};`);
  expect(request.command).not.toContain(value);
  expect(request.command).not.toContain(request.directory);
  const output = execFileSync('/bin/sh', ['-c', request.command], { input: request.stdin, encoding: 'utf8' });
  expect(JSON.parse(output)).toEqual({ changed: true });
  expect(output).not.toContain(value);
  const file = join(request.directory, 'omnitron.config.mjs');
  expect(await readFile(file, 'utf8')).toContain(value);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect((await stat(join(request.directory, '.registration-test', 'candidate.mjs'))).mode & 0o777).toBe(0o600);
});

it.each(['{ "sensitive": "synthetic-private-key-72cc"', '{"body":7}'])('rejects malformed input without exposing it', async (input) => {
  const request = await publication('export default { apps: [] };');
  try {
    execFileSync('/bin/sh', ['-c', request.command], { input, encoding: 'utf8', stdio: 'pipe' });
    expect.fail('Malformed publication must fail');
  } catch (error) {
    expect(String(error)).toContain('Invalid node configuration input');
    expect(String(error)).not.toContain('synthetic-private-key-72cc');
  }
  await expect(stat(join(request.directory, 'omnitron.config.mjs'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('does not echo a candidate module exception containing credential data', async () => {
  const request = await publication('throw new Error("synthetic-private-key-72cc");');
  try {
    execFileSync('/bin/sh', ['-c', request.command], { input: request.stdin, encoding: 'utf8', stdio: 'pipe' });
    expect.fail('An invalid candidate must fail');
  } catch (error) {
    expect(String(error)).toContain('Node configuration publication failed');
    expect(String(error)).not.toContain('synthetic-private-key-72cc');
  }
  await expect(stat(join(request.directory, 'omnitron.config.mjs'))).rejects.toMatchObject({ code: 'ENOENT' });
});

async function activation(outcome: 'confirmed' | 'partial', reported = ['api', 'web']) {
  const request = await publication('export default { apps: [{ name: "api" }, { name: "web" }] };');
  execFileSync('/bin/sh', ['-c', request.command], { input: request.stdin });
  const calls = join(request.directory, 'calls');
  const expectedArgs = ['--json', 'stack', 'start', 'fixture', 'deployed'];
  const apps = reported.map(name => ({ name: 'fixture/deployed/' + name, status: 'online' }));
  const reply = { ok: true, data: { project: 'fixture', stack: 'deployed', action: 'started', outcome, total: 2, online: 2, apps } };
  const command = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    'if (JSON.stringify(process.argv.slice(2)) !== ' + JSON.stringify(JSON.stringify(expectedArgs)) + ') process.exit(2);',
    'fs.appendFileSync(' + JSON.stringify(calls) + ', "1");',
    'console.log(' + JSON.stringify(JSON.stringify(reply)) + ');',
  ].join('\n');
  await writeFile(join(request.directory, 'omnitron'), command, { mode: 0o700 });
  const run = (readOnly = false) => execFileSync('/bin/sh', [
    '-c', nodeStackActivationCommand(request.directory, 'test', 'fixture', 'deployed', readOnly),
  ], { env: { ...process.env, PATH: request.directory + ':' + process.env['PATH'] }, encoding: 'utf8' });
  const confirmed = (raw: string) => confirmedNodeStackActivation(raw, 'test', 'fixture', 'deployed', ['api', 'web']);
  return { directory: request.directory, calls, run, confirmed };
}

it('recovers a lost stack reply without dispatching twice or accepting a superseded configuration', async () => {
  const a = await activation('confirmed');
  expect(a.confirmed(a.run(true))).toBe(false);
  await expect(stat(a.calls)).rejects.toMatchObject({ code: 'ENOENT' });
  a.run(); // The node completed the request. Its first reply never reached the caller.
  const reply = a.run(true);
  expect(a.confirmed(reply)).toBe(true);
  expect(confirmedNodeStackActivation(reply, 'other', 'fixture', 'deployed', ['api'])).toBe(false);
  expect(confirmedNodeStackActivation(reply, 'test', 'fixture', 'deployed', ['other'])).toBe(false);
  expect(a.confirmed(a.run())).toBe(true);
  expect(await readFile(a.calls, 'utf8')).toBe('1');
  await writeFile(join(a.directory, 'omnitron.config.mjs'), 'export default { apps: [] };');
  expect(a.confirmed(a.run(true))).toBe(false);
  expect(a.confirmed(a.run())).toBe(false);
  expect(await readFile(a.calls, 'utf8')).toBe('1');
});

it('retains an incomplete response without starting the stack again', async () => {
  const a = await activation('partial');
  expect(a.confirmed(a.run())).toBe(false);
  expect(a.confirmed(a.run())).toBe(false);
  expect(await readFile(a.calls, 'utf8')).toBe('1');
});

it('requires the complete registered app set even if the node reports a successful start', async () => {
  const a = await activation('confirmed', ['api', 'another']);
  expect(a.confirmed(a.run())).toBe(false);
  expect(a.confirmed(a.run(true))).toBe(false);
  expect(await readFile(a.calls, 'utf8')).toBe('1');
});
