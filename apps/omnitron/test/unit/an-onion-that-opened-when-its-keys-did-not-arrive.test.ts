/**
 * An onion that opened when its keys did not arrive.
 *
 * Tor's client authorization is a set of files in
 * `<HiddenServiceDir>/authorized_clients/`; without one, the onion answers
 * anyone who has its address. The container wrote them with
 *
 *     apk add --no-cache jq >/dev/null 2>&1 || true
 *     printf '%s' "$JSON" | jq -c '.[]' | while IFS= read -r f; do … done
 *
 * under `set -eu` and no `pipefail`. A missing jq, or JSON it could not
 * read, failed in FRONT of the pipe; the loop read nothing and ended 0, the
 * pipeline's status was the loop's, and `exec tor` started the service with
 * no key in place — fail-open on the one setting whose purpose is to close.
 *
 * This runs the block the preset ships (`CLIENT_AUTH_SHELL`, the same text
 * the entrypoint interpolates) in a real shell, with a PATH built for each
 * case, and asks the one question that matters: did the script reach the
 * line after it — the stand-in for `exec tor` — without every key in place?
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, afterEach } from 'vitest';

import { CLIENT_AUTH_SHELL, torPreset } from '../../src/infrastructure/presets/tor.js';

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-tor-auth-'));
  cleanup.push(dir);
  return dir;
}

/** Where a tool lives on this machine, or null. */
function which(tool: string): string | null {
  const r = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * A bin directory holding only what the block may use: the tools it calls,
 * an `apk` that installs nothing, and jq only when the case says so.
 */
function binWith(options: { jq: boolean }): string {
  const bin = path.join(scratch(), 'bin');
  fs.mkdirSync(bin);
  for (const tool of ['mkdir', 'chmod', 'dirname']) {
    const at = which(tool);
    if (!at) throw new Error(`${tool} is not on this machine`);
    fs.symlinkSync(at, path.join(bin, tool));
  }
  // The container's package manager, unable to fetch anything.
  fs.writeFileSync(path.join(bin, 'apk'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  if (options.jq) {
    const jq = which('jq');
    if (!jq) throw new Error('jq is not on this machine');
    fs.symlinkSync(jq, path.join(bin, 'jq'));
  }
  return bin;
}

/** The entrypoint the preset ships: `sh -c <this>`. */
function shippedEntrypoint(): string {
  return ((torPreset as unknown as { defaultDocker?: { command?: string[] } }).defaultDocker?.command ?? [])[2] ?? '';
}

/**
 * The block as the entrypoint runs it — under the shell options the SHIPPED
 * entrypoint sets before it, read from it rather than restated here — and
 * then the line that starts tor.
 */
function run(json: string | undefined, options: { jq: boolean }) {
  const entrypoint = shippedEntrypoint();
  const before = entrypoint.slice(0, entrypoint.indexOf(CLIENT_AUTH_SHELL));
  const shellOptions = before.split('\n').filter((line) => /^set\s/.test(line)).join('\n');
  const script = `${shellOptions}\n${CLIENT_AUTH_SHELL}\necho TOR-STARTED\n`;
  const env: Record<string, string> = { PATH: binWith(options) };
  if (json !== undefined) env['OMNITRON_TOR_CLIENT_AUTH_JSON'] = json;
  // Its own working directory. A key whose path did not arrive is written to
  // a file named `null` wherever the script stands — the old block did that,
  // and a run of it from here put one in the checkout.
  const cwd = scratch();
  const r = spawnSync('/bin/sh', ['-c', script], { cwd, env, encoding: 'utf8' });
  return { started: r.stdout.includes('TOR-STARTED'), status: r.status, stderr: r.stderr, cwd };
}

function keys(dir: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    path: path.join(dir, 'hs', 'authorized_clients', `client-${i}.auth`),
    content: `descriptor:x25519:${'A'.repeat(52)}${i}`,
  }));
}

describe('an onion that opened when its keys did not arrive', () => {
  it('writes every key where tor reads it, readable by its owner only, and then starts', () => {
    const dir = scratch();
    const files = keys(dir, 2);

    const r = run(JSON.stringify(files), { jq: true });

    expect(r.stderr).toBe('');
    expect(r.started).toBe(true);
    for (const f of files) {
      // `jq -r` ends the line, as it always did here; tor reads the file by line.
      expect(fs.readFileSync(f.path, 'utf8')).toBe(`${f.content}\n`);
      expect(fs.statSync(f.path).mode & 0o777).toBe(0o600);
    }
  });

  it('does not start tor when there is no jq to write the keys', () => {
    const dir = scratch();

    const r = run(JSON.stringify(keys(dir, 2)), { jq: false });

    expect(r.started, 'an onion meant for two clients, open to everyone').toBe(false);
    expect(r.stderr).toMatch(/no jq to write its keys/);
  });

  it('does not start tor when the keys do not parse', () => {
    const r = run('[{"path": "/tmp/x", "content": ', { jq: true });

    expect(r.started).toBe(false);
  });

  it('does not start tor when a key has nowhere to go', () => {
    const r = run(JSON.stringify([{ content: 'descriptor:x25519:AAAA' }]), { jq: true });

    expect(r.started).toBe(false);
    // `jq -r .path` answers `null` for a path that is not there.
    expect(fs.readdirSync(r.cwd), 'the key, in a file named after nothing').toEqual([]);
  });

  it('starts, and writes nothing, for a service with no clients to authorize', () => {
    const r = run(undefined, { jq: false });

    expect(r.started).toBe(true);
    expect(fs.readdirSync(r.cwd)).toEqual([]);
  });

  it('starts, and writes nothing, for an empty list of clients', () => {
    // Not a list omnitron writes — `registry.ts` sets the variable only when
    // there are keys — but one `docker.environment` can. `jq -e '.[]'`
    // answers it with exit 4, and the container stopped without a word.
    const r = run('[]', { jq: true });

    expect(r.stderr).toBe('');
    expect(r.started).toBe(true);
    expect(fs.readdirSync(r.cwd)).toEqual([]);
  });

  it('is the block the preset ships', () => {
    const [shell, flag] = (torPreset as unknown as { defaultDocker?: { command?: string[] } }).defaultDocker?.command ?? [];
    expect([shell, flag]).toEqual(['sh', '-c']);
    // Every case above ran this text under the options read from here.
    expect(shippedEntrypoint()).toContain(CLIENT_AUTH_SHELL);
  });
});
