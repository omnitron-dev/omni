import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareNodeConfigPublication } from '../../src/services/node-registration.js';

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
