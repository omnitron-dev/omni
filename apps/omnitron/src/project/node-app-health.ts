/**
 * Reading a node's answer about one app.
 *
 * `omnitron status --json` on a node answers with the apps that node runs,
 * and a node names an app the way every omnitron does: qualified by the
 * project and stack it belongs to. A deployment asks about `main`; the node
 * answers `daos/deployed/main`.
 *
 * Compared as equal strings, those never match, so a deployment that had
 * just put six apps on a node and started all six reported six failures:
 *
 *     Artifact installed, but the app is not running on the node
 *     — the node is running 6 app(s) and none of them is 'main'
 *
 * measured against a node that answered `appsTotal: 6, appsOnline: 6` with
 * every port listening. A verification that cannot pass is the same defect as
 * one that cannot fail, one sign flipped: the first time it says "failed"
 * about a healthy deployment is the last time anybody reads it.
 *
 * Extracted from the deployer so the assertion about this reading runs
 * against the reading itself. The test that pinned it held its own copy of
 * the logic, which agreed with the original and would have gone on agreeing
 * with it after the original was wrong.
 */

import { NODE_STACK } from './node-app-config.js';

/** What a node says about itself and what it runs. */
export interface NodeStatus {
  readonly version?: string | undefined;
  readonly pid?: number | undefined;
  readonly uptime?: number | undefined;
  readonly role?: 'master' | 'slave' | undefined;
  readonly apps: ReadonlyArray<{ name?: string | undefined; status?: string | undefined }>;
}

/**
 * Read `omnitron status --json` from a node.
 *
 * The answer is an envelope — `{ok, data: {...}}` — and everything worth
 * knowing is inside `data`. Two readers in this codebase have reached past
 * it for the top level and found nothing there:
 *
 *   - the deployment's health check read `parsed.apps`, so no app could ever
 *     be recognised as running;
 *   - the fleet's daemon check reads `info.pid`, so a node whose daemon has
 *     been up for days, answering this very command, is listed `○ offline`
 *     in the console and in `omnitron node list`.
 *
 * Measured on the test node while its daemon reported `appsOnline: 6`:
 *
 *     {"ok":true,"data":{"version":"0.2.0+local…","pid":426053,"uptime":216097,…}}
 *
 * Only `data` is read. A top-level `apps` or `pid` is not a node's answer in
 * any version that has ever shipped, and accepting one would make any JSON
 * object with the right field names read as a healthy daemon.
 *
 * `null` means the answer was not JSON at all — `omnitron: command not
 * found` is a node without omnitron, which is not the same state as a node
 * whose daemon is stopped.
 */
export function readNodeStatus(raw: string): NodeStatus | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const data = parsed['data'];
  const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const role = body['role'];

  return {
    version: typeof body['version'] === 'string' ? body['version'] : undefined,
    pid: typeof body['pid'] === 'number' ? body['pid'] : undefined,
    uptime: typeof body['uptime'] === 'number' ? body['uptime'] : undefined,
    role: role === 'master' || role === 'slave' ? role : undefined,
    apps: Array.isArray(body['apps'])
      ? (body['apps'] as Array<{ name?: string; status?: string }>)
      : [],
  };
}

export interface NodeHealth {
  readonly online: boolean;
  /** Why, in the words the operator will read in the log. */
  readonly detail: string;
}

/** What a node calls an app that was deployed to it. */
export function nodeAppName(project: string, app: string): string {
  return `${project}/${NODE_STACK}/${app}`;
}

/** How many names to print before the rest become a count. */
const NAMES_SHOWN = 6;

/**
 * Whether the node says this app is online.
 *
 * `project` is required rather than optional: every caller has it, and an
 * optional one would be omitted exactly where the qualified name matters.
 */
export function readNodeHealth(raw: string, appName: string, project: string): NodeHealth {
  const status = readNodeStatus(raw);
  if (!status) {
    // A node that answers something other than JSON is a node whose CLI is
    // not the one this expects — worth saying, not worth guessing about. Its
    // length, not its text: the answer arrives through the data channel,
    // unmasked, and this detail is written to the log. What the node SAID
    // about it is its stderr, which the caller adds — masked, because words
    // are.
    return { online: false, detail: `the node's status was not JSON (${raw.trim().length} characters)` };
  }

  const apps = status.apps;
  const qualified = nodeAppName(project, appName);

  // The qualified name first, because it is the one a node answers with, and
  // the bare name after it, because a node that was given a bare definition
  // answers bare. Nothing else: an app of the same name under another
  // project is another app, and reporting it as this one is precisely the
  // false pass this file exists to prevent.
  const app = apps.find((a) => a.name === qualified) ?? apps.find((a) => a.name === appName);
  if (!app) {
    const names = apps.map((a) => a.name ?? '(unnamed)');
    const shown = names.slice(0, NAMES_SHOWN).join(', ');
    const rest = names.length > NAMES_SHOWN ? `, and ${names.length - NAMES_SHOWN} more` : '';
    return {
      online: false,
      detail:
        `the node is running ${apps.length} app(s) and none of them is '${qualified}'` +
        (names.length > 0 ? ` — it is running ${shown}${rest}` : ''),
    };
  }

  return app.status === 'online'
    ? { online: true, detail: 'online' }
    : { online: false, detail: `the node reports it as '${app.status ?? 'unknown'}'` };
}
