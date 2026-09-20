/**
 * The fleet view asked a node what it was running and was refused.
 *
 * Third instance of one shape, and the docblock on `CONTROL_PLANE_ROLES`
 * named it before the first: "anything else the control plane asks a node to
 * do needs it too, and spelling it out three times is how one of them ends up
 * without it". It was `provisionStack` once, `getConnectionInfo` the second
 * time, and now the three questions the fleet view exists to ask.
 *
 * Measured after the mesh was wired into `fleet health`, against a node that
 * had joined the mesh forty seconds earlier:
 *
 *     fail daos-test (37.27.130.185:9700) — unreachable: Missing required role
 *
 * `OmnitronDaemon.status`, `getHealth` and `getMetrics` carried
 * `VIEWER_ROLES` — the HUMAN hierarchy, which has no `service_role` in it —
 * so a master could deploy applications to a node and could not ask it how
 * they were doing.
 *
 * And the same file held the leak in the other direction. `getEnv` returns
 * an app's resolved environment — `DATABASE_URL` with the generated
 * password, `JWT_SECRET`, the chain RPC credentials — from the READ-ONLY
 * HUMAN tier. A viewer is someone allowed to see that an app is healthy, not
 * someone allowed to connect to its database as its owner.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTROL_PLANE_READ_ROLES, CONTROL_PLANE_ROLES, VIEWER_ROLES } from '../../src/shared/roles.js';
import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rpc = stripComments(
  fs.readFileSync(path.join(here, '../../src/daemon/daemon.rpc-service.ts'), 'utf8'),
);

/** The roles guarding one method, read from the source that declares them. */
function rolesFor(method: string): string {
  const at = rpc.indexOf(`async ${method}(`);
  expect(at, `${method} is declared`).toBeGreaterThan(-1);
  return rpc.slice(rpc.lastIndexOf('@Public(', at), at);
}

describe('a master may ask a node what it is running', () => {
  it('lets the control plane make the fleet view\'s three reads', () => {
    for (const method of ['status', 'getHealth', 'getMetrics']) {
      expect(rolesFor(method), method).toContain('CONTROL_PLANE_READ_ROLES');
    }
  });

  it('covers the rest of the node page with the same name', () => {
    // One name, not a fourth hand-written list: that is how the last one
    // ended up missing a method.
    for (const method of ['list', 'getApp', 'getLogs', 'inspect', 'getDependencyGraph', 'getWatchStatus']) {
      expect(rolesFor(method), method).toContain('CONTROL_PLANE_READ_ROLES');
    }
  });

  it('still admits every human who could read before', () => {
    for (const role of VIEWER_ROLES) {
      expect(CONTROL_PLANE_READ_ROLES, role).toContain(role);
    }
    expect(CONTROL_PLANE_READ_ROLES).toContain('service_role');
  });
});

describe('an app\'s environment is not a read for viewers', () => {
  it('keeps getEnv out of the human read tier', () => {
    const roles = rolesFor('getEnv');

    expect(roles).not.toContain('VIEWER_ROLES');
    expect(roles).toContain('CONTROL_PLANE_ROLES');
  });

  it('is the tier that starts at operator', () => {
    expect(CONTROL_PLANE_ROLES).not.toContain('viewer');
    expect(CONTROL_PLANE_ROLES).toContain('operator');
    expect(CONTROL_PLANE_ROLES).toContain('service_role');
  });

  it('does not widen anything that changes the node', () => {
    // The reads moved; the writes did not. `restartApp` and `shutdown` are
    // the two ends of that, and both stay where they were.
    expect(rolesFor('restartApp')).toContain('OPERATOR_ROLES');
    expect(rolesFor('shutdown')).toContain('ADMIN_ROLES');
  });
});
