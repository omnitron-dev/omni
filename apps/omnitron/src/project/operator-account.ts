/**
 * An operator account on a stack's node — the transport's pure half.
 *
 * A stand needs a named account with the platform's highest role that
 * somebody can sign in with, and a fresh one has only the seed's: on
 * daos/test, `admin` from a migration, whose password is in the project's
 * repository and whose role is not the highest. The project knows how to make
 * an account properly (`scripts/operator-account.mjs`: a captcha from the
 * stand, its answer from the stack's redis, the application's own signup
 * hashing the password, the role through its postgres). What it cannot do
 * from a laptop is reach the node's containers. The master can — SSH with the
 * node's own credentials, under the node's deploy lease, the transport the
 * on-node attestation already uses.
 *
 * The password is generated ON the node and crosses once: the last line of
 * the tool's stdout, into this daemon's vault. Never a command line (the
 * node's process table, this daemon's exec log), never the answer to the
 * caller, a log line or an audit row. `omnitron secret get <key>` reads it,
 * in the operator's own terminal.
 *
 * So stdout is never quoted, by anything here: on a transport failure it may
 * hold the password, and an error is a thing that gets logged. The tool's
 * words for a refusal are on stderr.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { shellEscape } from '../shared/shell-escape.js';

const exec = promisify(execFile);

/** The project's tool, relative to its root. */
export const OPERATOR_ACCOUNT_TOOL = 'scripts/operator-account.mjs';

/** Where the password is kept when the operator names no key. */
export function accountVaultKey(project: string, stack: string, username: string): string {
  return `${project}.${stack}.account.${username}.password`;
}

/**
 * The containers the tool reaches, by the names they have on the node —
 * `<prefix>-postgres`, not the developer's `daos-dev-postgres` the tool
 * defaults to.
 */
function containerEnv(containerPrefix: string): string {
  return Object.entries({
    DAOS_PG_CONTAINER: `${containerPrefix}-postgres`,
    DAOS_REDIS_CONTAINER: `${containerPrefix}-redis`,
  })
    .map(([k, v]) => `${k}=${shellEscape(v)}`)
    .join(' ');
}

/**
 * The make. `--role` and `--display-name` only when the operator gave them:
 * which roles exist, and which one is the default, are the project's to say.
 */
export function operatorAccountCommand(input: {
  remoteDir: string;
  containerPrefix: string;
  username: string;
  role?: string | undefined;
  displayName?: string | undefined;
}): string {
  const flags = [
    `--username=${input.username}`,
    ...(input.role !== undefined ? [`--role=${input.role}`] : []),
    ...(input.displayName !== undefined ? [`--display-name=${input.displayName}`] : []),
  ];
  return (
    `cd ${shellEscape(input.remoteDir)} && ${containerEnv(input.containerPrefix)} ` +
    `node ${OPERATOR_ACCOUNT_TOOL} ${flags.map((f) => shellEscape(f)).join(' ')}`
  );
}

/** The undo: the row with this name AND this id, or nothing. */
export function operatorAccountUndoCommand(input: {
  remoteDir: string;
  containerPrefix: string;
  username: string;
  id: string;
}): string {
  return (
    `cd ${shellEscape(input.remoteDir)} && ${containerEnv(input.containerPrefix)} ` +
    `node ${OPERATOR_ACCOUNT_TOOL} ${shellEscape(`--remove=${input.username}`)} ${shellEscape(`--id=${input.id}`)}`
  );
}

export interface MadeAccount {
  readonly username: string;
  readonly password: string;
  readonly id: string;
  readonly role: string;
}

/** What a run of the make means. */
export type AccountRun =
  | { readonly made: true; readonly account: MadeAccount }
  | {
      readonly made: false;
      readonly because: string;
      /**
       * The account may exist on the stand: the run's outcome is not known
       * (the transport failed, or the tool said nothing this side can read).
       */
      readonly uncertain: boolean;
    };

/** The last lines of what the tool said on stderr — never stdout. */
function wordsOf(stderr: string): string {
  return stderr.trim().split('\n').slice(-4).join(' | ');
}

/**
 * A run, read as the tool defines it.
 *
 *   0 — made: the last line of stdout is `{"operatorAccount": {…}}`.
 *   1 — refused, with the reason on stderr (the name is taken, the stand
 *       would not sign it up, the role did not stick).
 *   2 — the tool refused its arguments.
 *
 * Anything else is the transport — a signal, ssh's own 255 — and says
 * nothing about whether the account was made.
 */
export function readAccountRun(run: { stdout: string; stderr: string; code: number }, username: string): AccountRun {
  if (run.code === 0) {
    const last = run.stdout.trim().split('\n').pop() ?? '';
    let account: Partial<MadeAccount> | undefined;
    try {
      account = (JSON.parse(last) as { operatorAccount?: Partial<MadeAccount> }).operatorAccount;
    } catch {
      account = undefined;
    }
    const whole =
      account &&
      typeof account.password === 'string' &&
      account.password.length > 0 &&
      typeof account.id === 'string' &&
      typeof account.role === 'string' &&
      account.username === username;
    if (whole) {
      const { password, id, role } = account as MadeAccount;
      return { made: true, account: { username, password, id, role } };
    }
    return {
      made: false,
      uncertain: true,
      because:
        `the tool exited 0 without the account line this side reads — ${username} may exist on the stand ` +
        'with a password nobody holds',
    };
  }
  if (run.code === 1) {
    return { made: false, uncertain: false, because: `the stand refused: ${wordsOf(run.stderr) || '(the tool said nothing)'}` };
  }
  if (run.code === 2) {
    return {
      made: false,
      uncertain: false,
      because: `the tool refused its arguments (exit 2): ${wordsOf(run.stderr) || '(it said nothing)'}`,
    };
  }
  return {
    made: false,
    uncertain: true,
    because:
      `exit ${run.code} is the transport, not the tool — whether ${username} was made is not known: ` +
      `${wordsOf(run.stderr) || '(no words)'}`,
  };
}

/**
 * The project's `scripts/` at its HEAD commit, in a directory of its own.
 *
 * The commit, not the working tree: what runs on a stand with the power to
 * hand out its highest role is code somebody committed, and the answer names
 * which. Refused when that commit has no tool.
 */
export async function stageOperatorTool(projectPath: string): Promise<{ dir: string; commit: string }> {
  const { stdout: head } = await exec('git', ['rev-parse', 'HEAD'], { cwd: projectPath });
  const commit = head.trim();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-operator-'));
  try {
    const archive = path.join(dir, 'scripts.tar');
    await exec('git', ['archive', '--format=tar', `--output=${archive}`, commit, 'scripts'], {
      cwd: projectPath,
      maxBuffer: 64 * 1024 * 1024,
    });
    await exec('tar', ['-xf', archive, '-C', dir]);
    fs.rmSync(archive);
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`Could not take scripts/ from the project's commit ${commit.slice(0, 8)}: ${(err as Error).message}`, {
      cause: err,
    });
  }
  if (!fs.existsSync(path.join(dir, OPERATOR_ACCOUNT_TOOL))) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`The project's commit ${commit.slice(0, 8)} has no ${OPERATOR_ACCOUNT_TOOL} — there is no tool to make the account with`);
  }
  return { dir, commit };
}
