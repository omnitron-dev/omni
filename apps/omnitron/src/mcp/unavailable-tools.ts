/**
 * Stubs for tool groups whose backing service is not available.
 *
 * An agent that cannot see a tool concludes the capability does not exist and
 * says so to the user. An agent that sees the tool and gets back "the daemon
 * is not running — run `omnitron up`" relays something the user can act on.
 * The difference costs one round trip and is the whole value of the message.
 *
 * Both were already promised and neither was delivered: `kb mcp` logged
 * "KB tools will not be available" to stderr — which no MCP client reads —
 * under a comment saying "register stub tools that return helpful errors",
 * and the docs described exactly the behaviour this file now provides.
 *
 * The names are duplicated here rather than derived from the real groups,
 * because constructing those groups needs the very client that is missing.
 * `test/unit/mcp-unavailable-tools.test.ts` compares the two lists in both
 * directions — it caught seven names invented from memory in the first
 * version of this file, and two real ones missing from it. A stub for a tool
 * that does not exist is worse than no stub: the agent is told a capability
 * exists, tries it, and is given a reason that is false.
 */

import type { IMcpToolDef } from './types.js';

/** Tool names in each group that needs a live daemon. */
export const DAEMON_TOOL_NAMES: readonly string[] = [
  'apps.list', 'apps.start', 'apps.stop', 'apps.restart',
  'apps.status', 'apps.logs', 'apps.scale', 'apps.inspect',
  'infra.status', 'infra.containers', 'infra.connection', 'infra.start',
  'infra.stop', 'infra.logs', 'infra.log_stats', 'project.list',
  'project.scan', 'project.apps', 'stack.list', 'stack.status',
  'stack.start', 'stack.stop', 'secret.list', 'secret.get',
  'secret.set', 'backup.create', 'backup.list', 'backup.restore',
  'backup.schedules', 'deploy.app', 'deploy.rollback', 'deploy.history',
  'fleet.status', 'fleet.summary', 'pipeline.list', 'pipeline.run',
  'pipeline.status', 'health.check', 'metrics.get', 'metrics.app',
  'logs.query', 'logs.tail', 'logs.stats',
];

/** Tool names in the knowledge-base group. */
export const KB_TOOL_NAMES: readonly string[] = [
  'kb.query', 'kb.get_api', 'kb.get_module', 'kb.repo_map',
  'kb.get_pattern', 'kb.list_patterns', 'kb.get_gotchas', 'kb.search_symbols',
  'kb.dependencies', 'kb.index', 'kb.status',
];

/**
 * Build stubs that answer with `reason` instead of failing to exist.
 *
 * The handler throws rather than returning an error object: the bridge turns
 * a thrown error into a JSON-RPC error the client surfaces, whereas a
 * successful result carrying an error message reads to an agent as data.
 */
export function createUnavailableTools(names: readonly string[], reason: string): IMcpToolDef[] {
  return names.map((name) => ({
    name,
    description: `UNAVAILABLE — ${reason}`,
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      throw new Error(reason);
    },
  }));
}
