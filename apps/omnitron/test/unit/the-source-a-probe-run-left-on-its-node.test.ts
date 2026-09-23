/**
 * The source a probe run left on its node, and nothing said so.
 *
 * An attestation ships the release's probes to the node together with the
 * application's source, runs them there, and removes the stage:
 *
 *     await this.deployer
 *       .runOnNode(target, `rm -rf <stage> <stage>.delivered`, 60_000)
 *       .catch(() => undefined);
 *
 * `runOnNode` does not throw on a failed command — a probe's exit code is
 * information, so it hands back `{ code }` — and the transport under it does
 * not throw either: an SSH connection that fails comes back as `exit 1` with
 * the error in stderr. The `.catch` waited for a throw that could not come.
 * An `rm` the node refused left the application's source under
 * `/opt/omnitron/attest/`, where nothing else ever removes it, and the
 * attestation finished without a word.
 *
 * This runs the real `attestOnNode` against a node whose answers are
 * scripted, through the real `runOnNode`, so a failed `rm` arrives exactly
 * as the transport delivers one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';

// Which release, and the stage built from it, are not what is judged here.
vi.mock('../../src/release/load.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/release/load.js')>()),
  loadRelease: async () => ({ root: '/nowhere', manifest: { project: { commit: 'c0ffee' } } }),
}));
vi.mock('../../src/release/attest-on-node.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/release/attest-on-node.js')>()),
  stageAttestation: async () => ({
    dir: (await import('node:fs')).mkdtempSync(
      (await import('node:path')).join((await import('node:os')).tmpdir(), 'omnitron-attest-stage-'),
    ),
    scriptsFrom: 'release' as const,
    sourceFiles: 212,
  }),
}));

import { ProjectService } from '../../src/services/project.service.js';
import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';

const STAGE = '/opt/omnitron/attest/0123456789abcdef';

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

type Said = { level: string; msg: string; fields: Record<string, unknown> };

/**
 * An attestation of daos/test on one node, whose SSH answers the probes with
 * a pass and the `rm` afterwards as `rm` says.
 */
function attestation(rm: (command: string) => { stdout: string; stderr: string; exitCode: number }) {
  const said: Said[] = [];
  const at = (level: string) => (a: unknown, b?: string) =>
    said.push({ level, fields: typeof a === 'object' && a ? (a as Record<string, unknown>) : {}, msg: typeof a === 'string' ? a : (b ?? '') });
  const logger: any = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace() {}, fatal() {}, child: () => logger };

  const sent: string[] = [];
  const execution: any = {
    ssh: async (_target: unknown, command: string) => {
      sent.push(command);
      if (command.startsWith('rm -rf')) return { ...rm(command), duration: 1 };
      // The probes' line, as the node sends it back through the data channel.
      const probes = '{"passed":3,"failed":0}';
      return {
        stdout: command.startsWith('out=$(sh -c ') ? Buffer.from(probes).toString('hex') : probes,
        stderr: '',
        exitCode: 0,
        duration: 1,
      };
    },
  };
  const deployer: any = new RemoteDeployer(logger, execution);
  // The lease and the upload are judged elsewhere; here they only happen.
  deployer.underLease = async (_target: unknown, _purpose: string, work: () => Promise<unknown>) => work();
  deployer.uploadStaticBundle = async () => ({ remoteDir: STAGE, bytes: 1 });

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-attest-project-'));
  cleanup.push(project);
  const stateStore: any = { save() {}, load: () => null, get: () => null, set() {} };
  const svc: any = new ProjectService(logger, { list: () => [], listHandleNames: () => [] } as never, stateStore);
  svc.deployer = deployer;
  svc.registry = { get: () => ({ path: project }) };
  svc.loadProjectConfig = async () => ({});
  svc.resolveStacks = () => ({ test: { type: 'remote', nodes: [{ host: '10.0.0.9' }] } });
  svc.releaseStore = async () => '/nowhere';
  svc.targetForStackNode = async () => ({ host: '10.0.0.9', username: 'deploy' });

  return {
    run: () => (svc as ProjectService).attestOnNode('daos', 'test', 'daos-202609230000-c0ffee00'),
    said,
    sent,
    deployer,
  };
}

/** What the probes measured, as the attestation hands it back. */
const measured = {
  stdout: '{"passed":3,"failed":0}',
  stderr: '',
  code: 0,
  node: '10.0.0.9:22',
  scriptsFrom: 'release',
  sourceFiles: 212,
  accounts: 'not-declared',
};

const left = (said: Said[]) => said.filter((s) => s.msg.startsWith('The release\'s source is still on the node'));

describe('the source a probe run left on its node', () => {
  it('is said, with where it is and why, when the node refused the rm', async () => {
    const a = attestation(() => ({
      stdout: '',
      stderr: `rm: cannot remove '${STAGE}/apps/main/src': Permission denied`,
      exitCode: 1,
    }));

    const result = await a.run();

    expect(result, 'the probes measured this; the rm measured none of it').toEqual(measured);
    // The producer's line is evidence: it comes back through the data
    // channel, past the transport's masker (a-record-the-transport-rewrote).
    expect(a.sent.find((c) => !c.startsWith('rm -rf'))).toMatch(/^out=\$\(sh -c /);
    const line = left(a.said);
    expect(line).toHaveLength(1);
    expect(line[0]!.level).toBe('warn');
    expect(line[0]!.fields).toMatchObject({ node: '10.0.0.9:22', remoteDir: STAGE, code: 1 });
    expect(line[0]!.fields['reason']).toMatch(/Permission denied/);
  });

  it('is said when the node dropped before the rm — which the transport answers with an exit code, not a throw', async () => {
    const a = attestation(() => ({ stdout: '', stderr: 'Timed out while waiting for handshake', exitCode: 1 }));

    const result = await a.run();

    expect(result).toEqual(measured);
    expect(left(a.said).map((s) => s.fields['reason'])).toEqual(['Timed out while waiting for handshake']);
  });

  it('is said, and the result still returned, by a runOnNode that throws', async () => {
    const a = attestation(() => ({ stdout: '', stderr: '', exitCode: 0 }));
    const real = a.deployer.runOnNode.bind(a.deployer);
    a.deployer.runOnNode = async (target: unknown, command: string, timeout?: number) => {
      if (command.startsWith('rm -rf')) throw new Error('socket hang up');
      return real(target, command, timeout);
    };

    const result = await a.run();

    expect(result, 'a failure in the finally must not replace what it guards').toEqual(measured);
    expect(left(a.said).map((s) => [s.level, s.fields['reason']])).toEqual([['warn', 'socket hang up']]);
  });

  it('is not said when the stage and its marker are gone', async () => {
    const a = attestation(() => ({ stdout: '', stderr: '', exitCode: 0 }));

    await a.run();

    // The rm was sent, for both, so the silence below is about something.
    const rm = a.sent.filter((c) => c.startsWith('rm -rf'));
    expect(rm).toEqual([`rm -rf '${STAGE}' '${STAGE}.delivered'`]);
    expect(left(a.said)).toEqual([]);
  });
});
