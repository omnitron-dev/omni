/**
 * The names the project's tools look the stand's containers up by, as they
 * are on a node — `<prefix>-postgres`, not the developer's `sample-dev-postgres`
 * the tools default to.
 *
 * One table for every tool this master runs on a node. There were two: the
 * attestation's with three names and the operator-account tool's with two —
 * no gateway. When signup began reading the legal texts in force from the
 * gateway (sample c0dcf556), `omnitron stack account sample test` looked for
 * `sample-dev-gateway` on the test node and made no account (2026-09-25):
 * «No such container: sample-dev-gateway».
 */
import { shellEscape } from '../shared/shell-escape.js';

export function standContainers(prefix: string): Readonly<Record<string, string>> {
  return {
    SAMPLE_PG_CONTAINER: `${prefix}-postgres`,
    SAMPLE_REDIS_CONTAINER: `${prefix}-redis`,
    SAMPLE_GATEWAY_CONTAINER: `${prefix}-gateway`,
  };
}

/** The same, as shell assignments to put before a command. */
export function standContainerAssignments(prefix: string): string {
  return Object.entries(standContainers(prefix))
    .map(([k, v]) => `${k}=${shellEscape(v)}`)
    .join(' ');
}
