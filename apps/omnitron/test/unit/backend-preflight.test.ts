import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { transform } from 'esbuild';
import { afterEach, expect, it, vi } from 'vitest';
import { BackendPreflightError, checkBackendCandidate } from '../../src/daemon/backend-candidate.js';
import { runtimeArtifactDigest } from '../../src/shared/runtime-artifact.js';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const execute = promisify(execFile);
const roots: string[] = [];
const stamp = { commit: 'a'.repeat(40), dirty: false, builtAt: '2026-01-01T00:00:00.000Z', timeBasis: 'source' };
const response = { protocol: 1, schemaExpansionProtocol: 1, build: stamp, executionRequirements: { stackControl: 1 } };

afterEach(async () => {
  vi.unstubAllEnvs();
  resetEnvCache();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture(main: string, customEntry?: string) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'omni-preflight-')));
  roots.push(root);
  const runtime = path.join(root, 'runtime'), home = path.join(root, 'home');
  const dist = path.join(runtime, 'packages/0/dist');
  await fs.mkdir(home, { mode: 0o700 });
  await fs.mkdir(path.join(dist, 'daemon'), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(dist, 'shared'), { mode: 0o700 });
  await fs.writeFile(path.join(runtime, 'packages/0/package.json'), '{"type":"module"}', { mode: 0o600 });
  await fs.writeFile(path.join(dist, 'BUILD.json'), JSON.stringify(stamp), { mode: 0o600 });
  // Compile the actual entry boundary; only its imported runtime is controlled
  // to exercise native success, import failure and a genuinely stalled import.
  for (const name of ['daemon/daemon-entry', 'daemon/entry-guard', 'daemon/startup-failure-journal', 'shared/emergency-output']) {
    const source = fileURLToPath(new URL(`../../src/${name}.ts`, import.meta.url));
    const { code } = await transform(await fs.readFile(source, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
    await fs.writeFile(path.join(dist, `${name}.js`), code, { mode: 0o600 });
  }
  const entry = path.join(dist, 'daemon/daemon-entry.js');
  if (customEntry !== undefined) await fs.writeFile(entry, customEntry, { mode: 0o600 });
  await fs.writeFile(path.join(dist, 'daemon/daemon-main.js'), main, { mode: 0o600 });
  const node = path.join(runtime, 'node');
  await fs.copyFile(process.execPath, node, constants.COPYFILE_FICLONE);
  await fs.chmod(node, 0o500);
  const hash = await runtimeArtifactDigest(runtime);
  await fs.writeFile(path.join(runtime, 'RUNTIME.json'), JSON.stringify({ protocol: 1, sha256: hash,
    platform: process.platform, arch: process.arch, nodeVersion: process.version, packages: 1 }), { mode: 0o600 });
  vi.stubEnv('OMNITRON_HOME', home);
  return { root, runtime, dist, home, node, entry, hash };
}

async function failure(dist: string): Promise<BackendPreflightError> {
  try { await checkBackendCandidate(dist); }
  catch (error) {
    expect(error).toBeInstanceOf(BackendPreflightError);
    if (!(error instanceof BackendPreflightError)) throw error;
    return error;
  }
  throw new Error('Preflight unexpectedly admitted the fixture');
}

it('loads the runtime and validates its response without creating application state', async () => {
  const candidate = await fixture(`process.stdout.write(${JSON.stringify(JSON.stringify(response) + '\n')});`);
  const artifact = await checkBackendCandidate(candidate.dist);
  expect(artifact).toMatchObject({ runtimeHash: candidate.hash, build: stamp, schemaExpansionProtocol: 1,
    executionRequirements: { stackControl: 1 } });
  const checked = await execute(candidate.node, [candidate.entry, '--check-backend'], { timeout: 5000 });
  expect(JSON.parse(checked.stdout)).toEqual(response);
  const events = checked.stderr.trim().split('\n').map(line => JSON.parse(line));
  expect(events.map(event => event.phase)).toEqual(['loading-runtime', 'runtime-loaded']);
  expect(events.every(event => event.protocol === 1 && event.event === 'omnitron.backend.preflight' &&
    Number.isSafeInteger(event.pid) && Number.isSafeInteger(event.elapsedMs))).toBe(true);
  expect(await fs.readdir(candidate.home)).toEqual([]);
});

it('does not add preflight records to a normal daemon entry', async () => {
  const candidate = await fixture('process.stdout.write("normal-entry");');
  const checked = await execute(candidate.node, [candidate.entry], { timeout: 5000 });
  expect(checked.stdout).toBe('normal-entry');
  expect(checked.stderr).toBe('');
  expect(await fs.readdir(candidate.home)).toEqual([]);
});

it('accepts a valid response independently of optional diagnostic records', async () => {
  const candidate = await fixture('', `process.stdout.write(${JSON.stringify(JSON.stringify(response) + '\n')});`);
  expect(await checkBackendCandidate(candidate.dist)).toMatchObject({ runtimeHash: candidate.hash, build: stamp });
});

it('retains import failure, verified identity and the phase in a machine-readable error', async () => {
  const candidate = await fixture('await import("./missing-native-dependency.js");');
  const error = await failure(candidate.dist);
  expect(error.domainCode).toBe('BACKEND_PREFLIGHT_PROCESS_FAILED');
  expect(error.code).toBe(500);
  expect(error.details).toMatchObject({ runtimeHash: candidate.hash, phase: 'loading-runtime', timeoutMs: 30_000,
    exitCode: 1, signal: null });
  expect(error.details.pid).toBeGreaterThan(1);
  expect(error.details.elapsedMs).toBeGreaterThan(0);
  expect(error.details.stderr).toContain('missing-native-dependency');
  expect(error.cause).toMatchObject({ code: 1, killed: false });
  expect(JSON.parse(JSON.stringify(error))).toMatchObject({ code: error.code, details: error.details });
  const { serializer } = await import('@omnitron-dev/titan/netron');
  expect(serializer.decode(serializer.encode(error))).toMatchObject({ code: error.code,
    domainCode: error.domainCode, details: error.details, cause: { message: (error.cause as Error).message } });
});

it('ignores malformed, oversized or foreign-PID progress records', async () => {
  const candidate = await fixture('', `
    const valid={event:'omnitron.backend.preflight',protocol:1,pid:process.pid,phase:'runtime-loaded',elapsedMs:1};
    for(const value of [{...valid,protocol:2},{...valid,pid:process.pid+1},{...valid,phase:'verified'},
      {...valid,elapsedMs:-1},{...valid,extra:true},null,[]]) process.stderr.write(JSON.stringify(value)+'\\n');
    process.stderr.write(' '.repeat(600)+JSON.stringify(valid)+'\\n');
    process.exit(7);
  `);
  const error = await failure(candidate.dist);
  expect(error.domainCode).toBe('BACKEND_PREFLIGHT_PROCESS_FAILED');
  expect(error.details).toMatchObject({ phase: 'not-reported', childElapsedMs: null, exitCode: 7 });
});

it('never admits a loaded marker without a valid protocol and build response', async () => {
  const candidate = await fixture('process.stdout.write("not a protocol response");');
  const error = await failure(candidate.dist);
  expect(error.domainCode).toBe('BACKEND_PREFLIGHT_RESPONSE_INVALID');
  expect(error.details).toMatchObject({ runtimeHash: candidate.hash, phase: 'runtime-loaded', exitCode: 0 });
  expect(error.cause).toBeInstanceOf(SyntaxError);
});

it('keeps output limits and bounds retained stderr without calling overflow a timeout', async () => {
  const candidate = await fixture('process.stderr.write("x".repeat(1024*1024+1024));setInterval(()=>{},1000);');
  const error = await failure(candidate.dist);
  expect(error.domainCode).toBe('BACKEND_PREFLIGHT_PROCESS_FAILED');
  expect(error.details.exitCode).toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  expect(Buffer.byteLength(error.details.stderr)).toBeLessThanOrEqual(4096);
});

it('reports and terminates a real stalled import at the unchanged 30-second deadline', async () => {
  const candidate = await fixture(`
    import fs from 'node:fs';
    fs.writeFileSync(process.env.OMNITRON_HOME+'/child.pid',String(process.pid));
    await new Promise(()=>setInterval(()=>{},1000));
  `);
  const error = await failure(candidate.dist);
  const pid = Number(await fs.readFile(path.join(candidate.home, 'child.pid'), 'utf8'));
  expect(error.domainCode).toBe('BACKEND_PREFLIGHT_TIMEOUT');
  expect(error.code).toBe(504);
  expect(error.details).toMatchObject({ runtimeHash: candidate.hash, timeoutMs: 30_000, phase: 'loading-runtime',
    pid, exitCode: null, signal: 'SIGTERM' });
  expect(error.details.elapsedMs).toBeGreaterThanOrEqual(30_000);
  expect(error.cause).toMatchObject({ killed: true, signal: 'SIGTERM' });
  expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
}, 45_000);

it('retains the native preflight failure through the ordinary backend install JSON command', async () => {
  const candidate = await fixture('await import("./missing-command-dependency.js");');
  resetEnvCache();
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
  const { backendInstallCommand } = await import('../../src/commands/backend.js');
  const previousExit = process.exitCode;
  const output: string[] = [];
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { output.push(String(chunk)); return true; });
  try {
    await backendInstallCommand(candidate.runtime);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(output.join(''))).toMatchObject({ ok: false, code: 500,
      error: expect.stringContaining('Backend preflight failed'),
      details: { domainCode: 'BACKEND_PREFLIGHT_PROCESS_FAILED', runtimeHash: candidate.hash, phase: 'loading-runtime' } });
  } finally {
    stderr.mockRestore();
    process.exitCode = previousExit;
  }
});
