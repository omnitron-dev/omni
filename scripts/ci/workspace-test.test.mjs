import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('strict Turbo mode carries the isolated test endpoints and home into the test cache key', () => {
  const turbo = createRequire(import.meta.url).resolve('turbo/bin/turbo');
  const result = spawnSync(process.execPath, [turbo, 'test', '--filter=@omnitron-dev/omnitron', '--only', '--dry=json', '--env-mode=strict'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, TEST_POSTGRES_PORT: '25432', TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:25432/test',
      OMNITRON_HOME: '/private-test-home', DOCKER_HOST: 'unix:///private-test-docker.sock' },
  });
  assert.equal(result.status, 0, result.stderr);
  const task = JSON.parse(result.stdout).tasks.find(value => value.taskId === '@omnitron-dev/omnitron#test');
  assert.equal(task.envMode, 'strict');
  for (const name of ['TEST_POSTGRES_PORT', 'TEST_DATABASE_URL', 'OMNITRON_HOME']) {
    assert.ok(task.environmentVariables.configured.some(value => value.startsWith(name + '=')), name + ' must be hashed and forwarded');
  }
  assert.ok(task.environmentVariables.passthrough.some(value => value.startsWith('DOCKER_HOST=')));
});

for (const [up, suite, down] of [[0, 0, 0], [2, 0, 0], [0, 7, 0], [0, 0, 9], [0, 7, 9]]) {
  test(`compose up=${up}, tests=${suite}, compose down=${down}`, { skip: process.platform === 'win32' }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'omni-test-ci-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await copyFile(new URL('./workspace-test.mjs', import.meta.url), join(directory, 'test-ci.mjs'));
    const trace = join(directory, 'trace');
    const source = "const fs = require('node:fs'); fs.appendFileSync(process.env.TRACE, JSON.stringify(process.argv.slice(2)) + '\\n');";
    await writeFile(join(directory, 'docker'), '#!/usr/bin/env node\n' + source +
      `process.exit(process.argv.includes('up') ? ${up} : ${down});`, { mode: 0o755 });
    const bin = join(directory, 'node_modules/turbo/bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'turbo'), source + `process.exit(${suite});`);
    const result = spawnSync(process.execPath, [join(directory, 'test-ci.mjs')], {
      env: { ...process.env, TRACE: trace, PATH: directory + delimiter + process.env.PATH },
      encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(result.status, up || suite || down, result.stderr);
    const calls = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.match(calls[0][2], /^omni-ci-[0-9a-f-]{36}$/);
    assert.deepEqual(calls.at(-1).slice(0, 5), calls[0].slice(0, 5));
    assert.deepEqual(calls.at(-1).slice(5), ['down', '-v']);
    assert.deepEqual(calls.slice(1, -1), up ? [] : [['test']]);
  });
}
