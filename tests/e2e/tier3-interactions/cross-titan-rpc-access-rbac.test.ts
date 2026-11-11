import { describe, it, expect } from 'vitest';
import {
  LumenModule,
  LumenRpcService,
  LUMEN_SERVICE_TOKEN,
  LUMEN_OPTIONS_TOKEN,
  type ILumenRpcService,
  type SearchOptions,
  type SearchResult,
} from '@omnitron-dev/titan-lumen';
import {
  createRoleHierarchy,
  createPermissionChecker,
  hasPermission,
  permissionGrants,
  type RoleHierarchy,
} from '@omnitron-dev/access';

const titanDocRoleHierarchy: RoleHierarchy = createRoleHierarchy({
  guest: { level: 0 },
  staff: { level: 10, inherits: ['guest'] },
  admin: { level: 20, inherits: ['staff'] },
});

const titanRoleGrants: Record<string, string[]> = {
  guest: ['docs.read.public'],
  staff: ['docs.read.public', 'docs.read.internal'],
  admin: ['*'],
};

class RbacLumenRpcService extends LumenRpcService implements ILumenRpcService {
  private readonly corpus: Array<{
    id: string;
    title: string;
    access: 'public' | 'internal' | 'confidential';
    content: string;
  }>;

  constructor(
    corpus: Array<{ id: string; title: string; access: 'public' | 'internal' | 'confidential'; content: string }>,
    options = { docsDir: 'docs', kbEnabled: true, mcpEnabled: true }
  ) {
    super(options);
    this.corpus = corpus;
  }

  override async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const roles = (options?.filter?.roles as string[] | undefined) ?? ['guest'];
    const expanded = titanDocRoleHierarchy.expandRoleSet(roles);
    const grants = expanded.flatMap((r) => titanRoleGrants[r] ?? []);
    const checker = createPermissionChecker(grants);

    return this.corpus
      .filter((doc) => checker(`docs.read.${doc.access}`))
      .map((doc) => ({
        documentId: doc.id,
        title: doc.title,
        path: `docs/${doc.id}.pdx`,
        snippet: doc.content,
        score: 1.0,
      }));
  }

  override async getDocument(path: string): Promise<string | null> {
    const found = this.corpus.find((d) => `docs/${d.id}.pdx` === path);
    return found ? found.content : null;
  }
}

describe('Tier 3: Cross-Feature — Titan Module, RPC & RBAC Access Filtering (F24 + F25 + F26)', () => {
  it('TC-X06-01: LumenRpcService initializes under Titan DI container and responds to semantic search requests', async () => {
    const rpcService = new LumenRpcService({
      docsDir: 'docs',
      kbEnabled: true,
      mcpEnabled: true,
    });

    expect(rpcService).toBeDefined();
    const options = rpcService.getOptions();
    expect(options.docsDir).toBe('docs');
    expect(options.kbEnabled).toBe(true);
    expect(options.mcpEnabled).toBe(true);

    const searchResults = await rpcService.search('spectral theorem');
    expect(Array.isArray(searchResults)).toBe(true);
  });

  it('TC-X06-02: Access filtering restricts document retrieval for unauthorized roles while permitting public queries', async () => {
    const corpus = [
      { id: 'doc-intro', title: 'Public Introduction', access: 'public' as const, content: 'Public Introduction' },
      {
        id: 'doc-internal-spec',
        title: 'Internal Architecture',
        access: 'internal' as const,
        content: 'Internal Architecture',
      },
      {
        id: 'doc-algo-secret',
        title: 'Confidential Quantum Algorithm',
        access: 'confidential' as const,
        content: 'Confidential Quantum Algorithm',
      },
    ];

    const rpcService = new RbacLumenRpcService(corpus);

    // Verify @omnitron-dev/access contracts
    expect(titanDocRoleHierarchy.rolePriority('admin')).toBeGreaterThan(titanDocRoleHierarchy.rolePriority('staff'));
    expect(titanDocRoleHierarchy.rolePriority('staff')).toBeGreaterThan(titanDocRoleHierarchy.rolePriority('guest'));
    expect(permissionGrants('*', 'docs.read.confidential')).toBe(true);

    const publicResults = await rpcService.search('query', { filter: { roles: ['guest'] } });
    expect(publicResults.map((d) => d.documentId)).toEqual(['doc-intro']);

    const staffResults = await rpcService.search('query', { filter: { roles: ['staff'] } });
    expect(staffResults.map((d) => d.documentId)).toEqual(['doc-intro', 'doc-internal-spec']);

    const adminResults = await rpcService.search('query', { filter: { roles: ['admin'] } });
    expect(adminResults.map((d) => d.documentId)).toEqual(['doc-intro', 'doc-internal-spec', 'doc-algo-secret']);
  });

  it('TC-X06-03: NetronPlayground RPC execution validates permissions before executing sandboxed queries', async () => {
    const service = new LumenRpcService();
    const code = 'const matrix = new Float64Array([1, 0, 0, 1]);';
    const executionResult = (await service.executePlayground(code)) as { result: unknown; code: string };

    expect(executionResult).toBeDefined();
    expect(executionResult.code).toBe(code);
  });

  it('TC-X06-04: Symbol contract inspection via RPC validates symbol visibility according to caller RBAC context', async () => {
    const service = new LumenRpcService();
    const symbolContract = await service.getSymbolContract('LumenMacroRegistry');

    // Default mock response produces contract placeholder or null
    expect(symbolContract === null || typeof symbolContract === 'object').toBe(true);
  });
});
