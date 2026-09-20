/**
 * What a node runs, written for the node.
 *
 * A node's daemon starts apps it knows about, and it learns them the way any
 * omnitron does: from a project directory with an `omnitron.config` in it.
 * Remote deployment never gave it one. Artifacts landed at
 * `/opt/omnitron/artifacts/<project>/<app>/<version>/` and the daemon's own
 * log said `No projects registered`, so `omnitron restart main` answered
 * `Failed: Unknown app: main` and the fleet showed six apps deployed and none
 * running.
 *
 * This renders the master's app definitions into a config the node can read,
 * with every path rewritten to where that app actually is on THAT machine.
 *
 * `.mjs` rather than `.ts`: the loader accepts `.ts`, `.js` and `.mjs`, and a
 * node should not need a TypeScript loader to know what to start. It is
 * generated, not edited, so the format costs nothing in readability that a
 * header cannot repay.
 */

import type { IEcosystemAppEntry } from '../config/types.js';

/**
 * The stack a node runs its deployed apps under.
 *
 * One name, used by the renderer and by whoever starts them, so the two
 * cannot drift into naming different stacks — which reads as
 * `Stack 'x' not found` and sends the reader to the config rather than to the
 * two places that disagree.
 */
export const NODE_STACK = 'deployed';

/** Where one app's artifact was unpacked on the node. */
export interface NodeArtifact {
  app: string;
  version: string;
}

export interface NodeConfigInput {
  project: string;
  /** Artifact root on the node — `/opt/omnitron/artifacts`. */
  artifactRoot: string;
  apps: readonly IEcosystemAppEntry[];
  /** Which apps actually have an artifact there, and at which version. */
  artifacts: readonly NodeArtifact[];
  /**
   * The infrastructure these apps connect to, as resolved for this node.
   *
   * Without it the config names what to run and not what to run it against,
   * and `resolveStackAddresses` — which builds `DATABASE_URL`, `REDIS_URL`
   * and the S3 variables — reads `config.infrastructure` and finds nothing.
   * Its fallback chain ends in a literal:
   *
   *     const defaultPgPassword =
   *       infra?.postgres?.password ?? getEnv().POSTGRES_PASSWORD ?? 'postgres';
   *
   * So every app on the node was handed
   * `postgres://postgres:postgres@localhost:5432/<db>` while the container
   * omnitron had just provisioned carried a 43-character generated secret.
   * Measured, six apps at once:
   *
   *     Database connection default failed after 5 retries:
   *     password authentication failed for user "postgres" (28P01)
   *
   * On a laptop the same fallback is CORRECT — a local stack with no declared
   * password really does use `postgres` — which is why nothing caught it
   * until a stack with generated credentials ran somewhere else.
   */
  infrastructure?: Record<string, unknown> | undefined;
}

/**
 * Fields that describe a developer's machine and mean nothing on a node.
 *
 * `watch` is the load-bearing one: it names a source directory to rebuild
 * from, and a node has no sources. Left in, the node's file watcher would
 * follow a path that does not exist — or, worse, one that does and belongs to
 * something else.
 */
const DROPPED = new Set(['watch', 'cwd', 'script']);

/**
 * The app definitions a node should be given.
 *
 * An app with no artifact on the node is omitted rather than written with a
 * path that is not there: a config naming six apps where four are installed
 * produces two that fail at startup for a reason the operator has to work
 * out, and the node already knows how to say "this app is not deployed here"
 * by not listing it.
 */
export function selectNodeApps(input: NodeConfigInput): Array<Record<string, unknown>> {
  const versions = new Map(input.artifacts.map((a) => [a.app, a.version]));
  const present = new Set(versions.keys());
  const out: Array<Record<string, unknown>> = [];

  for (const app of input.apps) {
    const version = versions.get(app.name);
    if (!version) continue;

    const entry: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(app)) {
      if (DROPPED.has(key) || value === undefined) continue;
      entry[key] = value;
    }

    // The artifact's compiled entry point. `bootstrap.js`, because the
    // artifact is `pnpm deploy` output: `dist/` beside a real `node_modules`,
    // both under the version directory the deployer created.
    entry['bootstrap'] = `${input.artifactRoot}/${input.project}/${app.name}/${version}/dist/bootstrap.js`;
    entry['cwd'] = `${input.artifactRoot}/${input.project}/${app.name}/${version}`;

    // A dependency the node does not have would block this app forever: the
    // supervisor waits for something that is never going to start. Keeping
    // only the dependencies that are present turns "never starts" into
    // "starts in an order that may be wrong", which is recoverable and
    // visible.
    if (Array.isArray(app.dependsOn)) {
      const kept = app.dependsOn.filter((d) => present.has(d));
      if (kept.length > 0) entry['dependsOn'] = kept;
      else delete entry['dependsOn'];
    }

    out.push(entry);
  }

  return out;
}

/**
 * Render the config file itself.
 *
 * A header saying where it came from, because the next person to read it will
 * be looking at a file nobody wrote by hand, on a machine with no repository,
 * and "who generates this" is the first thing they need.
 */
export function renderNodeAppConfig(input: NodeConfigInput): string {
  const apps = selectNodeApps(input);
  return [
    '// Generated by omnitron. Do not edit — the master rewrites this file on',
    '// every deployment, and a change made here is lost at the next one.',
    '//',
    `// Project: ${input.project}`,
    `// Apps:    ${apps.map((a) => a['name']).join(', ') || '(none deployed)'}`,
    '//',
    '// Paths point into this node\'s artifact directory. They are absolute',
    '// because a node has no project to resolve them against.',
    '//',
    '// CONTAINS CREDENTIALS. The infrastructure block carries the generated',
    '// passwords these apps connect with, so this file is written 0600 and',
    '// owned by the daemon user.',
    '',
    `export default ${JSON.stringify(
      {
        name: input.project,
        apps,
        // What the apps connect to. `resolveStackAddresses` reads this and
        // nothing else; omitting it does not mean "use no database", it
        // means "use the literal defaults", which is a different and much
        // quieter kind of wrong. See `infrastructure` on the input type.
        ...(input.infrastructure ? { infrastructure: input.infrastructure } : {}),
        // A stack, because `startStack` is how a project's apps are started
        // and it refuses a name it cannot find: `Stack 'x' not found in
        // project 'daos'`. Registering the project alone left the node with
        // six definitions it had read and no instruction to run any of them —
        // `omnitron status` answered `appsTotal: 0` while
        // `/opt/omnitron/projects/daos/omnitron.config.mjs` listed all six.
        //
        // `local`, because from the node's point of view that is what these
        // are: it supervises them itself. The stack that sent them is remote
        // from the master's side and this machine's own from here.
        stacks: {
          [NODE_STACK]: { type: 'local', apps: apps.map((a) => a['name'] as string) },
        },
      },
      null,
      2,
    )};`,
    '',
  ].join('\n');
}
