import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { nodeStackActivationIssue, nodeStackActivationCommand, prepareNodeConfigPublication } from '../../src/services/node-registration.js';

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

async function activation(outcome: 'confirmed' | 'partial', reported = ['api', 'web'], failure?: Record<string, unknown>) {
  const request = await publication('export default { apps: [{ name: "api" }, { name: "web" }] };');
  execFileSync('/bin/sh', ['-c', request.command], { input: request.stdin });
  const calls = join(request.directory, 'calls');
  const expectedArgs = ['--json', 'stack', 'start', 'fixture', 'deployed'];
  const apps = reported.map(name => ({ name: 'fixture/deployed/' + name, status: 'online' }));
  const reply = failure ?? { ok: true, data: { project: 'fixture', stack: 'deployed', action: 'started', outcome, total: 2, online: outcome === 'partial' ? 1 : 2, apps } };
  const command = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    'if (JSON.stringify(process.argv.slice(2)) !== ' + JSON.stringify(JSON.stringify(expectedArgs)) + ') process.exit(2);',
    'fs.appendFileSync(' + JSON.stringify(calls) + ', "1");',
    `console.${failure ? 'error' : 'log'}(` + JSON.stringify(JSON.stringify(reply)) + ');',
    `process.exitCode = ${failure || outcome === 'partial' ? 1 : 0};`,
  ].join('\n');
  await writeFile(join(request.directory, 'omnitron'), command, { mode: 0o700 });
  const run = (readOnly = false) => execFileSync('/bin/sh', [
    '-c', nodeStackActivationCommand(request.directory, 'test', 'fixture', 'deployed', readOnly),
  ], { env: { ...process.env, PATH: request.directory + ':' + process.env['PATH'] }, encoding: 'utf8' });
  const issue = (raw: string) => nodeStackActivationIssue(raw, 'test', 'fixture', 'deployed', ['api', 'web']);
  return { directory: request.directory, calls, run, issue };
}

it('recovers a lost stack reply without dispatching twice or accepting a superseded configuration', async () => {
  const a = await activation('confirmed');
  expect(a.issue(a.run(true))).toBe('No start request was recorded on the node');
  await expect(stat(a.calls)).rejects.toMatchObject({ code: 'ENOENT' });
  a.run(); // The node completed the request. Its first reply never reached the caller.
  const reply = a.run(true);
  expect(a.issue(reply)).toBeUndefined();
  expect(nodeStackActivationIssue(reply, 'other', 'fixture', 'deployed', ['api'])).toContain('unavailable');
  expect(nodeStackActivationIssue(reply, 'test', 'fixture', 'deployed', ['other'])).toContain('application set');
  expect(a.issue(a.run())).toBeUndefined();
  expect(await readFile(a.calls, 'utf8')).toBe('1');
  await writeFile(join(a.directory, 'omnitron.config.mjs'), 'export default { apps: [] };');
  expect(a.issue(a.run(true))).toMatch(/configuration changed/);
  expect(a.issue(a.run())).toMatch(/configuration changed/);
  expect(await readFile(a.calls, 'utf8')).toBe('1');
});

it('retains an incomplete response without starting the stack again', async () => {
  const a = await activation('partial');
  expect(a.issue(a.run())).toContain('partial start (1/2 applications online)');
  expect(a.issue(a.run(true))).toContain('partial start (1/2 applications online)');
  expect(await readFile(a.calls, 'utf8')).toBe('1');
});

it('reads an outstanding request while the original process still owns startup', async () => {
  const a = await activation('confirmed');
  await writeFile(join(a.directory, '.registration-test/start-requested'), 'test', { flag: 'wx' });
  expect(a.issue(a.run(true))).toMatch(/no final result yet/);
  expect(a.issue(a.run())).toMatch(/no final result yet/);
  await expect(stat(a.calls)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('requires a successful stdout reply even if stderr contains the shape of a confirmation', async () => {
  const apps = ['api', 'web'].map(name => ({ name, status: 'online' }));
  const a = await activation('confirmed', [], { ok: true, data: {
    action: 'started', project: 'fixture', stack: 'deployed', outcome: 'confirmed', total: 2, online: 2, apps,
  } });
  expect(a.issue(a.run(true))).toMatch(/No start request/);
  expect(a.issue(a.run())).toMatch(/valid start result/);
  expect(await readFile(a.calls, 'utf8')).toBe('1');
});

it('requires the complete registered app set even if the node reports a successful start', async () => {
  const a = await activation('confirmed', ['api', 'another']);
  expect(a.issue(a.run())).toContain('application set');
  expect(a.issue(a.run(true))).toContain('application set');
  expect(await readFile(a.calls, 'utf8')).toBe('1');
});

it.each([
  ['client-timeout', 'timed out waiting for the daemon'],
  ['connection-lost', 'lost its connection to the daemon'],
  ['unrecognized-private-reason', 'CLI returned an error'],
])('retains the CLI diagnostic %s from stderr without copying private process output', async (reason, message) => {
  const a = await activation('confirmed', [], { ok: false, project: 'fixture', stack: 'deployed', outcome: 'unknown',
    reason, error: 'synthetic-private-error-text', details: { value: 'synthetic-private-field' } });
  const original = a.run();
  expect(a.issue(original)).toContain(message);
  expect(a.run(true)).toBe(original);
  expect(a.run()).toBe(original);
  const stored = await readFile(join(a.directory, '.registration-test/start-result.json'), 'utf8');
  expect(JSON.parse(stored)).toEqual(JSON.parse(original));
  expect(stored).not.toMatch(/synthetic-private|unrecognized-private-reason/);
  expect(await readFile(a.calls, 'utf8')).toBe('1');
});

it('keeps an older inconclusive receipt and rejects unrecognized receiver diagnostics', () => {
  const response = { operation: 'test', project: 'fixture', stack: 'deployed', confirmed: false, apps: [] };
  const read = (fields: object) => nodeStackActivationIssue(JSON.stringify({ ...response, ...fields }), 'test', 'fixture', 'deployed', ['api']);
  expect(read({})).toMatch(/unavailable/);
  expect(read({ reason: '__proto__' })).toMatch(/unavailable/);
  expect(read({ reason: 'client-timeout', operation: 'stale' })).toMatch(/unavailable/);
});
