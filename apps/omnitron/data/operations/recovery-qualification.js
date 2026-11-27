/** Installed qualification worker. Its only input is the admitted JSON document on stdin. */
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ExecutionEngine } from '@xec-sh/core';
import { check, checkObservation, checkObservations, digest, encoded, parseStrict, phases } from './recovery-observations.js';
import { stageInputs } from './recovery-input-store.js';

const runtimeFile = fileURLToPath(new URL('./runtime-identity.js', import.meta.url));
const isolation = ['--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
  '--user=65532:65532', '--log-driver=none', '--no-healthcheck'];
const clean = ['/usr/bin/env', '-i', 'PATH=/usr/bin:/bin'];

async function localSocket() {
  for (const candidate of ['/run/user/' + process.getuid() + '/docker.sock', '/var/run/docker.sock']) {
    const node = await lstat(candidate).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (node?.isSocket()) return 'unix://' + candidate;
  }
  throw Error('Local QA Docker socket unavailable');
}

/** Docker only receives fixed operations and resource names generated for this run. */
export async function exercise(spec, roles, probe, docker, signal) {
  const image = spec.probe.image;
  check(typeof image === 'string' && /^sha256:[0-9a-f]{64}$/.test(image), 'Expected pinned QA image digest');
  const info = parseStrict(await docker(['image', 'inspect', '--format', '{{json .}}', image]));
  check(info.Id === image && info.Os === 'linux' && !Object.keys(info.Config?.Volumes ?? {}).length,
    'Expected pinned Linux image without implicit writable volumes');
  async function removeContainer(name) {
    const present = async () => (await docker(['ps', '-aq', '--filter', 'name=^/' + name + '$'], { cleanup: true })).length > 0;
    if (await present()) {
      try { await docker(['rm', '-f', name], { cleanup: true }); }
      catch (error) { if (await present()) throw error; }
    }
  }
  const measurement = 'omni-runtime-' + randomUUID();
  let runtime;
  try {
    runtime = parseStrict(await docker(['run', '--rm', '--name', measurement, ...isolation,
      '--pids-limit=16', '--memory=256m', '--memory-swap=256m', '--cpus=1',
      '--mount', 'type=bind,readonly,src=' + runtimeFile + ',dst=/runtime.mjs',
      '--entrypoint=/usr/bin/timeout', image, '--signal=KILL', '15', ...clean, '/usr/bin/node', '/runtime.mjs'], { timeout: 20_000 }));
  } finally { await removeContainer(measurement); }
  for (const role of Object.values(roles)) {
    const target = role.manifest.builtWith.target;
    check(isDeepStrictEqual(target, runtime) && target.platform === 'linux' && ['x64','arm64'].includes(target.arch) &&
      info.Architecture === ({ x64: 'amd64', arm64: 'arm64' })[target.arch] && /^[a-f0-9]{64}$/.test(target.executableSha256),
    'QA executable, platform, ABI or libc differs from the release');
  }
  const values = {}, summaries = [], challenge = randomBytes(24).toString('hex');
  for (const [scenario, steps] of Object.entries(phases)) {
    signal.throwIfAborted();
    values[scenario] = {};
    const volume = 'omni-qualification-' + randomUUID(), holder = volume + '-holder';
    try {
      // The holder keeps this specific tmpfs mounted between application generations.
      await docker(['volume', 'create', '--driver', 'local', '--opt', 'type=tmpfs', '--opt', 'device=tmpfs',
        '--opt', 'o=size=1536m,nosuid,nodev,mode=1777', volume]);
      await docker(['run', '-d', '--rm', '--name', holder, ...isolation, '--pids-limit=4',
        '--memory=16m', '--memory-swap=16m', '--cpus=0.1', '--mount', 'type=volume,readonly,src=' + volume + ',dst=/state,volume-nocopy',
        '--entrypoint=/usr/bin/sleep', image, '1750']);
      for (const [phase, role] of steps) {
        signal.throwIfAborted();
        const name = 'omni-probe-' + randomUUID();
        const request = { protocol: 1, scenario, phase, challenge, recordSets: spec.probe.recordSets, addedMigrations: spec.addedMigrations,
          releaseId: spec[role].id, manifestSha256: spec[role].manifestSha256 };
        try {
          const raw = await docker(['run', '--rm', '--name', name, ...isolation, '--pids-limit=160', '--memory=3g', '--memory-swap=3g',
            '--cpus=2', '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m,mode=1777', '--mount', 'type=bind,readonly,src=' + roles[role].root + ',dst=/input',
            '--mount', 'type=bind,readonly,src=' + probe + ',dst=/probe.py', '--mount', 'type=volume,src=' + volume + ',dst=/state,volume-nocopy',
            '--env', 'HOME=/tmp', '--entrypoint=/usr/bin/timeout', '-i', image, '--signal=KILL', '155', ...clean, 'HOME=/tmp',
            '/usr/bin/python3', '-I', '-B', '/probe.py'], { request, timeout: 165_000 });
          const observation = checkObservation(parseStrict(raw), request);
          values[scenario][phase] = observation;
          summaries.push({ phase: scenario + '/' + phase, sha256: digest(encoded(observation)) });
        } catch (error) { throw Error(scenario + '/' + phase + ': ' + error.message, { cause: error }); }
        finally { await removeContainer(name); }
      }
    } finally {
      try { await removeContainer(holder); }
      finally { await docker(['volume', 'rm', '--force', volume], { cleanup: true }); }
    }
  }
  checkObservations(values, spec.addedMigrations, roles.incumbent.manifest.migrations);
  return { protocol: 1, challenge, phases: summaries };
}

async function main(signal) {
  check(process.platform === 'linux', 'Linux QA node required');
  check(process.argv.length === 2, 'Expected one bounded local JSON request');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    check(bytes <= 96 * 1024, 'Expected one bounded local JSON request');
    chunks.push(chunk);
  }
  const spec = parseStrict(Buffer.concat(chunks));
  process.umask(0o022);
  const home = homedir(), scratch = await mkdtemp('/var/tmp/omnitron-recovery-');
  const engine = new ExecutionEngine({ defaultTimeout: 0 });
  try {
    const { roles, probe } = await stageInputs(home, scratch, spec, signal);
    const host = await localSocket();
    const docker = async (args, { request, timeout = 15_000, cleanup = false } = {}) => {
      if (!cleanup) signal.throwIfAborted();
      const response = await engine.execute({ command: '/usr/bin/docker', args: ['--host', host, ...args], shell: false, adapter: 'local',
        stdin: request ? encoded(request) : '', timeout, ...(cleanup ? {} : { signal }),
        envMode: 'replace', env: { PATH: '/usr/bin:/bin', HOME: home, LC_ALL: 'C' }, stderr: 'ignore',
        maxBuffer: 512 * 1024, encoding: 'latin1', nothrow: true });
      check(response.exitCode === 0, 'QA Docker command failed: ' + args[0]);
      return Buffer.from(response.stdout, 'latin1');
    };
    const receipt = await exercise(spec, roles, probe, docker, signal);
    process.stdout.write(JSON.stringify({ ...receipt, inputs: digest(Buffer.concat(chunks)) }) + '\n');
  } finally {
    try { await engine.dispose(); } finally { await rm(scratch, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  try { await main(controller.signal); }
  catch (error) {
    process.stderr.write('Recovery qualification failed: ' + String(error.message || error).slice(0, 300) + '\n');
    process.exitCode = 1;
  } finally {
    process.off('SIGTERM', cancel);
    process.off('SIGINT', cancel);
  }
}
