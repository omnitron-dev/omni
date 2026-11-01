import { describe, expect, it } from 'vitest';
import { createRoleHierarchy, expandRoleSet } from '../access/index.js';
import { createSharedSessionAuthManager } from './shared-session.js';

const policy = createRoleHierarchy({
  reader: { level: 0 },
  editor: { level: 1, inherits: ['reader'] },
});

function manager(roles: string[], roleExpander: (roles: readonly string[]) => string[]) {
  const noop = () => {};
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return createSharedSessionAuthManager({
    logger: logger as never,
    jwtService: { verify: async () => ({ exp: Math.floor(Date.now() / 1000) + 300, sub: 'person-1', iss: 'workspace-a', sid: 'session-1', roles }) } as never,
    sessionRedis: { get: async key => key === 'workspace-a:session:session-1' ? 'person-1' : null },
    expectedIssuer: 'workspace-a',
    sessionKeyPrefix: 'workspace-a:session:',
    roleExpander,
  });
}

describe('shared-session role policy integration', () => {
  it('uses an application hierarchy without injecting platform-specific roles', async () => {
    const result = await manager(['editor'], policy.expandRoleSet).validateToken('token');
    expect(result.success).toBe(true);
    expect(result.context?.roles).toEqual(['reader', 'editor']);
    expect(result.context?.metadata?.['isServiceRole']).toBe(false);
  });

  it('keeps existing platform expansion available as an explicit preset', async () => {
    const result = await manager(['boss', 'admin'], expandRoleSet).validateToken('token');
    expect(result.success).toBe(true);
    expect(result.context?.roles).toEqual(['user', 'moderator', 'security', 'admin']);
  });

  it('rejects a human credential containing a service-only claim', async () => {
    const result = await manager(['editor', 'service_role'], policy.expandRoleSet).validateToken('token');
    expect(result.success).toBe(false);
    expect(result.context).toBeUndefined();
  });
});
