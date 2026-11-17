/**
 * What an MCP agent sees when the daemon is down or the KB is unindexed.
 *
 * `omnitron kb mcp` used to register nothing in either case and write the
 * explanation to stderr — which no MCP client reads. So the agent did not
 * see the tools at all, and an agent that cannot see a tool tells its user
 * the capability does not exist. "The daemon is not running, run
 * `omnitron up`" is one round trip and an actionable answer; silence is
 * neither.
 *
 * The behaviour was promised twice before it existed: by the comment in
 * kb.ts ("register stub tools that return helpful errors") and by the docs
 * ("When unavailable: Run `omnitron up` to start the daemon").
 */

import { beforeAll, describe, it, expect, vi } from 'vitest';
import { kbMcpCommand } from '../../src/commands/kb.js';
import { McpBridge } from '../../src/mcp/mcp-bridge.js';

import {
  createUnavailableTools,
  DAEMON_TOOL_NAMES,
  KB_TOOL_NAMES,
} from '../../src/mcp/unavailable-tools.js';

vi.mock('@omnitron-dev/kb', () => ({ KnowledgeBase: class { async initialize() {} } }));
vi.mock('@omnitron-dev/kb/surreal', () => ({ SurrealKbStore: class {} }));
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({ isReachable: async () => true }),
}));

describe('stub tools', () => {
  it('answer with the reason instead of not existing', async () => {
    const [tool] = createUnavailableTools(['apps.list'], 'The daemon is not running.');

    expect(tool!.name).toBe('apps.list');
    // Thrown, not returned: the bridge turns a throw into a JSON-RPC error
    // the client surfaces, while a successful result carrying an error
    // message reads to an agent as data about the apps.
    await expect(tool!.handler({})).rejects.toThrow('The daemon is not running.');
  });

  it('say they are unavailable in the description an agent reads first', () => {
    const [tool] = createUnavailableTools(['kb.query'], 'Run `omnitron kb index` first.');

    expect(tool!.description).toContain('UNAVAILABLE');
    expect(tool!.description).toContain('omnitron kb index');
  });

  it('carry an input schema, so a client that validates does not reject them', () => {
    for (const tool of createUnavailableTools(['apps.list'], 'x')) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
    }
  });
});

describe('the stub list matches the real one', () => {
  // The stub names are duplicated rather than derived, because the real
  // groups need the very client that is missing to be constructed. That
  // duplication is only safe while something compares the two.
  const real = { kb: new Set<string>(), daemon: new Set<string>() };
  beforeAll(async () => {
    const registration = vi.spyOn(McpBridge.prototype, 'registerTools');
    const stdio = vi.spyOn(McpBridge.prototype, 'start').mockResolvedValue();
    try {
      await kbMcpCommand();
      for (const tool of registration.mock.calls.flatMap(([tools]) => tools)) {
        expect(tool.description).not.toContain('UNAVAILABLE');
        (tool.name.startsWith('kb.') ? real.kb : real.daemon).add(tool.name);
      }
    } finally {
      registration.mockRestore();
      stdio.mockRestore();
    }
  });

  it('found both sides', () => {
    expect(real.kb.size).toBeGreaterThan(5);
    expect(real.daemon.size).toBeGreaterThan(20);
    expect(real.daemon.has('pipeline.start')).toBe(true);
    expect(real.daemon.has('pipeline.resume')).toBe(true);
  });

  it('covers every KB tool', () => {
    expect([...real.kb].filter((n) => !KB_TOOL_NAMES.includes(n))).toEqual([]);
  });

  it('covers every daemon tool', () => {
    expect([...real.daemon].filter((n) => !DAEMON_TOOL_NAMES.includes(n))).toEqual([]);
  });

  it('invents none that the daemon does not have', () => {
    // A stub for a tool that does not exist is worse than no stub: the agent
    // is told a capability exists, tries it, and gets a reason that is false.
    const all = new Set([...real.kb, ...real.daemon]);
    expect([...KB_TOOL_NAMES, ...DAEMON_TOOL_NAMES].filter((n) => !all.has(n))).toEqual([]);
  });
});
