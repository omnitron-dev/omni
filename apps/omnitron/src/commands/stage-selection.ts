import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { RuntimeInstallation } from '../daemon/runtime-installation.js';
import { managedJobPid, readManagedRuntime, verifyManagedIsolation } from '../daemon/managed-runtime.js';
import { stageSelectionChecks, stageSelectionRefusals, validStageSelection } from '../shared/stage-selection.js';
import type { StageSelection } from '../shared/dto/nodes.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = /^[a-f0-9]{64}$/;

// The child never receives a lease bearer, filesystem handle, caller-selected command or root pathname.
type Request = { stage: 'open'; scope: string } | { stage: 'confirm'; challenge: string } | { stage: 'finished' };
type Reply = { stage: 'ready' } | { stage: 'selected'; selection: StageSelection; home: string; pids: number[] } |
  { stage: 'confirmed'; challenge: string } | { stage: 'error'; reason: string };

/** The callback confirms a specific incident and fsyncs its root-owned decision while the service UID holds its own selection lease. */
export async function withStageSelection<T>(scope: string, work: (selection: StageSelection, confirm: (challenge: string) => Promise<void>) => Promise<T>): Promise<T> {
  if (!digest.test(scope)) throw Error('Invalid stage selection scope');
  const worker = fork(fileURLToPath(import.meta.url), ['--stage-selection'], { execPath: process.execPath, execArgv: [],
    env: { PATH: '/usr/bin:/bin', HOME: '/root', LC_ALL: 'C' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let deadline: NodeJS.Timeout | undefined;
  let listener: ((message: unknown) => void) | undefined;
  const end = new Promise<void>((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', code => code === 0 ? resolve() : reject(Error('Stage selection process exited before confirmation')));
  });
  void end.catch(() => {});
  const exchange = async (request?: Request): Promise<Reply> => {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        new Promise<Reply>((resolve, reject) => {
          listener = input => {
            const reply = input as Reply;
            if (reply?.stage === 'error') reject(Error(stageSelectionRefusals.includes(reply.reason) ? reply.reason : 'Could not verify the native service selection'));
            else resolve(reply);
          };
          worker.once('message', listener);
          if (request) worker.send(request, error => { if (error) reject(error); });
        }),
        end.then(() => { throw Error('Selection holder exited before replying'); }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(Error('Selection confirmation timed out')), 12_000); }),
      ]);
    } finally { if (listener) worker.off('message', listener); if (timeout) clearTimeout(timeout); }
  };
  try {
    if ((await exchange()).stage !== 'ready') throw Error('Administrative selection worker is unavailable');
    const selected = await exchange({ stage: 'open', scope });
    if (selected.stage !== 'selected' || !validStageSelection(selected.selection) || !Array.isArray(selected.pids) || selected.pids.length !== 2 ||
        typeof selected.home !== 'string' || hash(selected.home) !== selected.selection.homeSha256 || fs.realpathSync(selected.home) !== selected.home)
      throw Error('Invalid managed runtime selection response');
    // A systemd BindPaths can make the same pathname name a different registry inside the unit.
    const db = join(selected.home, 'runtime/state.db');
    const stat = fs.lstatSync(db, { bigint: true });
    for (const pid of selected.pids) {
      if (!Number.isSafeInteger(pid) || pid <= 1 || fs.statSync('/proc/' + pid).uid !== selected.selection.uid) throw Error('Unverified managed service process');
      const seen = fs.statSync(join('/proc', String(pid), 'root', db), { bigint: true });
      if (seen.dev !== stat.dev || seen.ino !== stat.ino) throw Error('The supervisor and enrolled account see different runtime registries');
    }
    const result = await work(selected.selection, async challenge => {
      if (!digest.test(challenge)) throw Error('Invalid stage challenge');
      const answer = await exchange({ stage: 'confirm', challenge });
      if (answer.stage !== 'confirmed' || answer.challenge !== challenge) throw Error('Unconfirmed stage selection');
    });
    worker.send({ stage: 'finished' } satisfies Request);
    await Promise.race([end, new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(Error('Selection holder did not finish')), 12_000);
    })]);
    return result;
  } finally {
    if (deadline) clearTimeout(deadline);
    if (worker.connected) worker.disconnect();
  }
}

async function serve(check: (phase: keyof typeof stageSelectionChecks) => void) {
  if (process.platform !== 'linux' || process.getuid!() !== 0 || !process.send) throw Error('Requires the administrative Linux runtime');
  const { enterManagedInstance } = await import(new URL('../../data/operations/managed-account.mjs', import.meta.url).href);
  await RuntimeInstallation.preloadExclusive();
  check('account');
  const { home } = enterManagedInstance('/root/.omnitron') as { home: string };
  process.env['PATH'] = '/usr/bin:/bin';
  const receive = () => new Promise<Request>((resolve, reject) => {
    const cancel = () => { cleanup(); reject(Error('Maintenance parent disconnected')); };
    const next = (request: unknown) => { cleanup(); resolve(request as Request); };
    const timer = setTimeout(cancel, 15_000);
    function cleanup() { clearTimeout(timer); process.off('disconnect', cancel); process.off('message', next); }
    process.once('disconnect', cancel); process.once('message', next);
    if (!process.connected) cancel();
  });
  const opened = receive();
  process.send({ stage: 'ready' } satisfies Reply);
  const start = await opened;
  if (start?.stage !== 'open' || !digest.test(start.scope)) throw Error('Invalid stage scope');
  check('supervisor');
  const config = await readManagedRuntime(home);
  if (!config) throw Error('No enrolled managed supervisor');
  check('processes');
  const pids = await Promise.all([managedJobPid(config, 'owner'), managedJobPid(config, 'backend')]);
  await verifyManagedIsolation(config, pids[0], pids[1]);
  for (const [job, pid] of [['owner', pids[0]], ['backend', pids[1]]] as const) {
    if (fs.realpathSync('/proc/' + pid + '/exe') !== join(home, 'runtime/releases', config[job].artifact, 'node'))
      throw Error('The managed service process differs from its enrolled runtime');
  }
  check('registry');
  const runtime = await RuntimeInstallation.open(home, { existing: true });
  if (!runtime) throw Error('No installed runtime');
  check('lease');
  try {
    await runtime.exclusive(async () => {
      const value = runtime.selection();
      if (!value) throw Error('The enrolled service account has no selected runtime');
      const selection: StageSelection = { uid: process.getuid!(), gid: process.getgid!(), homeSha256: hash(home),
        current: value.current, revision: value.revision, selectionSha256: hash(JSON.stringify(value)) };
      const confirmation = receive();
      process.send!({ stage: 'selected', home, pids, selection } satisfies Reply);
      const confirm = await confirmation;
      if (confirm.stage !== 'confirm' || !digest.test(confirm.challenge) || !isDeepStrictEqual(value, runtime.selection()) || runtime.activation())
        throw Error('Selection changed before stage confirmation');
      runtime.confirmStageSelection(start.scope, confirm.challenge, value);
      const finish = receive();
      process.send!({ stage: 'confirmed', challenge: confirm.challenge } satisfies Reply);
      if ((await finish).stage !== 'finished') throw Error('Stage decision was not acknowledged');
    }, { stageFenceScope: start.scope });
  } finally { await runtime.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--stage-selection') {
  let phase: keyof typeof stageSelectionChecks = 'runtime';
  try { await serve(next => { phase = next; }); } catch (error) {
    const reason = error instanceof Error && stageSelectionRefusals.includes(error.message) ? error.message : stageSelectionChecks[phase];
    if (process.connected) process.send?.({ stage: 'error', reason } satisfies Reply);
    process.exitCode = 1;
  } finally { if (process.connected) process.disconnect?.(); }
}
