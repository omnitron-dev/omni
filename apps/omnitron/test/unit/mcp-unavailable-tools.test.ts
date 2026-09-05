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

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createUnavailableTools,
  DAEMON_TOOL_NAMES,
  KB_TOOL_NAMES,
} from '../../src/mcp/unavailable-tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const groupsDir = path.resolve(here, '../../src/mcp/tool-groups');

/** Tool names the real groups register, read out of their source. */
function realToolNames(): { kb: Set<string>; daemon: Set<string> } {
  const kb = new Set<string>();
  const daemon = new Set<string>();
  for (const file of fs.readdirSync(groupsDir)) {
    const text = fs.readFileSync(path.join(groupsDir, file), 'utf8');
    for (const m of text.matchAll(/name: '([a-z_]+\.[a-z_]+)'/g)) {
      (file === 'kb.tools.ts' ? kb : daemon).add(m[1]!);
    }
  }
  return { kb, daemon };
}

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
  const real = realToolNames();

  it('found both sides', () => {
    expect(real.kb.size).toBeGreaterThan(5);
    expect(real.daemon.size).toBeGreaterThan(20);
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
