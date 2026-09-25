/**
 * The omni a deployed application runs.
 *
 * A release carries its omni packages — `vendor/*.tgz`, built from the omni
 * commit its gates ran against — and the node sets them aside: after
 * `npm install`, the remote deployer links every `@omnitron-dev/*` of the
 * application to the node DAEMON's own (step 5a in `remote-deployer.service`),
 * because the application is loaded into the daemon's process and titan has
 * to be one physical copy there. So the omni an application runs is the
 * daemon's, whatever the release says.
 *
 * On daos/test (2026-09-25) a release gated on omni de454a80 ran under a
 * daemon built from 311bddb1: the two titan fixes it was built to ship were
 * not there, the scheduler went on skipping the fires the release had fixed,
 * and its attestation vouched for code the node was not running.
 *
 * Admission therefore asks each node's daemon which omni it was built from,
 * and a release goes only where that is the release's own.
 */

/** What one node's daemon said about itself. */
export interface DaemonAnswer {
  readonly host: string;
  /** `OmnitronDaemon.ping().version`, or null when the node did not answer. */
  readonly version: string | null;
  readonly error?: string;
}

/**
 * The omni commit a daemon's version names: `0.2.0+local.<sha>.<stamp>` (see
 * `localVersion`) → `<sha>`. Null when it names none — a version from a
 * registry, or a bundle built outside a repository (`nocommit`).
 */
export function commitOfDaemonVersion(version: string | null | undefined): string | null {
  const m = /\+local\.([0-9a-f]{7,40})\.\d+$/i.exec(version ?? '');
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Why a release gated on `releaseOmni` may not run under these daemons — or
 * null when every one of them was built from that commit.
 *
 * A node that did not answer is a refusal, not a pass: what it runs is exactly
 * what cannot be vouched for.
 */
export function refuseForeignOmni(releaseOmni: string, daemons: readonly DaemonAnswer[]): string | null {
  const wanted = releaseOmni.toLowerCase();
  const reasons: string[] = [];
  for (const d of daemons) {
    if (d.error !== undefined || d.version === null) {
      reasons.push(`${d.host} did not say which omni its daemon runs${d.error ? ` (${d.error})` : ''}`);
      continue;
    }
    const sha = commitOfDaemonVersion(d.version);
    if (!sha) {
      reasons.push(`${d.host}'s daemon ${d.version} names no omni commit`);
    } else if (!wanted.startsWith(sha)) {
      reasons.push(`${d.host}'s daemon runs omni ${sha.slice(0, 8)} (${d.version})`);
    }
  }
  if (reasons.length === 0) return null;
  const short = wanted.slice(0, 8);
  return (
    `${reasons.join('; ')} — an application on a node loads the daemon's @omnitron-dev packages, not the ` +
    `release's, and this release was gated on omni ${short}. Upgrade the node from omni ${short} ` +
    `(\`omnitron fleet upgrade <node>\`), or build the release with \`--omni-commit\` set to the daemon's`
  );
}
