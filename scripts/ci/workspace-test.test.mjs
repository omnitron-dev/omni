import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

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
