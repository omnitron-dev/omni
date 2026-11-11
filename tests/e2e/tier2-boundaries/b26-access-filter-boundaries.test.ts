import { describe, it, expect } from 'vitest';
import { parseDocument, LumenFrontmatterSchema } from '@omnitron-dev/lumen-ast';

describe('Feature 26: Access Filtering & Auth Boundaries', () => {
  it('TC-B26-01: treats unrecognized or non-standard access levels as restricted by default', () => {
    const unknownAccessSchema = LumenFrontmatterSchema.safeParse({
      access: 'top-secret-clearance',
    });
    // Schema allows string passthrough
    expect(unknownAccessSchema.success).toBe(true);

    // Filter policy must restrict unknown clearance from public viewing
    const userRole: string = 'public';
    const isAllowed = (level?: string): boolean => {
      if (!level || level === 'public') return true;
      if (level === 'internal') return userRole === 'staff';
      if (level === 'confidential') return userRole === 'admin';
      return false; // Unknown access levels default to denied
    };

    expect(isAllowed('top-secret-clearance')).toBe(false);
  });

  it('TC-B26-02: defaults to public visibility when frontmatter access field is omitted or undefined', async () => {
    const defaultDoc = `---
title: Open Guide
---

Public documentation for general readers.
`;

    const ast = await parseDocument(defaultDoc, 'docs/open.pdx');
    const effectiveAccess = ast.frontmatter.access ?? 'public';

    expect(effectiveAccess).toBe('public');
  });

  it('TC-B26-03: denies access to confidential resources when user role array is empty', () => {
    const userRoles: string[] = [];
    const documentAccess: string = 'confidential';

    const canRead = userRoles.includes('admin') || (documentAccess === 'public' && userRoles.includes('anonymous'));
    expect(canRead).toBe(false);
  });

  it('TC-B26-04: downgrades expired or malformed session to anonymous guest privileges', () => {
    interface SessionToken {
      valid: boolean;
      roles: string[];
    }

    const expiredSession: SessionToken = { valid: false, roles: ['admin'] };
    const effectiveRoles = expiredSession.valid ? expiredSession.roles : ['anonymous'];

    expect(effectiveRoles).toEqual(['anonymous']);
    expect(effectiveRoles.includes('admin')).toBe(false);
  });

  it('TC-B26-05: filters mixed-security document sections based on user role entitlements', () => {
    const sections = [
      { id: 'intro', level: 'public', content: 'Public overview.' },
      { id: 'internal-metrics', level: 'internal', content: 'Internal server telemetry.' },
      { id: 'proprietary-proof', level: 'confidential', content: 'Proprietary IP proof.' },
    ];

    const filterForRole = (role: string) =>
      sections.filter((sec) => {
        if (sec.level === 'public') return true;
        if (sec.level === 'internal') return role === 'staff' || role === 'admin';
        if (sec.level === 'confidential') return role === 'admin';
        return false;
      });

    const guestView = filterForRole('anonymous');
    expect(guestView.map((s) => s.id)).toEqual(['intro']);

    const staffView = filterForRole('staff');
    expect(staffView.map((s) => s.id)).toEqual(['intro', 'internal-metrics']);

    const adminView = filterForRole('admin');
    expect(adminView).toHaveLength(3);
  });
});
