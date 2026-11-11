import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LumenShell, PortalIslandHost } from '@omnitron-dev/lumen-ui';
import {
  LumenRpcService,
  type ILumenRpcService,
  type SearchOptions,
  type SearchResult,
} from '@omnitron-dev/titan-lumen';
import { LumenFrontmatterSchema } from '@omnitron-dev/lumen-ast';
import { createRoleHierarchy, createPermissionChecker, hasPermission, type RoleHierarchy } from '@omnitron-dev/access';

interface PortalSection {
  id: string;
  title: string;
  access: 'public' | 'internal' | 'confidential';
  content: string;
}

const portalRoleHierarchy = createRoleHierarchy({
  anonymous: { level: 0 },
  staff: { level: 10, inherits: ['anonymous'] },
  security_officer: { level: 20, inherits: ['staff'] },
  admin: { level: 30, inherits: ['security_officer'] },
});

const roleGrants: Record<string, string[]> = {
  anonymous: ['docs.read.public'],
  staff: ['docs.read.public', 'docs.read.internal'],
  security_officer: ['docs.read.*'],
  admin: ['*'],
};

class EnterprisePortalRpcService extends LumenRpcService implements ILumenRpcService {
  constructor(
    private readonly sections: PortalSection[],
    options = { docsDir: 'docs/enterprise', kbEnabled: true, mcpEnabled: true }
  ) {
    super(options);
  }

  getPermittedSections(userRoles: string[]): PortalSection[] {
    const expandedRoles = portalRoleHierarchy.expandRoleSet(userRoles);
    const grants = expandedRoles.flatMap((role) => roleGrants[role] ?? []);
    const checker = createPermissionChecker(grants);
    return this.sections.filter((section) => checker(`docs.read.${section.access}`));
  }

  override async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const userRoles = (options?.filter?.roles as string[] | undefined) ?? ['anonymous'];
    const permitted = this.getPermittedSections(userRoles);
    const q = query.toLowerCase();
    return permitted
      .filter(
        (s) =>
          s.id.toLowerCase().includes(q) || s.content.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)
      )
      .map((s) => ({
        documentId: s.id,
        title: s.title,
        path: `docs/enterprise/${s.id}.pdx`,
        snippet: s.content,
        score: 1.0,
      }));
  }
}

describe('Tier 4: Scenario 04 — Enterprise RBAC Documentation Portal', () => {
  const documentationSections: PortalSection[] = [
    {
      id: 'sec-overview',
      title: 'Platform Architecture Overview',
      access: 'public',
      content: 'Omnitron Lumen provides high-performance documentation compilers.',
    },
    {
      id: 'sec-internal-api',
      title: 'Internal Cluster Topologies',
      access: 'internal',
      content: 'Internal gRPC mesh topology details for distributed cluster workers.',
    },
    {
      id: 'sec-cryptographic-keys',
      title: 'Hardware Security Module Key Hierarchy',
      access: 'confidential',
      content: 'Root keys and derivation paths for hardware security module signing.',
    },
  ];

  it('enforces role-based section gating across public, internal, and confidential access tiers', async () => {
    // Validate schema compliance for each access level using frontmatter contract
    for (const section of documentationSections) {
      const parsed = LumenFrontmatterSchema.safeParse({
        title: section.title,
        access: section.access,
      });
      expect(parsed.success).toBe(true);
    }

    // Verify @omnitron-dev/access RoleHierarchy contracts
    expect(portalRoleHierarchy.effectiveLevel(['admin'])).toBeGreaterThan(
      portalRoleHierarchy.effectiveLevel(['staff'])
    );
    expect(portalRoleHierarchy.canSeeRole(['admin'], 'staff')).toBe(true);
    expect(portalRoleHierarchy.canModerateRole(['admin'], 'staff')).toBe(true);
    expect(portalRoleHierarchy.canModerateRole(['staff'], 'admin')).toBe(false);

    const portalRpc = new EnterprisePortalRpcService(documentationSections);

    // 1. Anonymous visitor sees only public sections
    const publicView = portalRpc.getPermittedSections(['anonymous']);
    expect(publicView.map((s) => s.id)).toEqual(['sec-overview']);

    // 2. Staff member sees public and internal sections
    const staffView = portalRpc.getPermittedSections(['staff']);
    expect(staffView.map((s) => s.id)).toEqual(['sec-overview', 'sec-internal-api']);

    // 3. Security Officer / Admin sees all sections including confidential
    const adminView = portalRpc.getPermittedSections(['admin']);
    expect(adminView.map((s) => s.id)).toEqual(['sec-overview', 'sec-internal-api', 'sec-cryptographic-keys']);

    // 4. SSR markup for permitted content mounts interactive Island with RBAC role metadata
    const portalHtml = renderToStaticMarkup(
      React.createElement(
        LumenShell,
        { theme: 'dark', locale: 'en' },
        adminView.map((sec) =>
          React.createElement(
            'section',
            { key: sec.id, id: sec.id, 'data-access': sec.access },
            React.createElement('h2', null, sec.title),
            React.createElement(PortalIslandHost, {
              islandId: `island-${sec.id}`,
              hydrate: sec.access === 'confidential' ? 'interaction' : 'idle',
              props: { accessTier: sec.access },
            })
          )
        )
      )
    );

    expect(portalHtml).toContain('data-access="public"');
    expect(portalHtml).toContain('data-access="internal"');
    expect(portalHtml).toContain('data-access="confidential"');
    expect(portalHtml).toContain('data-hydrate="interaction"');
  });

  it('validates Titan RPC controller responds with filtered results under RBAC context', async () => {
    const portalRpc = new EnterprisePortalRpcService(documentationSections);

    const options = portalRpc.getOptions();
    expect(options.kbEnabled).toBe(true);

    // Anonymous query returns only matching public content
    const anonymousResults = await portalRpc.search('architecture', {
      filter: { roles: ['anonymous'] },
    });
    expect(anonymousResults.map((r) => r.documentId)).toEqual(['sec-overview']);

    // Anonymous query cannot access internal content
    const anonymousInternalResults = await portalRpc.search('cluster', {
      filter: { roles: ['anonymous'] },
    });
    expect(anonymousInternalResults).toHaveLength(0);

    // Staff query can access internal cluster topologies
    const staffInternalResults = await portalRpc.search('cluster', {
      filter: { roles: ['staff'] },
    });
    expect(staffInternalResults.map((r) => r.documentId)).toEqual(['sec-internal-api']);

    // Admin query can access confidential cryptographic key hierarchy
    const adminCryptoResults = await portalRpc.search('cryptographic', {
      filter: { roles: ['admin'] },
    });
    expect(adminCryptoResults.map((r) => r.documentId)).toEqual(['sec-cryptographic-keys']);
  });
});
