/**
 * What a release is, and what earns one the right to reach a stack.
 *
 * There is one test server and one production estate, and any number of
 * development machines. Today a deployment is whichever developer's disk
 * reached the node last: the artifacts are compiled from that machine's
 * working tree, by that machine's toolchain, and the only thing recorded
 * afterwards is the project's commit. Measured over one day, that produced
 * every failure this file exists to make impossible —
 *
 *   - two deployments ran concurrently and one emptied a package's `dist`
 *     while the other compiled against it;
 *   - an artifact's inputs included the deploying machine's own checkout of
 *     `@omnitron-dev/omnitron`, which the trail does not record at all, so
 *     «what is running there» cannot be answered from the row that says a
 *     deployment happened;
 *   - `daos` carries a 310-line GitHub Actions workflow and lives on a
 *     GitLab server, with no runner and no `.gitlab-ci.yml`, so the guard
 *     rail its own docblock describes — typecheck, lint, unit and
 *     integration — has never run anywhere but on somebody's laptop, when
 *     they remembered.
 *
 * A release is the answer to all three: one object, built from a named
 * commit of BOTH repositories in a clean clone, carrying the artifacts by
 * checksum, the outcome of every gate that was asked to run, and what it was
 * built with. A stack accepts a release or refuses it; nothing else reaches
 * test or production.
 *
 * The rule this file is built around, and the reason it is a module of its
 * own with a suite of its own: **a gate that did not run is not a gate that
 * passed.** «No gate failed» is satisfied by a scanner that was deleted, a
 * suite whose runner exited before collecting, and a CI file for a forge the
 * repository does not live on. «Every required gate ran and passed» is
 * satisfied by none of those.
 */

/** One packed application, identified by content rather than by name. */
export interface ReleaseArtifact {
  readonly app: string;
  readonly version: string;
  /** sha256 of the tarball, as the receiving side will recompute it. */
  readonly sha256: string;
  /**
   * Size in bytes, carried BESIDE the checksum rather than instead of it.
   *
   * A zero-length file with the right sum is impossible; a truncated one
   * with the wrong sum is ordinary, and `sha mismatch` alone does not say
   * whether anything arrived. Both numbers travel so the refusal can name
   * both.
   */
  readonly bytes: number;
  /**
   * The hash of the build INPUTS, as a working-tree deployment records it on
   * the node — what `decideRedeploy` compares to tell an app that changed from
   * one that did not. Carried so a release deployed over the same code leaves
   * the app running, as a deployment of the tree would.
   */
  readonly inputs?: string;
}

/**
 * What one gate answered.
 *
 * `not-run` exists so that absence is a value rather than a hole. A gate
 * missing from this list and a gate listed as `not-run` are the same
 * refusal, and both differ from `passed`.
 *
 * `timed-out` is a third thing and not a fourth spelling of `failed`. A
 * gate that answered «no» judged the code; a gate that did not answer in
 * time judged the machine it ran on. Measured 2026-09-22: one scanner that
 * walks 3502 files finishes in under a second alone and twice blew a
 * 180-second limit while other work ran beside it, and a full unit suite
 * failed one test at load average 41.7 and passed it alone. Recording both
 * as `failed` would attribute the machine's hour to the commit.
 */
export interface GateOutcome {
  readonly name: string;
  /**
   * `killed` is the machine as well: a signal from outside — the OS
   * reclaiming memory — ended the gate before it answered. `gates.mjs`
   * reports it apart from its own timeout, and so does this.
   */
  readonly status: 'passed' | 'failed' | 'not-run' | 'timed-out' | 'killed';
  /** The gate's own words — an exit code and a line, not a paraphrase. */
  readonly detail?: string;
  readonly durationMs?: number;
  /**
   * How many checks this gate is made of, when it is made of several.
   *
   * `run-checks` discovers its gates by reading a directory, so a new
   * scanner becomes a gate by existing — which is right, and means a
   * DISAPPEARED one is equally silent. A release whose `scans` ran 61
   * checks where the last ran 78 passed the same way and guarded less; the
   * number travels so that the difference is visible without re-running
   * anything.
   */
  readonly checks?: number;
}

/**
 * What the release was built WITH, as opposed to what it was built FROM.
 *
 * Measured 2026-09-22: of three fixes committed together, two reached the
 * stand and one did not, because the daemon started sixteen seconds before
 * the package holding the third was rebuilt. The commit was identical in
 * all three cases; the `dist` that was packed was not. A release that names
 * only its commits therefore names something that was true of two of them.
 */
export interface BuiltWith {
  /** The omnitron that packed this, by its own version string. */
  readonly omnitron: string;
  /** Each linked package, and when the `dist` that went in was produced. */
  readonly packages: ReadonlyArray<{ readonly name: string; readonly distBuiltAt: string }>;
}

/** A repository and the commit taken from it. */
export interface ReleaseSource {
  readonly repo: string;
  readonly commit: string;
  /**
   * Whether a remote-tracking branch contains the commit — null when the
   * checkout has no remote refs to ask. A release built from a commit that
   * exists on one laptop cannot be rebuilt by anyone else.
   */
  readonly onRemote?: boolean | null;
}

export interface ReleaseManifest {
  readonly id: string;
  /** The project's repository and the commit this was built from. */
  readonly project: ReleaseSource;
  /**
   * And omni's, because its packages are vendored into every artifact.
   *
   * The two live in different systems — omni on GitHub, the project on a
   * self-hosted GitLab — which is why neither forge's CI can produce this
   * object and the master can.
   */
  readonly omni: ReleaseSource;
  readonly artifacts: readonly ReleaseArtifact[];
  /**
   * Applications whose artifact did not build, with the builder's words. A
   * release carrying them is still written — it is evidence — and a stack
   * that requires the app refuses it by the missing artifact.
   */
  readonly artifactFailures?: ReadonlyArray<{ readonly app: string; readonly error: string }>;
  /**
   * The static bundle a stack's gateway serves, built in the clone with that
   * stack's `staticEnv`. Per stack, because the build is: a frontend bundle
   * bakes its environment in. Absent when the release was not built for a
   * stack that serves one — and a stack that does refuses the release.
   */
  readonly statics?: {
    readonly stack: string;
    /** The stack's `staticDir`, relative to the project, as declared. */
    readonly dir: string;
    readonly files: number;
    readonly bytes: number;
  };
  readonly gates: readonly GateOutcome[];
  readonly builtWith: BuiltWith;
  readonly builtAt: string;
  readonly builtBy: string;
}

/**
 * What one stack verified about one release, after it was deployed there.
 *
 * Some gates cannot run in a clean clone: the live probes exercise a
 * DEPLOYED system — revocation, token binding, paywall, dead-drop location
 * — and there is nowhere to run them before a stack is carrying the
 * release. So they are attached to the pair, not to the build.
 */
export interface StackAttestation {
  readonly stack: string;
  readonly release: string;
  readonly gates: readonly GateOutcome[];
}

/** What a stack demands of a release before it will take it. */
export interface StackReleasePolicy {
  /** Gates that must have RUN and PASSED at build time. Absence is refusal. */
  readonly requiredGates: readonly string[];
  /** Applications the stack expects to receive. */
  readonly requiredApps: readonly string[];
  /**
   * Gates that another stack must have run against this release, and passed.
   *
   * Production does not take what compiled; it takes what a running system
   * was measured to do. «Deployed to test» and «verified on test» are
   * different claims, and only the second is evidence — the same distinction
   * that separated «Left running» in a log from six changed pids on a node.
   */
  readonly verifiedOn?: { readonly stack: string; readonly gates: readonly string[] };
}

export type ReleaseDecision =
  | { readonly action: 'promote'; readonly because: string }
  | { readonly action: 'refuse'; readonly because: string };

const SHA256 = /^[0-9a-f]{64}$/;

/** How each non-pass reads in a refusal: which one it was is the finding. */
const OUTCOME_WORDS: Record<GateOutcome['status'], string> = {
  passed: 'passed',
  failed: 'failed',
  'not-run': 'did not run',
  'timed-out': 'did not answer in time',
  killed: 'was killed before it answered',
};

/**
 * May this release reach this stack?
 *
 * Every answer is a refusal until the last one, and each refusal names the
 * single fact that produced it — the gate, the application, the field —
 * because «policy not satisfied» sends the reader to re-derive what this
 * already knows.
 */
export function decideRelease(
  manifest: ReleaseManifest,
  policy: StackReleasePolicy,
  /** What other stacks have verified about this release. */
  attestations: readonly StackAttestation[] = [],
): ReleaseDecision {
  if (!manifest.project?.commit) {
    return { action: 'refuse', because: 'the release does not name the project commit it was built from' };
  }
  if (!manifest.omni?.commit) {
    // Not pedantry: omni's packages are inside every artifact, so a release
    // without this commit cannot be rebuilt and cannot be compared.
    return { action: 'refuse', because: 'the release does not name the omni commit its packages came from' };
  }

  const byName = new Map(manifest.gates.map((g) => [g.name, g]));
  for (const required of policy.requiredGates) {
    const gate = byName.get(required);
    if (!gate) {
      return { action: 'refuse', because: `the gate '${required}' is not in this release — it did not run` };
    }
    if (gate.status === 'not-run') {
      return {
        action: 'refuse',
        because: `the gate '${required}' did not run${gate.detail ? `: ${gate.detail}` : ''}`,
      };
    }
    if (gate.status === 'killed') {
      return {
        action: 'refuse',
        because: `the gate '${required}' was killed before it answered${gate.detail ? `: ${gate.detail}` : ''}`,
      };
    }
    if (gate.status === 'timed-out') {
      // Refused, like every other non-pass — but named apart, because the
      // answer to this one is «run it on a quiet machine», not «fix the
      // code», and a trail that says `failed` sends the reader to the diff.
      return {
        action: 'refuse',
        because: `the gate '${required}' did not answer in time${gate.detail ? `: ${gate.detail}` : ''}`,
      };
    }
    if (gate.status === 'failed') {
      return {
        action: 'refuse',
        because: `the gate '${required}' failed${gate.detail ? `: ${gate.detail}` : ''}`,
      };
    }
  }

  const artifacts = new Map(manifest.artifacts.map((a) => [a.app, a]));
  for (const app of policy.requiredApps) {
    const artifact = artifacts.get(app);
    if (!artifact) {
      return { action: 'refuse', because: `the release carries no artifact for '${app}'` };
    }
    if (!SHA256.test(artifact.sha256)) {
      return { action: 'refuse', because: `the artifact for '${app}' carries no usable checksum` };
    }
    if (!(artifact.bytes > 0)) {
      return { action: 'refuse', because: `the artifact for '${app}' is recorded as ${artifact.bytes} bytes` };
    }
  }

  if (policy.verifiedOn) {
    const { stack, gates } = policy.verifiedOn;
    const attestation = attestations.find((a) => a.stack === stack && a.release === manifest.id);
    if (!attestation) {
      return {
        action: 'refuse',
        because: `nothing has been verified about this release on '${stack}' — production takes what a running system was measured to do`,
      };
    }
    const byStack = new Map(attestation.gates.map((g) => [g.name, g]));
    for (const required of gates) {
      const gate = byStack.get(required);
      if (!gate) {
        return { action: 'refuse', because: `'${required}' has not been run against this release on '${stack}'` };
      }
      if (gate.status !== 'passed') {
        return {
          action: 'refuse',
          because: `'${required}' ${OUTCOME_WORDS[gate.status]} against this release on '${stack}'` +
            (gate.detail ? `: ${gate.detail}` : ''),
        };
      }
    }
  }

  return {
    action: 'promote',
    because:
      `${policy.requiredGates.length} gate(s) ran and passed, ` +
      `${policy.requiredApps.length} artifact(s) present` +
      (policy.verifiedOn
        ? `, ${policy.verifiedOn.gates.length} verified on '${policy.verifiedOn.stack}'`
        : ''),
  };
}

/**
 * What a stack declares about the releases it takes — `release` in its
 * config.
 *
 * `required`: the stack takes releases only, and a `stack start` without one
 * is refused. Every gate the release RECORDED must have passed; the gates
 * listed here must additionally be among them — a floor, so a gate that
 * disappears from the build is noticed rather than silently not run. The
 * number of gates is not fixed (they are derived from the manifests), which
 * is why the rule is "all that ran, and at least these", not a list.
 */
export interface StackReleaseRequirements {
  readonly mode: 'required' | 'optional';
  readonly requiredGates?: readonly string[];
  /** Refuse a release whose commits no remote branch contains. */
  readonly requireOnRemote?: boolean;
  readonly verifiedOn?: { readonly stack: string; readonly gates: readonly string[] };
}

/**
 * May this release reach this stack, under what the stack declares?
 *
 * Absent requirements are the weakest honest reading, not a pass-through:
 * every gate the release recorded must still have passed, and every app the
 * stack runs must be in it. A stack that wants less must say so in its
 * config, where a reader can see it.
 */
export function decideStackRelease(
  manifest: ReleaseManifest,
  requirements: StackReleaseRequirements | undefined,
  stackApps: readonly string[],
  attestations: readonly StackAttestation[] = [],
): ReleaseDecision {
  if (requirements?.requireOnRemote) {
    const local = [
      manifest.project.onRemote !== true ? `the project commit ${manifest.project.commit.slice(0, 8)}` : null,
      manifest.omni.onRemote !== true ? `the omni commit ${manifest.omni.commit.slice(0, 8)}` : null,
    ].filter(Boolean);
    if (local.length > 0) {
      return {
        action: 'refuse',
        because: `${local.join(' and ')} ${local.length > 1 ? 'are' : 'is'} on no remote branch — nobody else could rebuild this release`,
      };
    }
  }
  const recorded = manifest.gates.map((g) => g.name);
  if (recorded.length === 0) {
    return { action: 'refuse', because: 'the release recorded no gates at all' };
  }
  const requiredGates = [...new Set([...recorded, ...(requirements?.requiredGates ?? [])])];
  return decideRelease(
    manifest,
    {
      requiredGates,
      requiredApps: stackApps,
      ...(requirements?.verifiedOn ? { verifiedOn: requirements.verifiedOn } : {}),
    },
    attestations,
  );
}
