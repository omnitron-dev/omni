/**
 * The decisions of a release build that do not need a disk.
 *
 * `commands/release.ts` clones, installs, runs and packs; everything it then
 * has to CONCLUDE — what the release is called, what each gate said, what
 * the manifest records — is here, where it can be checked without a
 * forty-minute build.
 */

import type { GateOutcome, ReleaseArtifact, ReleaseManifest, ReleaseSource } from './manifest.js';

/** `daos-202609221432-81c8a074-c64963f6`: what, when (UTC), from which two commits. */
export function releaseId(project: string, at: Date, projectCommit: string, omniCommit: string): string {
  const stamp = at.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `${project}-${stamp}-${projectCommit.slice(0, 8)}-${omniCommit.slice(0, 8)}`;
}

const OUTCOMES: Record<string, GateOutcome['status']> = {
  passed: 'passed',
  failed: 'failed',
  'timed-out': 'timed-out',
  killed: 'killed',
  'not-run': 'not-run',
};

/**
 * What the gates said, from `gates.mjs --json`.
 *
 * The script prints one JSON object as its last line. No such line is not
 * "no gates failed" — it is one outcome, `not-run`, under the name `gates`,
 * with the reason; a release that then requires any gate is refused by its
 * absence. An outcome word this does not know is `not-run` too, named in the
 * detail: a status nobody recognises must not read as a pass.
 */
export function gateOutcomesFromGates(stdout: string, exitCode: number | null): GateOutcome[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith('{')) continue;
    let parsed: { gates?: unknown } | null;
    try {
      parsed = JSON.parse(line) as { gates?: unknown };
    } catch {
      continue;
    }
    if (!parsed || !Array.isArray(parsed.gates)) continue;
    return (parsed.gates as Array<Record<string, unknown>>).map((g) => {
      const name = String(g['name'] ?? '(unnamed)');
      const word = String(g['outcome'] ?? '');
      const status = OUTCOMES[word];
      const detail = typeof g['detail'] === 'string' ? g['detail'] : undefined;
      const ms = typeof g['ms'] === 'number' ? g['ms'] : undefined;
      return {
        name,
        status: status ?? 'not-run',
        ...(status ? (detail ? { detail } : {}) : { detail: `unrecognised outcome '${word}'${detail ? ` — ${detail}` : ''}` }),
        ...(ms !== undefined ? { durationMs: ms } : {}),
      };
    });
  }
  return [
    {
      name: 'gates',
      status: 'not-run',
      detail: `the gates script printed no result object (exit ${exitCode === null ? 'by signal' : exitCode})`,
    },
  ];
}

export interface ManifestInput {
  readonly id: string;
  readonly project: ReleaseSource;
  readonly omni: ReleaseSource;
  readonly artifacts: ReadonlyArray<{ app: string; version: string; tarballSha256?: string; size: number; checksum?: string }>;
  readonly artifactFailures: ReadonlyArray<{ app: string; error: string }>;
  readonly gates: readonly GateOutcome[];
  readonly omnitron: string;
  readonly packages: ReadonlyArray<{ name: string; distBuiltAt: string }>;
  readonly machine?: ReleaseManifest['machine'];
  readonly builtAt: Date;
  readonly builtBy: string;
  readonly statics?: ReleaseManifest['statics'];
}

/**
 * The manifest, from what the build produced.
 *
 * An artifact without a tarball checksum is not dropped and not given a
 * made-up one: its sha256 is written empty, and `decideRelease` refuses it
 * by name — "carries no usable checksum" — which is the truth about it.
 */
export function assembleManifest(input: ManifestInput): ReleaseManifest {
  const artifacts: ReleaseArtifact[] = input.artifacts.map((a) => ({
    app: a.app,
    version: a.version,
    sha256: a.tarballSha256 ?? '',
    bytes: a.size,
    ...(a.checksum ? { inputs: a.checksum } : {}),
  }));
  return {
    id: input.id,
    project: input.project,
    omni: input.omni,
    artifacts,
    ...(input.artifactFailures.length > 0 ? { artifactFailures: input.artifactFailures } : {}),
    gates: input.gates,
    ...(input.machine ? { machine: input.machine } : {}),
    builtWith: { omnitron: input.omnitron, packages: input.packages },
    builtAt: input.builtAt.toISOString(),
    builtBy: input.builtBy,
    ...(input.statics ? { statics: input.statics } : {}),
  };
}
