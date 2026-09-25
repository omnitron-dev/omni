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
 * The password is generated ON the node and comes back SEALED — RSA-OAEP to a
 * key this daemon makes for the one run and never writes down (`sealingKey`)
 * — and is opened only to go into the vault. `omnitron secret get <key>`
 * reads it, in the operator's own terminal.
 *
 * Sealed because the transport rewrites what looks like a secret. Every
 * stdout the SSH layer returns passes through its masker, and
 * `"password":"…"` comes back as `"password": [REDACTED]` — measured on
 * daos/test, 2026-09-23: the first account made this way was made, the tool
 * said so with exit 0, and the line carrying its password arrived as a line
 * that was no longer JSON. It was refused, rightly — a masker that had kept
 * the JSON valid would have put the string `[REDACTED]` in the vault — and
 * the account stayed on the stand with a password nobody could ever read.
 * A sealed password is nothing a masker recognises, and nothing any log that
 * kept the line could use.
 *
 * Even so, a make's stdout is never quoted here: an answer this side cannot
 * read is described by its shape, not its content.
 */

import { execFile } from 'node:child_process';
import { constants, generateKeyPair, privateDecrypt } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { shellEscape } from '../shared/shell-escape.js';
import { standContainerAssignments } from './stand-containers.js';

const exec = promisify(execFile);

/** The project's tool, relative to its root. */
export const OPERATOR_ACCOUNT_TOOL = 'scripts/operator-account.mjs';

/** Where the password is kept when the operator names no key. */
export function accountVaultKey(project: string, stack: string, username: string): string {
  return `${project}.${stack}.account.${username}.password`;
}

/**
 * A key for one run: its public half goes to the tool as `--seal-to`, its
 * private half stays in this process and opens the one value sealed to it.
 * Generated asynchronously — a 3072-bit key takes long enough to notice on
 * the daemon's event loop.
 */
export interface SealingKey {
  /** Base64 SPKI DER — what `--seal-to` takes. Public. */
  readonly spki: string;
  open(sealed: string): string;
}

export async function sealingKey(): Promise<SealingKey> {
  const { publicKey, privateKey } = await promisify(generateKeyPair)('rsa', { modulusLength: 3072 });
  return {
    spki: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    open: (sealed) =>
      privateDecrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        Buffer.from(sealed, 'base64'),
      ).toString('utf8'),
  };
}

/** The command the tool runs as on the node, the stand's containers named as they are there. */
export function toolCommand(remoteDir: string, containerPrefix: string, flags: readonly string[]): string {
  return (
    `cd ${shellEscape(remoteDir)} && ${standContainerAssignments(containerPrefix)} ` +
    `node ${OPERATOR_ACCOUNT_TOOL} ${flags.map((f) => shellEscape(f)).join(' ')}`
  );
}

/**
 * The make. `--role` and `--display-name` only when the operator gave them:
 * which roles exist, and which one is the default, are the project's to say.
 * `--seal-to` always.
 */
export function operatorAccountCommand(input: {
  remoteDir: string;
  containerPrefix: string;
  username: string;
  role?: string | undefined;
  displayName?: string | undefined;
  sealTo: string;
}): string {
  return toolCommand(input.remoteDir, input.containerPrefix, [
    `--username=${input.username}`,
    ...(input.role !== undefined ? [`--role=${input.role}`] : []),
    ...(input.displayName !== undefined ? [`--display-name=${input.displayName}`] : []),
    `--seal-to=${input.sealTo}`,
  ]);
}

/** What the stand holds under a name — read, never a secret. */
export function operatorAccountShowCommand(input: { remoteDir: string; containerPrefix: string; username: string }): string {
  return toolCommand(input.remoteDir, input.containerPrefix, [`--show=${input.username}`]);
}

/** What the stand holds in aggregate — counts, never a value. */
export function operatorCensusCommand(input: { remoteDir: string; containerPrefix: string }): string {
  return toolCommand(input.remoteDir, input.containerPrefix, ['--census']);
}

/** The row with this name AND this id, or nothing. */
export function operatorAccountRemoveCommand(input: {
  remoteDir: string;
  containerPrefix: string;
  username: string;
  id: string;
}): string {
  return toolCommand(input.remoteDir, input.containerPrefix, [`--remove=${input.username}`, `--id=${input.id}`]);
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
       * (the transport failed, or the tool said something this side cannot
       * read). The caller asks the stand (`--show`) before it says anything
       * more.
       */
      readonly uncertain: boolean;
    };

/** The last lines of what the tool said on stderr. */
function wordsOf(stderr: string): string {
  return stderr.trim().split('\n').slice(-4).join(' | ');
}

/**
 * The last line of stdout that is a JSON object with this key, searched from
 * the end — as `parseAttestation` reads a producer: the answer is one object
 * on one line, and a line after it (a transport's, a runtime's warning) does
 * not hide it.
 */
function answerLine(stdout: string, key: string): Record<string, unknown> | undefined {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]!.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(lines[i]!) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && key in parsed) return parsed;
    } catch {
      // Not this line.
    }
  }
  return undefined;
}

/**
 * What stdout looked like, without what it said: how many lines, and of the
 * last whether it is JSON. A make's stdout is never quoted — see the head of
 * this file.
 */
export function describeStdout(stdout: string): string {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return 'stdout was empty';
  const last = lines[lines.length - 1]!;
  let what: string;
  try {
    const parsed = JSON.parse(last) as unknown;
    what = parsed && typeof parsed === 'object' ? `is a JSON object with ${Object.keys(parsed).join(', ') || 'no keys'}` : 'is JSON, not an object';
  } catch {
    what = last.startsWith('{') ? 'starts like JSON and does not parse' : 'is not JSON';
  }
  return `stdout had ${lines.length} line(s); the last, ${last.length} characters, ${what}`;
}

/**
 * A run of the make, read as the tool defines it.
 *
 *   0 — made: the answer line is `{"operatorAccount": {username, id, role,
 *       sealed}}`, and `sealed` opens with this run's key.
 *   1 — refused, with the reason on stderr (the name is taken, the stand
 *       would not sign it up, the role did not stick).
 *   2 — the tool refused its arguments — among them a tool too old to know
 *       `--seal-to`, which refuses before it makes anything.
 *
 * Anything else is the transport — a signal, ssh's own 255 — and says
 * nothing about whether the account was made. A `password` on the line is
 * never read: through this transport it is `[REDACTED]` at best.
 */
export function readAccountRun(
  run: { stdout: string; stderr: string; code: number },
  username: string,
  open: (sealed: string) => string,
): AccountRun {
  if (run.code === 0) {
    const account = answerLine(run.stdout, 'operatorAccount')?.['operatorAccount'] as
      | { username?: unknown; id?: unknown; role?: unknown; sealed?: unknown }
      | undefined;
    const unknownOutcome = (why: string): AccountRun => ({
      made: false,
      uncertain: true,
      because: `the tool exited 0, but ${why} — ${username} may be on the stand with a password nobody holds`,
    });
    if (!account || typeof account !== 'object') return unknownOutcome(`no account line could be read (${describeStdout(run.stdout)})`);
    if (account.username !== username) return unknownOutcome('its account line names another account');
    if (typeof account.id !== 'string' || typeof account.role !== 'string') return unknownOutcome('its account line has no id or role');
    if (typeof account.sealed !== 'string' || account.sealed.length === 0) {
      return unknownOutcome('its account line carries no sealed password');
    }
    let password: string;
    try {
      password = open(account.sealed);
    } catch {
      return unknownOutcome("the sealed password does not open with this run's key");
    }
    if (password.length === 0) return unknownOutcome('the sealed password opened to nothing');
    return { made: true, account: { username, password, id: account.id, role: account.role } };
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

/** An account as the stand holds it — no secret in it. */
export interface StandAccount {
  readonly username: string;
  readonly id: string;
  readonly role: string;
  readonly status: string | null;
  readonly createdAt: string | null;
  /** `null`: nobody has signed in with it. */
  readonly lastActiveAt: string | null;
}

/**
 * A run of `--show`. Its stdout carries no secret, so an answer this side
 * cannot read is quoted — the one place here that does.
 */
export function readShowRun(
  run: { stdout: string; stderr: string; code: number },
): { readonly ok: true; readonly account: StandAccount | null } | { readonly ok: false; readonly because: string } {
  if (run.code === 0) {
    const answer = answerLine(run.stdout, 'operatorAccountShown');
    if (answer) {
      const shown = answer['operatorAccountShown'] as {
        username?: unknown;
        id?: unknown;
        role?: unknown;
        status?: unknown;
        createdAt?: unknown;
        lastActiveAt?: unknown;
      } | null;
      if (shown === null) return { ok: true, account: null };
      if (shown && typeof shown.id === 'string' && typeof shown.username === 'string') {
        const text = (v: unknown) => (typeof v === 'string' ? v : null);
        return {
          ok: true,
          account: {
            username: shown.username,
            id: shown.id,
            role: text(shown.role) ?? '(none)',
            status: text(shown.status),
            createdAt: text(shown.createdAt),
            lastActiveAt: text(shown.lastActiveAt),
          },
        };
      }
    }
    return { ok: false, because: `the tool exited 0 with nothing this side can read: ${run.stdout.trim().slice(-300) || '(empty)'}` };
  }
  return { ok: false, because: `exit ${run.code}: ${wordsOf(run.stderr) || '(no words)'}` };
}

/** The stand's accounts, counted — the tool's `--census`. */
export interface StandCensus {
  readonly users: number;
  readonly byRole: Readonly<Record<string, number>>;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly mfa: {
    readonly totpEnabled: number;
    /** `enc:v1:` — sealed under the root MFA keys are derived from; a new root cannot open them. */
    readonly totpSecretEncrypted: number;
    readonly totpSecretPlain: number;
    readonly backupCodes: number;
  };
  readonly seededAdmin: {
    readonly present: boolean;
    /** The row's status, or `deleted` when it was soft-deleted. */
    readonly status: string | null;
    readonly role: string | null;
    /** Whether it still opens with the password its seed published; `null` when the stand cannot check. */
    readonly publishedPassword: boolean | null;
  };
  /**
   * Every account above «user» that is not deleted. Absent from a tool that
   * predates it — the project's own, taken from its HEAD — and said so.
   */
  readonly privileged?: {
    readonly accounts: number;
    /** `YYYY-MM-DD` (UTC) → how many were made that day. */
    readonly byCreatedDay: Readonly<Record<string, number>>;
    /** How many open with a password the repository publishes; `null` when the stand cannot check. */
    readonly openWithPublishedPassword: number | null;
    /** How many were ever signed into, as far as the stand's sign-in log and sessions keep. */
    readonly signedIn: number;
  };
  /** What rotating the stand's JWT_SECRET would take away besides sessions. */
  readonly keyedOnJwtSecret?: {
    /** Pickup codes a buyer holds that a new key could not find, by method. */
    readonly pickupCodesLive: Readonly<Record<string, number>>;
  };
  /**
   * Counts the project's tool names by the question each answers — printed as
   * they come, so the next question is the tool's to add and needs nothing here.
   */
  readonly counts?: Readonly<Record<string, number>>;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isCounts = (v: unknown): v is Record<string, number> =>
  !!v && typeof v === 'object' && Object.values(v as Record<string, unknown>).every(isCount);

/**
 * A run of `--census`. Its stdout carries counts only, so an answer this side
 * cannot read is quoted, as `--show`'s is.
 */
export function readCensusRun(
  run: { stdout: string; stderr: string; code: number },
): { readonly ok: true; readonly census: StandCensus } | { readonly ok: false; readonly because: string } {
  if (run.code !== 0) return { ok: false, because: `exit ${run.code}: ${wordsOf(run.stderr) || '(no words)'}` };
  const c = answerLine(run.stdout, 'operatorCensus')?.['operatorCensus'] as Partial<StandCensus> | undefined;
  const m = c?.mfa as Partial<StandCensus['mfa']> | undefined;
  const a = c?.seededAdmin as Partial<StandCensus['seededAdmin']> | undefined;
  const p = c?.privileged as Partial<NonNullable<StandCensus['privileged']>> | undefined;
  const k = c?.keyedOnJwtSecret as Partial<NonNullable<StandCensus['keyedOnJwtSecret']>> | undefined;
  // Absent is a tool that predates the block; present and malformed is not an answer.
  const privilegedWhole =
    p === undefined ||
    (isCount(p.accounts) &&
      isCounts(p.byCreatedDay) &&
      (p.openWithPublishedPassword === null || isCount(p.openWithPublishedPassword)) &&
      isCount(p.signedIn));
  const keyedWhole = k === undefined || isCounts(k.pickupCodesLive);
  const named = c?.counts as unknown;
  const countsWhole = named === undefined || isCounts(named);
  const whole =
    c &&
    isCount(c.users) &&
    isCounts(c.byRole) &&
    isCounts(c.byStatus) &&
    m &&
    isCount(m.totpEnabled) &&
    isCount(m.totpSecretEncrypted) &&
    isCount(m.totpSecretPlain) &&
    isCount(m.backupCodes) &&
    a &&
    typeof a.present === 'boolean' &&
    (a.publishedPassword === null || typeof a.publishedPassword === 'boolean') &&
    privilegedWhole &&
    keyedWhole &&
    countsWhole;
  if (!whole) {
    return { ok: false, because: `the tool exited 0 with nothing this side can read: ${run.stdout.trim().slice(-300) || '(empty)'}` };
  }
  return {
    ok: true,
    census: {
      users: c.users!,
      byRole: c.byRole!,
      byStatus: c.byStatus!,
      mfa: {
        totpEnabled: m.totpEnabled!,
        totpSecretEncrypted: m.totpSecretEncrypted!,
        totpSecretPlain: m.totpSecretPlain!,
        backupCodes: m.backupCodes!,
      },
      seededAdmin: {
        present: a.present!,
        status: typeof a.status === 'string' ? a.status : null,
        role: typeof a.role === 'string' ? a.role : null,
        publishedPassword: a.publishedPassword ?? null,
      },
      ...(p
        ? {
            privileged: {
              accounts: p.accounts!,
              byCreatedDay: p.byCreatedDay!,
              openWithPublishedPassword: p.openWithPublishedPassword ?? null,
              signedIn: p.signedIn!,
            },
          }
        : {}),
      ...(k ? { keyedOnJwtSecret: { pickupCodesLive: k.pickupCodesLive! } } : {}),
      ...(named !== undefined ? { counts: named as Record<string, number> } : {}),
    },
  };
}

/** A run of `--remove`: removed, or why not. */
export function readRemoveRun(
  run: { stdout: string; stderr: string; code: number },
  username: string,
  id: string,
): { readonly removed: true } | { readonly removed: false; readonly because: string } {
  if (run.code === 0) {
    const answer = answerLine(run.stdout, 'operatorAccountRemoved')?.['operatorAccountRemoved'] as
      | { username?: unknown; id?: unknown }
      | undefined;
    if (answer?.username === username && answer.id === id) return { removed: true };
    return { removed: false, because: `the tool exited 0 without saying it removed ${username} (${describeStdout(run.stdout)})` };
  }
  return { removed: false, because: `exit ${run.code}: ${wordsOf(run.stderr) || '(no words)'}` };
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
