import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureGeneration, publishGeneration, recoverGeneration, verifyGeneration } from './publish-generation.js';
import { readProcessLifetime } from '@omnitron-dev/common/process-identity';
import { spawnSync } from 'node:child_process';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it('replaces the complete generation and retains the prior build when validation fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-publish-'));
  roots.push(root);
  const output = join(root, 'out');
  publishGeneration(
    output,
    new Map([
      ['index.html', 'one'],
      ['retired.md', 'old public text'],
    ])
  );
  expect(() =>
    publishGeneration(
      output,
      new Map([
        ['index.html', 'two'],
        ['../escape', 'unsafe'],
      ])
    )
  ).toThrow('Unsafe output');
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('one');
  expect(existsSync(join(root, 'escape'))).toBe(false);
  publishGeneration(output, new Map([['index.html', 'two']]));
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('two');
  expect(existsSync(join(output, 'retired.md'))).toBe(false);
  const inventory = JSON.parse(readFileSync(join(output, '.lumen-generation.json'), 'utf8'));
  expect(Object.keys(inventory.files)).toEqual(['index.html']);
  expect(inventory.files['index.html'].sha256).toMatch(/^[a-f0-9]{64}$/);
});
it('refuses to replace an existing directory without Lumen ownership evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-unowned-'));
  roots.push(root);
  expect(() => publishGeneration(root, new Map([['index.html', 'new']]))).toThrow('not a Lumen generation');
});

it('holds a verified preview generation while later builds replace the published tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-preview-'));
  roots.push(root);
  const output = join(root, 'out');
  publishGeneration(output, new Map([['index.html', 'old page'], ['old.js', 'old asset']]));
  const preview = captureGeneration(output);
  publishGeneration(output, new Map([['index.html', 'new page'], ['new.js', 'new asset']]));
  expect(readFileSync(join(preview.directory, 'index.html'), 'utf8')).toBe('old page');
  expect(readFileSync(join(preview.directory, 'old.js'), 'utf8')).toBe('old asset');
  expect(existsSync(join(output, 'old.js'))).toBe(false);
  expect(verifyGeneration(preview.directory).files['old.js']).toBeDefined();
  preview.release();
  expect(existsSync(preview.directory)).toBe(false);
});

function interruptedPublication(point: string, initial = true): { root: string; output: string; journal: string } {
  const root = mkdtempSync(join(tmpdir(), 'lumen-killpoint-'));
  roots.push(root);
  const output = join(root, 'out');
  if (initial) publishGeneration(output, new Map([['index.html', 'old'], ['retired.js', 'retired']]));
  // This fixture is deliberately outside a package boundary, hence .mjs.
  const fixture = join(root, 'publisher.mjs');
  writeFileSync(fixture, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const output = ${JSON.stringify(output)}, point = ${JSON.stringify(point)};
const rename = fs.renameSync, remove = fs.rmSync;
let fault = false;
fs.renameSync = (from, to) => {
  if (point === 'before-move' && from === output) process.kill(process.pid, 'SIGKILL');
  if (point === 'before-commit' && to === output) process.kill(process.pid, 'SIGKILL');
  if (point === 'write-fault' && to === output && !fault) { fault = true; throw new Error('injected rename failure'); }
  rename(from, to);
  if (point === 'after-move' && from === output) process.kill(process.pid, 'SIGKILL');
  if (point === 'after-commit' && to === output) process.kill(process.pid, 'SIGKILL');
};
fs.rmSync = (path, options) => {
  remove(path, options);
  if (point === 'cleanup' && String(path).includes('.previous/')) process.kill(process.pid, 'SIGKILL');
};
syncBuiltinESMExports();
const { publishGeneration } = await import(${JSON.stringify(new URL('./publish-generation.ts', import.meta.url).href)});
try { publishGeneration(output, new Map([['index.html', 'new'], ['new.js', 'new asset']])); }
catch (error) { if (point !== 'write-fault' || !error.message.includes('injected rename failure')) throw error; }
`);
  const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fixture], {
    encoding: 'utf8', timeout: 10000,
  });
  if (point === 'write-fault') expect(result.status, result.stderr).toBe(0);
  else expect(result.signal, result.stderr).toBe('SIGKILL');
  return { root, output, journal: join(root, '.out.lumen-publication.json') };
}

it.each(['before-move', 'after-move', 'after-commit', 'cleanup'])('recovers a real SIGKILL at %s without exposing a partial generation', point => {
  const { output, journal } = interruptedPublication(point);
  expect(existsSync(journal)).toBe(true);
  const expected = ['before-move', 'after-move'].includes(point) ? 'old' : 'new';
  expect(recoverGeneration(output)).toBe(expected === 'old' ? 'previous' : 'next');
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe(expected);
  expect(Object.keys(verifyGeneration(output).files).sort()).toEqual(expected === 'old' ? ['index.html', 'retired.js'] : ['index.html', 'new.js']);
  expect(existsSync(journal)).toBe(false);
  publishGeneration(output, new Map([['index.html', 'subsequent']]));
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('subsequent');
});

it('rolls back an actual rename failure and can complete the next build', () => {
  const { output, journal } = interruptedPublication('write-fault');
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('old');
  expect(existsSync(journal)).toBe(false);
  publishGeneration(output, new Map([['index.html', 'recovered']]));
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('recovered');
});

it('retains a committed first generation after a killed first build', () => {
  const { output } = interruptedPublication('after-commit', false);
  expect(recoverGeneration(output)).toBe('next');
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('new');
});

it('fences a live publisher by boot and process birth, and distinguishes a reused PID', () => {
  const { output, journal } = interruptedPublication('before-move');
  const record = JSON.parse(readFileSync(journal, 'utf8'));
  const owner = readProcessLifetime(process.pid);
  if (owner.state !== 'alive') throw new Error('Native identity unavailable');
  record.owner = { pid: process.pid, identity: owner.identity };
  writeFileSync(journal, JSON.stringify(record));
  expect(() => recoverGeneration(output)).toThrow('live process');
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('old');
  record.owner.identity = process.platform === 'linux' ? owner.identity.slice(0, 37) + '0' : owner.identity.split(':utc:')[0] + ':utc:Thu Jan 1 00:00:00 1970';
  writeFileSync(journal, JSON.stringify(record));
  expect(recoverGeneration(output)).toBe('previous');
});

it('rejects forged journal paths and symbolic links without touching unrelated files', () => {
  const { root, output, journal } = interruptedPublication('before-move');
  const record = JSON.parse(readFileSync(journal, 'utf8'));
  const unrelated = join(root, 'unrelated');
  mkdirSync(unrelated);
  writeFileSync(join(unrelated, 'keep.txt'), 'keep');
  writeFileSync(journal, JSON.stringify({ ...record, stage: '../unrelated' }));
  expect(() => recoverGeneration(output)).toThrow('Invalid publication journal');
  writeFileSync(journal, JSON.stringify(record));
  renameSync(join(root, record.stage), join(root, 'saved-stage'));
  symlinkSync(unrelated, join(root, record.stage));
  expect(() => recoverGeneration(output)).toThrow('real directory');
  expect(readFileSync(join(unrelated, 'keep.txt'), 'utf8')).toBe('keep');
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('old');
});

it('completes a verified first generation when killed before its final rename', () => {
  const { output } = interruptedPublication('before-commit', false);
  expect(existsSync(output)).toBe(false);
  expect(recoverGeneration(output)).toBe('next');
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('new');
});

it('restores the previous verified tree if the interrupted new generation is damaged', () => {
  const { output } = interruptedPublication('after-commit');
  writeFileSync(join(output, 'index.html'), 'damaged');
  expect(recoverGeneration(output)).toBe('previous');
  expect(readFileSync(join(output, 'index.html'), 'utf8')).toBe('old');
  expect(verifyGeneration(output).files['retired.js']).toBeDefined();
});
