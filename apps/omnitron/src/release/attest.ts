/**
 * What a stack measured about a release, after it was carrying it.
 *
 * Some checks cannot run in a clean clone. Revocation, token binding, the
 * paywall, a dead-drop location — these exercise a DEPLOYED system, and
 * there is nowhere to run them before a stack is carrying the release. So
 * they are attached to the pair (release, stack) rather than to the build,
 * and production asks for them by name: `verifiedOn` in a stack's release
 * policy is «another stack ran these against this release and they passed».
 *
 * The producer lives in the project (`scripts/attest.mjs` in daos) and
 * prints one JSON object as its last line, in the same five outcome words
 * the gates use. This file is the receiving half: it decides whether the
 * object is about the release and the stack it claims, and refuses in the
 * four ways it can be wrong.
 *
 * Refusing rather than storing-and-warning is the point. An attestation that
 * is kept is later read as evidence by `decideStackRelease`, which cannot
 * re-examine where it came from; everything that makes it trustworthy has to
 * be decided here, once, at the door.
 */

import fs from 'node:fs';
import path from 'node:path';

import { releasesRoot } from './load.js';
import type { GateOutcome, StackAttestation } from './manifest.js';

/** The producer's five words, and nothing else. */
const OUTCOMES: Record<string, GateOutcome['status']> = {
  passed: 'passed',
  failed: 'failed',
  'timed-out': 'timed-out',
  killed: 'killed',
  'not-run': 'not-run',
};

/** What `scripts/attest.mjs` prints, as far as this side relies on it. */
interface RawAttestation {
  stack?: unknown;
  release?: unknown;
  at?: unknown;
  probes?: unknown;
  onNode?: { claimed?: unknown; hosts?: unknown; matched?: unknown };
}

export interface StoredAttestation extends StackAttestation {
  /** When the probes finished, as the producer recorded it. */
  readonly at: string;
  /** Where the producer says it ran, and whether it could confirm that. */
  readonly onNode: { claimed: boolean; hosts: string[]; matched: boolean | null };
  /** When this master accepted it. */
  readonly storedAt: string;
}

/**
 * The last JSON object on stdout, as the gates' reader takes it.
 *
 * One object, one line, and the human words go to stderr — the same contract
 * `gates.mjs --json` keeps, so both readers can be wrong in only one way.
 */
export function parseAttestation(stdout: string): RawAttestation {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as RawAttestation;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      continue;
    }
  }
  throw new Error('The attestation printed no JSON object on its last line — nothing was measured, so nothing is stored');
}

/** A probe's outcome, with an unrecognised word recorded as not-run and named. */
function outcomeOf(probe: Record<string, unknown>): GateOutcome {
  const name = String(probe['name'] ?? '(unnamed)');
  const word = String(probe['outcome'] ?? '');
  const status = OUTCOMES[word];
  const detail = typeof probe['detail'] === 'string' ? probe['detail'] : undefined;
  const ms = typeof probe['ms'] === 'number' ? probe['ms'] : undefined;
  return {
    name,
    status: status ?? 'not-run',
    ...(status ? (detail ? { detail } : {}) : { detail: `unrecognised outcome '${word}'${detail ? ` — ${detail}` : ''}` }),
    ...(ms !== undefined ? { durationMs: ms } : {}),
  };
}

export interface AttestOptions {
  /** Where releases live; overridden in courts. */
  readonly root?: string;
  /**
   * When this stack last took this release, if it is known.
   *
   * An attestation older than the deployment measured something that is no
   * longer there. It is refused rather than stored: it would otherwise
   * satisfy `verifiedOn` for a system nobody has tested.
   */
  readonly deployedAt?: string | null;
}

/**
 * Take one attestation for a release, or say why not.
 *
 * Four refusals, each naming what was wrong:
 *   - it is about another stack, or another release;
 *   - the producer claimed it ran on the node and could not confirm it —
 *     `onNode.matched === false` means the addresses it saw are not the
 *     stack's, so what it measured was somebody's laptop;
 *   - it finished before the deployment it claims to be about;
 *   - it carries no probes at all.
 */
export async function storeAttestation(
  releaseId: string,
  stack: string,
  stdout: string,
  options: AttestOptions = {},
): Promise<{ path: string; attestation: StoredAttestation }> {
  const root = options.root ?? releasesRoot();
  const dir = path.join(root, releaseId);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    throw new Error(`No release '${releaseId}' on this machine — there is nothing for an attestation to be about`);
  }
  const raw = parseAttestation(stdout);

  if (typeof raw.stack !== 'string' || raw.stack !== stack) {
    throw new Error(
      `Refusing this attestation: it is about stack '${String(raw.stack ?? '(none named)')}' and was offered for '${stack}'`,
    );
  }
  if (raw.release !== undefined && raw.release !== null && raw.release !== releaseId) {
    throw new Error(
      `Refusing this attestation: it names release '${String(raw.release)}' and was offered for '${releaseId}'. ` +
        `An attestation is about one build; what it measured was not this one.`,
    );
  }
  if (!Array.isArray(raw.probes) || raw.probes.length === 0) {
    throw new Error('Refusing this attestation: it carries no probes, so it measured nothing');
  }

  const claimed = raw.onNode?.claimed === true;
  const matched = typeof raw.onNode?.matched === 'boolean' ? raw.onNode.matched : null;
  const hosts = Array.isArray(raw.onNode?.hosts) ? raw.onNode.hosts.map(String) : [];
  if (claimed && matched === false) {
    throw new Error(
      `Refusing this attestation: it was produced with --on-node and the producer could not confirm it ran on one — ` +
        `the addresses it saw (${hosts.join(', ') || 'none'}) are not the stack's. On --on-node the probes reach ` +
        `localhost and the stack's containers, so run elsewhere they measured the machine they ran on.`,
    );
  }

  const at = typeof raw.at === 'string' ? raw.at : new Date().toISOString();
  if (options.deployedAt && Date.parse(at) < Date.parse(options.deployedAt)) {
    throw new Error(
      `Refusing this attestation: it finished ${at}, and ${stack} last took this release ${options.deployedAt} — ` +
        `it measured a system that has since been replaced.`,
    );
  }

  const gates = (raw.probes as Array<Record<string, unknown>>).map(outcomeOf);
  const attestation: StoredAttestation = {
    stack,
    release: releaseId,
    gates,
    at,
    onNode: { claimed, hosts, matched },
    storedAt: new Date().toISOString(),
  };
  const target = path.join(dir, 'attestations');
  fs.mkdirSync(target, { recursive: true });
  // The stack names the file: one attestation per stack, and a newer run
  // replaces an older one — the question is «what does test say about this
  // release NOW», not «what did it once say».
  const file = path.join(target, `${stack.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(attestation, null, 2)}\n`);
  return { path: file, attestation };
}

/**
 * Every attestation stored for a release.
 *
 * Read by `admitRelease` and handed to `decideStackRelease` as its fourth
 * argument — the one that was always `[]` until something started writing
 * these, which is why a stack declaring `verifiedOn` refused every release
 * forever.
 */
export function loadAttestations(releaseId: string, root: string = releasesRoot()): StoredAttestation[] {
  const dir = path.join(root, releaseId, 'attestations');
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: StoredAttestation[] = [];
  for (const name of names) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as StoredAttestation;
      // A file that does not name this release is not read as evidence for
      // it, whatever its name says — the same rule the door applied.
      if (parsed?.release === releaseId && typeof parsed.stack === 'string' && Array.isArray(parsed.gates)) {
        out.push(parsed);
      }
    } catch {
      // Unreadable: absent, which is a refusal rather than a pass.
    }
  }
  return out;
}
