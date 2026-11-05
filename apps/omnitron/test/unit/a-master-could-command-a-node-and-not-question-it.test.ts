/**
 * A master could tell a node what to do and could not ask what it had done.
 *
 * A master reaches its nodes with a `service_role` token minted from the
 * node's own signing secret — no session, no human. `CONTROL_PLANE_ROLES`
 * exists for exactly that, and its docblock, written after the last time this
 * happened, says:
 *
 *     anything else the control plane asks a node to do needs it too, and
 *     spelling it out three times is how one of them ends up without it
 *
 * It happened again, on the reading half. `provisionStack` carried
 * `CONTROL_PLANE_ROLES` and answered. `getConnectionInfo` beside it carried
 * `VIEWER_ROLES` — the HUMAN hierarchy, which has no `service_role` in it —
 * and answered `Missing required role`, from a node that had just
 * authenticated the same credential for the strictly more powerful call.
 *
 * The consequence was not an error anyone saw. `readNodeCredentials` is
 * best-effort by design, so the master logged a warning, wrote the node's
 * config without the passwords, and `resolveStackAddresses` fell through to
 * its literal: six apps handed `postgres://postgres:postgres@…` against a
 * container holding a 43-character generated secret.
 *
 * And the same line was a leak in the other direction. `getConnectionInfo`
 * returns `password`, `accessKey` and `secretKey` — the platform's own
 * database password among them — from the READ-ONLY HUMAN tier. A viewer is
 * someone allowed to see that a service is healthy, not someone allowed to
 * connect to it as its owner.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VIEWER_ROLES,
  OPERATOR_ROLES,
  CONTROL_PLANE_ROLES,
  CONTROL_PLANE_READ_ROLES,
} from '../../src/shared/roles.js';
import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rpc = stripComments(
  fs.readFileSync(path.join(here, '../../src/services/infrastructure.rpc-service.ts'), 'utf8'),
);

/** The roles guarding one method, read from the source that declares them. */
function rolesFor(method: string): string {
  const at = rpc.indexOf(`async ${method}(`);
  expect(at, `${method} is declared`).toBeGreaterThan(-1);
  const decorator = rpc.lastIndexOf('@Public(', at);
  return rpc.slice(decorator, at);
}

describe('the mesh is a principal, not a rank', () => {
  it('keeps service_role out of the human hierarchy', () => {
    // It is not more than an operator or less than one. Typing it into the
    // ordering would make `hasRole('service_role', 'viewer')` a question with
    // an answer.
    expect(VIEWER_ROLES).not.toContain('service_role');
    expect(OPERATOR_ROLES).not.toContain('service_role');
  });

  it('gives the control plane a read set of its own', () => {
    expect(CONTROL_PLANE_READ_ROLES).toContain('service_role');
    // Everything a viewer may read, a master may read.
    for (const role of VIEWER_ROLES) expect(CONTROL_PLANE_READ_ROLES).toContain(role);
  });

  it('keeps the write set narrower than the read set', () => {
    expect(CONTROL_PLANE_ROLES).not.toContain('viewer');
    expect(CONTROL_PLANE_READ_ROLES).toContain('viewer');
  });
});

describe('what a master may ask a node', () => {
  it('may ask what it provisioned, having been allowed to provision it', () => {
    // The assertion the defect fails, and the shape worth remembering: the
    // strictly more powerful call was permitted and the strictly weaker read
    // was not.
    expect(rolesFor('provisionStack')).toContain('CONTROL_PLANE_ROLES');
    expect(rolesFor('getConnectionInfo')).toMatch(/CONTROL_PLANE_(READ_)?ROLES/);
  });

  it('may read the node\'s state and containers', () => {
    expect(rolesFor('getState')).toContain('CONTROL_PLANE_READ_ROLES');
    expect(rolesFor('listContainers')).toContain('CONTROL_PLANE_READ_ROLES');
  });
});

describe('a credential is not a reading', () => {
  it('does not hand connection secrets to the read-only human tier', () => {
    // `getConnectionInfo` returns `password`, `accessKey` and `secretKey`.
    // It sat on VIEWER_ROLES, so any account that could look at a dashboard
    // could read the platform's database password.
    const guard = rolesFor('getConnectionInfo');
    expect(guard).not.toContain('VIEWER_ROLES');
    expect(guard).not.toContain('CONTROL_PLANE_READ_ROLES');
    expect(guard).toContain('CONTROL_PLANE_ROLES');
  });

  it('returns the configured credentials through the actual infrastructure API', () => {
    const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };
    const infra = new InfrastructureService(logger as never, {
      postgres: { password: 'database-fixture', databases: { sample: {} } },
      redis: { password: 'cache-fixture' },
      minio: { accessKey: 'objects-fixture', secretKey: 'objects-secret-fixture' },
    });
    expect(infra.getConnectionInfo('postgres')).toMatchObject({ password: 'database-fixture' });
    expect(infra.getConnectionInfo('redis')).toMatchObject({ password: 'cache-fixture' });
    expect(infra.getConnectionInfo('minio')).toMatchObject({ accessKey: 'objects-fixture', secretKey: 'objects-secret-fixture' });
    expect(infra.getConnectionInfo('undeclared')).toBeNull();
  });
});
