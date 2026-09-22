/**
 * Running a release's probes ON the node that carries it.
 *
 * The probes exercise a deployed system through `http://localhost:3001` and
 * the stack's own containers. On the node those addresses are the stack; on
 * any other machine they are whatever that machine happens to run — which is
 * how the first attestation of a remote stack «passed» from a laptop, with
 * `token-binding-live` green in two seconds about a server on another
 * continent. So they run where they mean something, over the transport the
 * master already has: SSH with the node's own credentials, under the node's
 * deploy lease so an attestation never interleaves with a deployment.
 *
 * What travels is the release's OWN `scripts/` (the builder carries them
 * since 225cde48) and the stack definition AT THE RELEASE'S COMMIT — never
 * the master's working tree, which by the time anyone attests has usually
 * moved. A release built before the builder carried its scripts gets them
 * from the project's history with `git archive`, which is the same commit by
 * construction.
 *
 * The pure half — the command line, and what an exit means — is here so a
 * court can read it without a node.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { shellEscape } from '../shared/shell-escape.js';

const exec = promisify(execFile);

/** What the producer's exit code means for this side. */
export type AttestRun =
  | { readonly keep: true; readonly stdout: string; readonly allPassed: boolean }
  | { readonly keep: false; readonly because: string };

/**
 * An exit, read as the producer defines it.
 *
 *   0 — every probe passed: keep it.
 *   1 — some did not: KEEP it. A refused probe is a fact about the release
 *       on that stack, and throwing it away would let the next run look like
 *       the first.
 *   2 — the producer itself could not measure: nothing to keep, and the
 *       refusal carries its own words.
 *
 * Anything else — a signal, ssh's own 255 — is the transport, not the
 * producer, and is not kept either.
 */
export function interpretRun(run: { stdout: string; stderr: string; code: number }): AttestRun {
  if (run.code === 0 || run.code === 1) return { keep: true, stdout: run.stdout, allPassed: run.code === 0 };
  const words = (run.stderr.trim() || run.stdout.trim()).split('\n').slice(-6).join('\n');
  if (run.code === 2) {
    return { keep: false, because: `The producer could not measure anything on the node (exit 2):\n${words || '(it said nothing)'}` };
  }
  return {
    keep: false,
    because: `The run on the node ended with exit ${run.code}, which is the transport rather than the producer — nothing was stored.\n${words || '(no output)'}`,
  };
}

/**
 * The command the node runs.
 *
 * The container names are the stack's, handed to the probes that take them
 * from the environment: on the node the infrastructure is `<prefix>-postgres`
 * and so on, where the probes' defaults name the developer's `daos-dev-*`.
 * A probe that ignored these and looked for `daos-dev-postgres` on the node
 * finds nothing — and must then say not-run, which is the producer's floor.
 */
export function attestationCommand(input: {
  remoteDir: string;
  stack: string;
  releaseId: string;
  containerPrefix: string;
}): string {
  const env = {
    DAOS_PG_CONTAINER: `${input.containerPrefix}-postgres`,
    DAOS_REDIS_CONTAINER: `${input.containerPrefix}-redis`,
    DAOS_GATEWAY_CONTAINER: `${input.containerPrefix}-gateway`,
  };
  const assignments = Object.entries(env)
    .map(([k, v]) => `${k}=${shellEscape(v)}`)
    .join(' ');
  // No `--stacks`: the producer refuses an argument it does not know (exit
  // 2, «unknown argument»), and it already finds the stack definition at
  // `scripts/..` — which is where `stageAttestation` puts it.
  return (
    `cd ${shellEscape(input.remoteDir)} && ${assignments} node scripts/attest.mjs ` +
    `--stack=${shellEscape(input.stack)} --on-node --release=${shellEscape(input.releaseId)}`
  );
}

/**
 * The directory that travels: `scripts/` and the stack definition, both at
 * the release's commit.
 *
 * Laid out as the producer expects when it is run from a checkout — the
 * stacks file beside `scripts/`, which is where it reads it from.
 */
export async function stageAttestation(input: {
  releaseRoot: string;
  projectPath: string;
  projectCommit: string;
}): Promise<{ dir: string; scriptsFrom: 'release' | 'history' }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-attest-'));
  const carried = path.join(input.releaseRoot, 'scripts');
  let scriptsFrom: 'release' | 'history';
  if (fs.existsSync(path.join(carried, 'attest.mjs'))) {
    fs.cpSync(carried, path.join(dir, 'scripts'), { recursive: true });
    scriptsFrom = 'release';
  } else {
    // Built before the builder carried them: the commit's own, from history.
    const archive = path.join(dir, 'scripts.tar');
    await exec('git', ['archive', '--format=tar', `--output=${archive}`, input.projectCommit, 'scripts'], {
      cwd: input.projectPath,
      maxBuffer: 64 * 1024 * 1024,
    });
    await exec('tar', ['-xf', archive, '-C', dir]);
    fs.rmSync(archive);
    scriptsFrom = 'history';
  }
  if (!fs.existsSync(path.join(dir, 'scripts', 'attest.mjs'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(
      `The release's commit ${input.projectCommit.slice(0, 8)} has no scripts/attest.mjs — there is no producer to run on the node`,
    );
  }
  const { stdout } = await exec('git', ['show', `${input.projectCommit}:omnitron.stacks.json`], {
    cwd: input.projectPath,
    maxBuffer: 16 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(dir, 'omnitron.stacks.json'), stdout);
  return { dir, scriptsFrom };
}
