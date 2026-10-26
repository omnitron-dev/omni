import { describe, expect, it } from 'vitest';
import { hasMinimumRole, VIEWER_ROLES, OPERATOR_ROLES, ADMIN_ROLES, type OmnitronRole } from '../../src/shared/roles.js';

describe('daemon roles use the shared policy without adopting application roles', () => {
  it('agrees with every existing explicit human gate', () => {
    for (const [required, accepted] of [
      ['viewer', VIEWER_ROLES], ['operator', OPERATOR_ROLES], ['admin', ADMIN_ROLES],
    ] as const) {
      for (const role of ['viewer', 'operator', 'admin', 'user', 'superadmin', 'service_role', 'constructor']) {
        expect(hasMinimumRole([role], required)).toBe((accepted as readonly string[]).includes(role));
      }
    }
  });
  it('refuses empty principals and unknown target roles', () => {
    expect(hasMinimumRole([], 'viewer')).toBe(false);
    expect(hasMinimumRole(['admin'], 'unknown' as OmnitronRole)).toBe(false);
  });
});
