/**
 * `kb status` created the knowledge base it was asked about, and reported it
 * empty.
 *
 * Opening a SurrealKV store that is not there creates it:
 * `SurrealKbStore.initialize()` connects, which makes the directory, and
 * applies `KB_SCHEMA`. `kb status` and `kb query` opened it unconditionally.
 * Measured 2026-09-23 with a scratch HOME:
 *
 *     $ omnitron kb status          → Modules 0 … Embeddings 0, exit 0,
 *                                     and a 32 KB `.omnitron/kb.db` behind it
 *     $ omnitron kb query "netron"  → Found 0 results (0 tokens), exit 0
 *
 * Both answers read as «indexed, and nothing matched», which is the one thing
 * that was not true — and on the real HOME both write into `~/.omnitron`.
 *
 * Each test here runs under its own scratch HOME; nothing reaches the real one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const logged: Array<{ level: string; text: string }> = [];

vi.mock('@xec-sh/kit', () => ({
  log: {
    error: (t: string) => logged.push({ level: 'error', text: t }),
    info: (t: string) => logged.push({ level: 'info', text: t }),
    success: (t: string) => logged.push({ level: 'success', text: t }),
    warn: (t: string) => logged.push({ level: 'warn', text: t }),
  },
}));

const { kbStatusCommand, kbQueryCommand } = await import('../../src/commands/kb.js');

const said = () => logged.map((l) => l.text).join('\n');

let home = '';
let homeBefore: string | undefined;
let exitCodeBefore: typeof process.exitCode;

const kbDb = () => path.join(home, '.omnitron', 'kb.db');

/**
 * A store at the path the commands read, written by ANOTHER process.
 *
 * Not from this one: measured 2026-09-23, a SurrealKV path opened, closed and
 * opened again in one process does not answer the second open (20 s, twice,
 * with and without a 5 s pause after `close()`). The CLI opens once per
 * process, so the fixture must too.
 */
function storeInAnotherProcess(fill: 'empty' | 'indexed'): void {
  const kbModule = pathToFileURL(createRequire(import.meta.url).resolve('@omnitron-dev/kb/surreal')).href;
  const script = `
    const { SurrealKbStore } = await import(process.env.KB_MODULE);
    const store = new SurrealKbStore({ url: 'surrealkv://' + process.env.KB_DB });
    await store.initialize();
    if (process.env.KB_FILL === 'indexed') {
      await store.upsertModule({ path: 'titan/netron', package: '@omnitron-dev/titan', name: 'netron',
        summary: '', tags: [], source: 'workspace', tokens: 0 });
      await store.upsertSpecs([{ module: 'titan/netron', title: 'Netron RPC', content: 'Netron is the RPC layer.',
        tags: [], summary: '', filePath: 'kb/specs/netron.md', dependsOn: [], tokens: 6 }]);
    }
    await store.close();
    process.exit(0);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, KB_MODULE: kbModule, KB_DB: kbDb(), KB_FILL: fill },
    stdio: 'pipe',
    timeout: 60_000,
  });
}

beforeEach(() => {
  logged.length = 0;
  homeBefore = process.env['HOME'];
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-kb-home-'));
  process.env['HOME'] = home;
  exitCodeBefore = process.exitCode;
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = exitCodeBefore;
  if (homeBefore === undefined) delete process.env['HOME'];
  else process.env['HOME'] = homeBefore;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('a knowledge base that was never indexed', () => {
  it('status: says so, exits 1, and creates nothing', async () => {
    await kbStatusCommand();

    expect(said()).toMatch(/not indexed/);
    expect(said()).toContain('omnitron kb index');
    expect(said()).not.toMatch(/Modules:/);
    expect(fs.existsSync(kbDb()), 'kb status created the store it was asked about').toBe(false);
    expect(fs.existsSync(path.join(home, '.omnitron'))).toBe(false);
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it('query: says so, exits 1, and creates nothing', async () => {
    await kbQueryCommand('netron');

    expect(said()).toMatch(/not indexed/);
    expect(said()).not.toMatch(/Found 0 results/);
    expect(fs.existsSync(kbDb()), 'kb query created the store it was asked about').toBe(false);
    expect(process.exitCode).toBe(1);
  }, 60_000);

  it('an existing store with no module in it is the same answer', async () => {
    // What the old `kb status` and `kb query` left behind, and what `kb mcp`
    // still creates: the schema, and nothing indexed into it.
    storeInAnotherProcess('empty');
    expect(fs.existsSync(kbDb())).toBe(true);

    await kbStatusCommand();

    expect(said()).toMatch(/not indexed/);
    expect(said()).not.toMatch(/Modules:/);
    expect(process.exitCode).toBe(1);
  }, 60_000);
});

describe('a knowledge base that was indexed', () => {
  it('status reports it, exit 0', async () => {
    storeInAnotherProcess('indexed');

    await kbStatusCommand();

    expect(said()).toMatch(/Modules:\s+1\b/);
    expect(said()).toMatch(/Specs:\s+1\b/);
    // A line that could only ever print `null` is gone rather than kept.
    expect(said()).not.toMatch(/Last indexed/);
    expect(process.exitCode).toBeUndefined();
  }, 60_000);

  it('query answers from it, exit 0', async () => {
    storeInAnotherProcess('indexed');

    await kbQueryCommand('netron');

    expect(said()).toMatch(/Found 1 results/);
    expect(process.exitCode).toBeUndefined();
  }, 60_000);
});
