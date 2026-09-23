/**
 * A master could tell a node what to do and could not ask what it had done.
 *
 * A master reaches its nodes with a `service_role` token minted from the
 * node's own signing secret — no session, no human. `shared/roles.ts` has
 * carried the warning since the first time this happened:
 *
 *   «anything else the control plane asks a node to do needs it too, and
 *    spelling it out three times is how one of them ends up without it»
 *
 * and then, on the reading half:
 *
 *   «a master could TELL a node to provision its infrastructure and could
 *    not ASK what it had provisioned»
 *
 * It happened a third time, on three methods at once, and every one of them
 * is a READ the control plane makes about a node it drives:
 *
 *     OmnitronSync.getSyncStatus        VIEWER_ROLES
 *     OmnitronTelemetry.getRelayStats   VIEWER_ROLES
 *     OmnitronCluster.getClusterState   VIEWER_ROLES
 *
 * `VIEWER_ROLES` is the human hierarchy — admin, operator, viewer — and
 * `service_role` is not in it. So the node authenticated the master's
 * credential, accepted `drainBuffer` and `ackDrained` from it (both spell
 * `service_role` out by hand), and answered `Missing required role` to the
 * read beside them.
 *
 * Measured on the live stand, 2026-09-22, after the «Sync» column was wired
 * to real data: the column stayed EMPTY beside a connected node with tens of
 * thousands of entries replicating through it — 10 000 pulled per sweep, the
 * safety limit. The refusal was caught and logged at `debug`, and the
 * daemon logs at `info`, so the effect was a blank cell and no line anywhere
 * saying why.
 *
 * What the other two cannot answer is worse than a blank column. Their own
 * docblocks say it: `totalDropped` is «the one counter in the fleet that
 * reports LOSS», and two nodes naming different leaders is «the state in
 * which every node is individually healthy and the fleet is not».
 *
 * So this court is a REGISTRY, not three assertions. Every call the master
 * makes to a node is listed here and checked against the decorator that
 * guards it, and a second test fails if the code grows a call this list does
 * not name — because the list going stale is the way this defect comes back
 * a fourth time.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../../src/', import.meta.url).pathname;

/** Every service+method the master invokes on a node, and where from. */
const CONTROL_PLANE_CALLS: ReadonlyArray<{ service: string; method: string; why: string }> = [
  { service: 'OmnitronInfra', method: 'provisionStack', why: 'stack start on a remote node' },
  { service: 'OmnitronInfra', method: 'getConnectionInfo', why: 'what the node provisioned' },
  { service: 'OmnitronInfra', method: 'getState', why: 'infrastructure status for the console' },
  { service: 'OmnitronInfra', method: 'listContainers', why: 'container list for the console' },
  { service: 'OmnitronDaemon', method: 'ping', why: 'the daemon\'s own node check, over the mesh, before a direct dial' },
  { service: 'OmnitronDaemon', method: 'status', why: 'what the node is running' },
  { service: 'OmnitronDaemon', method: 'getHealth', why: 'node health for the console' },
  { service: 'OmnitronDaemon', method: 'getMetrics', why: 'node metrics for the console' },
  { service: 'OmnitronSync', method: 'drainBuffer', why: 'pull replicated entries' },
  { service: 'OmnitronSync', method: 'ackDrained', why: 'release what the master stored' },
  { service: 'OmnitronSync', method: 'getSyncStatus', why: 'the «Sync» column, and the backlog' },
  { service: 'OmnitronTelemetry', method: 'getRelayStats', why: 'the only counter that reports LOSS' },
  { service: 'OmnitronCluster', method: 'getClusterState', why: 'split brain is only visible across nodes' },
];

/** `@Service({ name })` → file contents, for every rpc service in the tree. */
function rpcServices(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.rpc-service.ts')) {
        const source = readFileSync(full, 'utf8');
        const named = source.match(/@Service\(\{\s*name:\s*'([^']+)'/)?.[1];
        // `@Service({ name: DAEMON_SERVICE_ID })` — a constant, resolved here
        // rather than skipped, because the daemon is the most-called service
        // of all and skipping it would make this registry quietly partial.
        const viaConst = source.includes('name: DAEMON_SERVICE_ID') ? 'OmnitronDaemon' : undefined;
        const name = named ?? viaConst;
        if (name) found.set(name, source);
      }
    }
  };
  walk(SRC);
  return found;
}

/** The `@Public(...)` that guards one method, as written. */
function guardOf(source: string, method: string): string | null {
  const at = source.search(new RegExp(`\\n\\s*(?:async\\s+)?${method}\\s*\\(`));
  if (at < 0) return null;
  const before = source.slice(0, at);
  const decorator = before.lastIndexOf('@Public(');
  if (decorator < 0) return null;
  // Everything between the decorator and the method is comment and
  // whitespace only — otherwise this is some other method's decorator.
  const between = before.slice(decorator);
  if (/\n\s*(?:async\s+)?[a-zA-Z_$][\w$]*\s*\(/.test(between.slice(between.indexOf(')') + 1))) return null;
  return between.replace(/\s+/g, ' ');
}

describe('a master could tell a node and not ask it', () => {
  it('every call the master makes to a node admits service_role', () => {
    const services = rpcServices();
    const refused: string[] = [];

    for (const { service, method, why } of CONTROL_PLANE_CALLS) {
      const source = services.get(service);
      expect(source, `${service} is not an rpc service in this tree`).toBeTruthy();
      const guard = guardOf(source!, method);
      expect(guard, `${service}.${method} has no @Public decorator`).toBeTruthy();

      const admits =
        guard!.includes('service_role') ||
        guard!.includes('CONTROL_PLANE_ROLES') ||
        guard!.includes('CONTROL_PLANE_READ_ROLES') ||
        guard!.includes('allowAnonymous: true');

      if (!admits) refused.push(`${service}.${method} (${why}) — ${guard!.trim().slice(0, 80)}`);
    }

    expect(refused, 'a node refusing its own master').toEqual([]);
  });

  it('the registry above names every call the code actually makes', () => {
    // The list going stale is how this comes back. A call added to the code
    // and not to the list would be unchecked, and would look checked.
    const listed = new Set(CONTROL_PLANE_CALLS.map((c) => `${c.service}.${c.method}`));
    const seen = new Set<string>();

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const source = readFileSync(full, 'utf8');
          // `invokeOnSlave(host, port, 'Service', 'method'` and
          // `askNode(id, 'Service', 'method'` — the two ways the master
          // addresses a node by name.
          for (const m of source.matchAll(
            /(?:invokeOnSlave|askNode)(?:<[^>]*>)?\([^)]*?'(Omnitron[A-Za-z]+)',\s*\n?\s*'([a-zA-Z]+)'/g,
          )) {
            seen.add(`${m[1]}.${m[2]}`);
          }
        }
      }
    };
    walk(SRC);

    expect(seen.size, 'the scan found no calls at all — it has stopped working').toBeGreaterThan(3);
    expect([...seen].filter((c) => !listed.has(c)), 'calls nobody checks').toEqual([]);
  });

  it('names the calls whose method it cannot read, so they are not assumed covered', () => {
    // The scan above matches a LITERAL method name. `daemonAnswer` passes one
    // through a variable —
    //
    //     this.askNode<T>(nodeId, 'OmnitronDaemon', method, args, null)
    //
    // — so its three methods (`status`, `getHealth`, `getMetrics`, fixed by
    // the parameter's union type) were invisible to it, and the test above
    // said «the registry names every call the code makes» while seeing none
    // of them. A scanner that cannot see part of its subject must SAY so,
    // not pass quietly; that is the difference between a check and a
    // decoration.
    //
    // So: every service reached through a variable method must have at least
    // one entry in the registry, and this assertion prints which services
    // those are, because their method lists are maintained by hand.
    const byVariable = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          for (const m of readFileSync(full, 'utf8').matchAll(
            /(?:invokeOnSlave|askNode)(?:<[^>]*>)?\([^)]*?'(Omnitron[A-Za-z]+)',\s*\n?\s*([a-z][\w.]*)\s*[,)]/g,
          )) {
            byVariable.add(m[1] as string);
          }
        }
      }
    };
    walk(SRC);

    const covered = new Set(CONTROL_PLANE_CALLS.map((c) => c.service));
    expect(
      [...byVariable].filter((svc) => !covered.has(svc)),
      'a service reached with a computed method and no entry in the registry',
    ).toEqual([]);
  });
});
