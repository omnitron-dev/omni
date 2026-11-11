import { Injectable } from '@omnitron-dev/titan';
import {
  createDocumentAccessPredicate,
  projectDocumentAccess,
  parseDocumentSync,
  parseSafeFrontmatter,
  toCleanMarkdown,
  type LumenDocumentAst,
} from '@omnitron-dev/lumen-ast';
import type { AccessFilterOptions, LumenSessionContext } from '../interfaces.js';

export { defaultDocRoleHierarchy, defaultRoleGrants } from '@omnitron-dev/lumen-ast';

export function extractDocumentMetadata(content: string): { id?: string; title?: string; access: string } {
  const parsed = parseSafeFrontmatter(content);
  const { id, title, access } = parsed.frontmatter;
  return {
    id,
    title,
    access: parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      ? 'restricted'
      : (access ?? 'public'),
  };
}

export function extractDocumentAccess(content: string): string {
  return extractDocumentMetadata(content).access;
}

@Injectable()
export class AccessFilterService {
  constructor(private readonly options: AccessFilterOptions = {}) {}

  getEffectiveRoles(session?: LumenSessionContext | null): string[] {
    if (!session || session.valid !== true || !Array.isArray(session.roles)) return ['anonymous'];
    const roles = session.roles.filter((role): role is string => typeof role === 'string' && role.trim().length > 0);
    return roles.length > 0 ? roles : ['anonymous'];
  }

  isAllowed(userRoles: string[], accessLevel?: unknown): boolean {
    return createDocumentAccessPredicate(userRoles, this.options)(accessLevel);
  }

  filterSections<T extends { access?: string; level?: string }>(sections: T[], userRoles: string[]): T[] {
    const allows = createDocumentAccessPredicate(userRoles, this.options);
    return sections.filter((section) => allows(Object.hasOwn(section, 'access') ? section.access : section.level));
  }

  projectContent(content: string, userRoles: string[], explicitAccess?: string) {
    const allows = createDocumentAccessPredicate(userRoles, this.options);
    const result = projectDocumentAccess(
      parseDocumentSync(content),
      (access) => allows(explicitAccess) && allows(access)
    );
    return {
      ...result,
      content: result.allowed
        ? result.strippedAny
          ? toCleanMarkdown(result.ast, { includeFrontmatter: true })
          : content
        : null,
    };
  }

  filterRawMarkdownContent(content: string, userRoles: string[], explicitAccess?: string): string | null {
    return this.projectContent(content, userRoles, explicitAccess).content;
  }

  filterAst(ast: LumenDocumentAst, userRoles: string[]): LumenDocumentAst {
    return projectDocumentAccess(ast, createDocumentAccessPredicate(userRoles, this.options)).ast;
  }
}
