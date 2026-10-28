import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Netron } from '@omnitron-dev/titan/netron';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import { AccessRpcService } from '../../src/services/access.rpc-service.js';
import { AuthService } from '../../src/services/auth.service.js';
import { AuthRpcService } from '../../src/services/auth.rpc-service.js';
import { AuditService } from '../../src/services/audit.service.js';
import { createAuthContextWrapper, runWithAuth } from '../../src/services/auth-context.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';
import { requiresTestPostgres } from './requires-test-postgres.js';
import { ADMIN_ROLES, OPERATOR_ROLES, VIEWER_ROLES } from '../../src/shared/roles.js';

const url = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const pg = await requiresTestPostgres(url);
const local = <T>(fn: () => T) =>
  runWithAuth(
    { userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' } },
    fn
  );
const password = 'a-strong-test-only-passphrase';
@Service({ name: 'OmnitronPolicyProbe' })
class Probe {
  @Public({ auth: { roles: VIEWER_ROLES } }) read() {
    return 'read';
  }
  @Public({ auth: { roles: OPERATOR_ROLES } }) operate() {
    return 'operate';
  }
  @Public({ auth: { roles: ADMIN_ROLES } }) administer() {
    return 'administer';
  }
}

describe.skipIf(!pg.ok)('console account roles on PostgreSQL and HTTP', () => {
  let own: OwnDatabase,
    auth: AuthService,
    audit: AuditService,
    service: AccessRpcService,
    netron: Netron,
    server: HttpNativeServer,
    endpoint: string;
  beforeAll(async () => {
    own = await databaseOfItsOwn(url, `console_access_${process.pid}_${randomUUID().replaceAll('-', '')}`);
    const logger = createNullLogger();
    auth = new AuthService(own.db, 'console-access-integration-signing-secret');
    audit = new AuditService(logger, own.db);
    netron = new Netron(logger);
    netron.configureAuth(
      new AuthenticationManager(logger, {
        authenticate: async () => {
          throw new Error('Use a token');
        },
        validateToken: async (token) => {
          const validated = await auth.validateToken(token);
          if (!validated) throw new Error('Session revoked');
          return {
            userId: validated.userId,
            roles: [validated.role],
            permissions: [],
            metadata: { sessionId: validated.sessionId },
          };
        },
        tokenCache: { enabled: true, ttl: 60_000 },
      }),
      new AuthorizationManager(logger)
    );
    service = new AccessRpcService(own.db, auth, audit, netron);
    await netron.start();
    await netron.peer.exposeService(service);
    await netron.peer.exposeService(new Probe());
    await netron.peer.exposeService(new AuthRpcService(auth, netron));
    server = new HttpNativeServer({
      host: '127.0.0.1',
      port: 0,
      cors: false,
      invocationWrapper: createAuthContextWrapper(),
    });
    server.setPeer(netron.peer);
    await server.listen();
    endpoint = `http://127.0.0.1:${server.port}/netron/invoke`;
  });
  afterAll(async () => {
    await server?.close();
    await netron?.stop();
    await own?.drop();
  });
  async function request(token: string, method: string, input: unknown[] = [], serviceName = 'OmnitronAccess') {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: randomUUID(), service: serviceName, method, input }),
    });
    return { response, body: await response.json() };
  }
  const create = (username: string, role: 'viewer' | 'operator' | 'admin' = 'viewer') =>
    local(() => service.createUser({ username, password, role }));

  it('uses the published Titan gates for effective permissions; a viewer cannot list accounts', async () => {
    const user = await create('reader');
    expect(user).not.toHaveProperty('passwordHash');
    const session = await auth.signIn({ username: 'reader', password });
    const described = await request(session.accessToken, 'describe');
    expect(described.body.data.capabilities.filter((c: any) => c.service === 'OmnitronPolicyProbe')).toEqual([
      { service: 'OmnitronPolicyProbe', method: 'administer', roles: ADMIN_ROLES, allowed: false, conditional: false },
      { service: 'OmnitronPolicyProbe', method: 'operate', roles: OPERATOR_ROLES, allowed: false, conditional: false },
      { service: 'OmnitronPolicyProbe', method: 'read', roles: VIEWER_ROLES, allowed: true, conditional: false },
    ]);
    expect((await request(session.accessToken, 'listUsers')).response.status).toBe(403);
    expect(
      (await request(session.accessToken, 'createUser', [{ username: 'forged', password, role: 'admin' }])).response
        .status
    ).toBe(403);
    const events = await own.db
      .selectFrom('omnitron_audit_log')
      .selectAll()
      .where('resourceId', '=', user.id)
      .execute();
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(password);
    expect(JSON.stringify(await local(() => service.listUsers()))).not.toContain('passwordHash');
  });

  it('atomically changes a role, revokes sessions, clears cached HTTP authority and persistent peers', async () => {
    const user = await create('operator', 'operator');
    const signedIn = await auth.signIn({ username: 'operator', password });
    expect((await request(signedIn.accessToken, 'describe')).body.data.role).toBe('operator');
    const peer = {
      getAuthContext: () => ({ userId: user.id }),
      clearAuthContext: vi.fn(),
      close: vi.fn(async () => {}),
    };
    netron.peers.set('test-peer', peer as never);
    try {
      await local(() => service.setRole({ id: user.id, previous: 'operator', role: 'viewer' }));
      expect(peer.clearAuthContext).toHaveBeenCalledOnce();
      expect(peer.close).toHaveBeenCalledOnce();
      expect((await request(signedIn.accessToken, 'describe')).response.status).toBe(401);
      expect(await auth.validateSession(signedIn.session.id)).toBeNull();
      expect(
        await own.db
          .selectFrom('omnitron_audit_log')
          .select('action')
          .where('resourceId', '=', user.id)
          .where('action', '=', 'account.role.change')
          .execute()
      ).toHaveLength(1);
    } finally {
      netron.peers.delete('test-peer');
    }
  });

  it('protects the last administrator, rejects unknown roles, and prevents self role edits', async () => {
    const admin = await own.db
      .selectFrom('omnitron_users')
      .select(['id', 'role'])
      .where('username', '=', 'admin')
      .executeTakeFirstOrThrow();
    await expect(local(() => service.setRole({ id: admin.id, previous: 'admin', role: 'viewer' }))).rejects.toThrow(
      /last administrator/
    );
    await expect(
      local(() => service.setRole({ id: admin.id, previous: 'admin', role: 'service_role' as never }))
    ).rejects.toThrow(/Unknown/);
    const signedIn = await auth.signIn({ username: 'admin', password: 'admin' });
    expect(
      (await request(signedIn.accessToken, 'setRole', [{ id: admin.id, previous: 'admin', role: 'operator' }])).response
        .status
    ).toBe(403);
  });

  it('serializes concurrent edits and rejects a stale role instead of overwriting it', async () => {
    const user = await create('concurrent');
    const results = await Promise.allSettled([
      local(() => service.setRole({ id: user.id, previous: 'viewer', role: 'operator' })),
      local(() => service.setRole({ id: user.id, previous: 'viewer', role: 'admin' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('rolls back account changes and revocations when the audit insert cannot commit', async () => {
    const user = await create('rollback');
    const session = await auth.signIn({ username: 'rollback', password });
    const failingAudit = {
      inTransaction: () => ({
        record: async () => {
          throw new Error('audit unavailable');
        },
      }),
    } as unknown as AuditService;
    const unavailable = new AccessRpcService(own.db, auth, failingAudit, netron);
    await expect(
      local(() => unavailable.setRole({ id: user.id, previous: 'viewer', role: 'operator' }))
    ).rejects.toThrow('audit unavailable');
    expect((await auth.validateSession(session.session.id))?.role).toBe('viewer');
    await expect(
      local(() => unavailable.createUser({ username: 'not-committed', role: 'viewer', password }))
    ).rejects.toThrow('audit unavailable');
    expect(
      await own.db.selectFrom('omnitron_users').select('id').where('username', '=', 'not-committed').executeTakeFirst()
    ).toBeUndefined();
    expect(await local(() => service.revokeSessions({ id: user.id }))).toEqual({ revoked: 1 });
    expect(await auth.validateSession(session.session.id)).toBeNull();
  });

  it('applies the same password policy to creation and changes and revokes cached sessions', async () => {
    await expect(
      local(() => service.createUser({ username: 'weak', role: 'viewer', password: 'short' }))
    ).rejects.toThrow(/at least 15/);
    await create('password-check');
    const a = await auth.signIn({ username: 'password-check', password });
    const b = await auth.signIn({ username: 'password-check', password });
    await request(a.accessToken, 'describe');
    await request(b.accessToken, 'describe');
    expect(
      (
        await request(
          a.accessToken,
          'changePassword',
          [{ oldPassword: password, newPassword: 'short' }],
          'OmnitronAuth'
        )
      ).response.status
    ).toBe(400);
    const nextPassword = 'a-replacement-test-passphrase';
    expect(
      (
        await request(
          a.accessToken,
          'changePassword',
          [{ oldPassword: password, newPassword: nextPassword }],
          'OmnitronAuth'
        )
      ).response.status
    ).toBe(200);
    expect((await request(b.accessToken, 'describe')).response.status).toBe(401);
    expect((await request(a.accessToken, 'describe')).response.status).toBe(200);
    expect(
      (await request(a.accessToken, 'signOut', [{ sessionId: a.session.id }], 'OmnitronAuth')).response.status
    ).toBe(200);
    expect((await request(a.accessToken, 'describe')).response.status).toBe(401);
    await expect(auth.signIn({ username: 'password-check', password: nextPassword })).resolves.toHaveProperty(
      'accessToken'
    );
  });
});
