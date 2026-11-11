import { createRoleHierarchy, createPermissionChecker, type RoleHierarchy } from '@omnitron-dev/access';
import type { LumenDocumentAst } from '@omnitron-dev/lumen-ast';
import type { AccessFilterOptions } from '../interfaces.js';

export const defaultDocRoleHierarchy: RoleHierarchy = createRoleHierarchy({
  anonymous: { level: 0 },
  staff: { level: 10, inherits: ['anonymous'] },
  security_officer: { level: 20, inherits: ['staff'] },
  admin: { level: 30, inherits: ['security_officer'] },
});

export const defaultRoleGrants: Record<string, string[]> = {
  anonymous: ['docs.read.public'],
  staff: ['docs.read.public', 'docs.read.internal'],
  security_officer: ['docs.read.*'],
  admin: ['*'],
};

export class AccessFilterService {
  private readonly hierarchy: RoleHierarchy;
  private readonly grants: Record<string, string[]>;

  constructor(options?: AccessFilterOptions) {
    this.hierarchy = options?.hierarchy ?? defaultDocRoleHierarchy;
    this.grants = options?.grants ?? defaultRoleGrants;
  }

  getEffectiveRoles(session?: { valid: boolean; roles: string[] } | null): string[] {
    if (!session || !session.valid || !Array.isArray(session.roles) || session.roles.length === 0) {
      return ['anonymous'];
    }
    return session.roles;
  }

  isAllowed(userRoles: string[], accessLevel?: string): boolean {
    const level = (accessLevel ? String(accessLevel) : 'public').toLowerCase();

    // Standard public access is permitted to all
    if (level === 'public') {
      return true;
    }

    // Confidential and internal require valid non-empty roles
    if (!userRoles || !Array.isArray(userRoles) || userRoles.length === 0) {
      return false;
    }

    // Only known levels are permitted; non-standard clearances default to denied
    if (level !== 'internal' && level !== 'confidential') {
      return false;
    }

    const expanded = this.hierarchy.expandRoleSet(userRoles);
    const grantedKeys = expanded.flatMap((r) => this.grants[r] ?? []);
    const checker = createPermissionChecker(grantedKeys);

    if (level === 'internal') {
      return checker('docs.read.internal');
    }
    if (level === 'confidential') {
      return checker('docs.read.confidential');
    }

    return false;
  }

  filterSections<T extends { access?: string; level?: string }>(sections: T[], userRoles: string[]): T[] {
    return sections.filter((sec) => this.isAllowed(userRoles, sec.access ?? sec.level));
  }

  filterAst(ast: LumenDocumentAst, userRoles: string[]): LumenDocumentAst {
    const docAccess = ast.frontmatter?.access ?? 'public';
    if (!this.isAllowed(userRoles, docAccess)) {
      return {
        ...ast,
        frontmatter: {
          title: 'Restricted',
          access: docAccess,
        },
        children: [],
        toc: [],
      };
    }

    const filterChildren = (nodes: any[]): any[] =>
      nodes
        .filter((node) => {
          const nodeAccess = node.attributes?.access ?? node.access;
          if (nodeAccess && !this.isAllowed(userRoles, nodeAccess)) {
            return false;
          }
          return true;
        })
        .map((node) => {
          if (node.children && Array.isArray(node.children)) {
            return { ...node, children: filterChildren(node.children) };
          }
          return node;
        });

    const filteredToc = (ast.toc ?? []).filter((entry: any) => {
      const entryAccess = entry.access ?? entry.level_access;
      if (entryAccess && !this.isAllowed(userRoles, entryAccess)) {
        return false;
      }
      return true;
    });

    return {
      ...ast,
      children: filterChildren(ast.children ?? []),
      toc: filteredToc,
    };
  }
}
