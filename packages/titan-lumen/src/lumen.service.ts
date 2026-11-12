import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { extname, resolve } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import ts from 'typescript';
import { Injectable, Service } from '@omnitron-dev/titan';
import { Public, getCurrentInvocationContext } from '@omnitron-dev/titan/netron';
import { Errors } from '@omnitron-dev/titan/errors';
import { parseDocument, type LumenNode } from '@omnitron-dev/lumen-ast';
import { PLAYGROUND_LIMITS } from '@omnitron-dev/lumen-ast/execution/limits';
import { DEFAULT_DOCS_DIR } from './constants.js';
import { isCanonicalDocumentPath, readCorpusFile, scanCorpusFiles } from './corpus-files.js';
import {
  AccessFilterService,
  extractDocumentAccess,
  extractDocumentMetadata,
} from './access/access-filter.service.js';
import { LiveEditService } from './live/live-edit.service.js';
import type {
  LumenModuleOptions,
  LumenServiceContract,
  LiveEditPayload,
  LiveEditResult,
  LumenEditableDocument,
  PlaygroundResult,
  SearchOptions,
  SearchResult,
  SymbolContract,
  TheoremGraphData,
} from './types.js';

export const MAX_PLAYGROUND_CODE_BYTES = PLAYGROUND_LIMITS.codeBytes;
export const PLAYGROUND_EXECUTION_TIMEOUT_MS = PLAYGROUND_LIMITS.timeoutMs;
export const PLAYGROUND_WALL_TIMEOUT_MS = 5000;
const MAX_ACTIVE_PLAYGROUNDS = 4;
export const MAX_DOC_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB

const ALLOWED_DOC_EXTENSIONS = new Set(['.pdx', '.md', '.mdx']);
const ALLOWED_TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

// The bootstrap is trusted host code; user code is data evaluated only by WASM.
const PLAYGROUND_WORKER_SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.engine).then(async ({ evaluatePlayground }) => {
  try {
    parentPort.postMessage({ ok: true, result: await evaluatePlayground(workerData.code) });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: String(error?.message ?? error).slice(0, 2048) });
  }
}).catch(error => parentPort.postMessage({ ok: false, error: String(error?.message ?? error).slice(0, 2048) }));
`;

function cloneModuleOptions(opts: LumenModuleOptions): LumenModuleOptions {
  const cloned: LumenModuleOptions = { ...opts };
  if (opts.accessFilter) {
    cloned.accessFilter = {
      ...opts.accessFilter,
      ...(opts.accessFilter.grants ? { grants: { ...opts.accessFilter.grants } } : {}),
    };
  }
  if (opts.corpusLimits) cloned.corpusLimits = { ...opts.corpusLimits };
  if (opts.liveEdit) {
    cloned.liveEdit = { ...opts.liveEdit };
  }
  return cloned;
}

function extractFirstHeading(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) {
    return content;
  }
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return match ? content.slice(match[0].length) : content;
}

function inferKbEntryAccess(content: string, tags: string[]): string {
  const fmAccess = extractDocumentAccess(content);
  if (fmAccess !== 'public') {
    return fmAccess;
  }
  for (const tag of tags) {
    const normalized = tag.toLowerCase().trim();
    if (normalized === 'confidential' || normalized === 'access:confidential') {
      return 'confidential';
    }
    if (normalized === 'internal' || normalized === 'access:internal') {
      return 'internal';
    }
  }
  return 'public';
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return Boolean(modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function extractSymbolFromSourceFile(
  sourceFile: ts.SourceFile,
  targetSymbol: string,
  displayPath: string
): SymbolContract | null {
  const sourceText = sourceFile.text;

  for (const stmt of sourceFile.statements) {
    if (ts.isClassDeclaration(stmt) && stmt.name?.text === targetSymbol && hasExportModifier(stmt)) {
      const methods: Record<string, unknown> = {};
      for (const member of stmt.members) {
        const isPrivateOrProtected =
          ts.canHaveModifiers(member) &&
          Boolean(
            ts
              .getModifiers(member)
              ?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)
          );
        if (isPrivateOrProtected || (member.name && ts.isPrivateIdentifier(member.name))) {
          continue;
        }
        if ((ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) && member.name) {
          const memberName = member.name.getText(sourceFile);
          const memberType = member.type ? member.type.getText(sourceFile) : 'unknown';
          methods[memberName] = memberType;
        }
      }
      return {
        name: targetSymbol,
        kind: 'class',
        filePath: displayPath,
        signatures: [`class ${targetSymbol}`],
        ...(Object.keys(methods).length > 0 ? { methods } : {}),
      };
    }

    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === targetSymbol && hasExportModifier(stmt)) {
      const methods: Record<string, unknown> = {};
      for (const member of stmt.members) {
        if ((ts.isMethodSignature(member) || ts.isPropertySignature(member)) && member.name) {
          const memberName = member.name.getText(sourceFile);
          const memberType = member.type ? member.type.getText(sourceFile) : 'unknown';
          methods[memberName] = memberType;
        }
      }
      return {
        name: targetSymbol,
        kind: 'interface',
        filePath: displayPath,
        signatures: [`interface ${targetSymbol}`],
        ...(Object.keys(methods).length > 0 ? { methods } : {}),
      };
    }

    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === targetSymbol && hasExportModifier(stmt)) {
      const start = stmt.getStart(sourceFile);
      const bodyStart = stmt.body ? stmt.body.getStart(sourceFile) : stmt.getEnd();
      const sig = sourceText
        .slice(start, bodyStart)
        .trim()
        .replace(/^export\s+/, '');
      return {
        name: targetSymbol,
        kind: 'function',
        filePath: displayPath,
        signatures: [sig],
      };
    }

    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === targetSymbol && hasExportModifier(stmt)) {
      return {
        name: targetSymbol,
        kind: 'type',
        filePath: displayPath,
        signatures: [
          stmt
            .getText(sourceFile)
            .replace(/^export\s+/, '')
            .split('\n')[0] ?? `type ${targetSymbol}`,
        ],
      };
    }

    if (ts.isEnumDeclaration(stmt) && stmt.name.text === targetSymbol && hasExportModifier(stmt)) {
      return {
        name: targetSymbol,
        kind: 'enum',
        filePath: displayPath,
        signatures: [`enum ${targetSymbol}`],
      };
    }

    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === targetSymbol) {
          return {
            name: targetSymbol,
            kind: 'const',
            filePath: displayPath,
            signatures: [`const ${targetSymbol}`],
          };
        }
      }
    }
  }

  return null;
}

@Service('Lumen')
@Injectable()
export class LumenService implements LumenServiceContract {
  private readonly options: LumenModuleOptions;
  private readonly accessFilter: AccessFilterService;
  private readonly liveEdit: LiveEditService;

  constructor(options: LumenModuleOptions = {}, accessFilter?: AccessFilterService, liveEdit?: LiveEditService) {
    this.options = cloneModuleOptions(options);
    this.accessFilter = accessFilter ?? new AccessFilterService(this.options.accessFilter);
    this.liveEdit = liveEdit ?? new LiveEditService(this.options.liveEdit);
  }

  getOptions(): LumenModuleOptions {
    return cloneModuleOptions(this.options);
  }

  getAccessFilterService(): AccessFilterService {
    return this.accessFilter;
  }

  getLiveEditService(): LiveEditService {
    return this.liveEdit;
  }

  private callerRoles(): string[] {
    return [...(getCurrentInvocationContext()?.auth?.roles ?? ['anonymous'])];
  }

  private requireMutation(method: 'executePlayground' | 'saveLiveEdit' | 'getEditableDocument') {
    const invocation = getCurrentInvocationContext();
    if (!invocation?.auth) throw Errors.unauthorized('An authenticated Netron invocation is required');
    if (invocation.serviceName !== 'Lumen' || invocation.methodName !== method) {
      throw Errors.forbidden('The operation must enter through its published Netron method');
    }
    return invocation.auth;
  }

  private activeCorpusReads = 0;

  private async withCorpusRead<T>(read: () => Promise<T>): Promise<T> {
    if (this.activeCorpusReads >= 4) throw Errors.tooManyRequests(1);
    this.activeCorpusReads++;
    try { return await read(); }
    finally { this.activeCorpusReads--; }
  }

  private async corpusRoot(directory: string): Promise<string> {
    const root = await realpath(resolve(directory));
    if (!(await stat(root)).isDirectory()) throw new Error('Configured corpus root is not a directory');
    return root;
  }

  private async readDocuments() {
    const root = await this.corpusRoot(this.options.docsDir ?? DEFAULT_DOCS_DIR);
    const stored = this.liveEdit.isEnabled() ? await this.liveEdit.readCorpus(this.options.corpusLimits) : [];
    const remainingBytes = (this.options.corpusLimits?.maxBytes ?? 64 * 1024 * 1024) -
      stored.reduce((bytes, document) => bytes + Buffer.byteLength(document.content), 0);
    const files = await scanCorpusFiles(root, ALLOWED_DOC_EXTENSIONS, MAX_DOC_FILE_BYTES,
      { ...this.options.corpusLimits, maxBytes: remainingBytes }, new Set(stored.map(document => document.docId)));
    files.push(...stored.map(document => ({ path: document.docId, content: document.content })));
    if (files.length > (this.options.corpusLimits?.maxEntries ?? 10_000)) throw new RangeError('Combined corpus entry budget exceeded');
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const ids = new Set<string>();
    return files.map(({ path, content }) => {
      const meta = extractDocumentMetadata(content);
      const id = meta.id ?? path;
      if (ids.has(id)) throw new Error('Duplicate document identity in the configured corpus');
      ids.add(id);
      return {
        id,
        title: meta.title ?? extractFirstHeading(stripFrontmatter(content)) ?? path.replace(/\.(pdx|mdx?)$/i, ''),
        path, content, access: meta.access,
      };
    });
  }

  @Public({ auth: { allowAnonymous: true } })
  async search(query: string, searchOptions?: SearchOptions): Promise<SearchResult[]> {
    return this.withCorpusRead(async () => {
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return [];
      }

      if (Buffer.byteLength(query) > 4096) throw Errors.badRequest('Search query exceeds 4096 bytes');
      const limit = searchOptions?.limit ?? 10;
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100) {
        throw Errors.badRequest('Search limit must be an integer from 0 to 100');
      }
      if (limit === 0) return [];
      const effectiveRoles = this.callerRoles();
      const trimmedQuery = query.trim();
      const lowerQuery = trimmedQuery.toLowerCase();
      const results: SearchResult[] = [];
      const seenIds = new Set<string>();

      // 1. Merge results from @omnitron-dev/kb KnowledgeBase when configured
      if (this.options.knowledgeBase && this.accessFilter.isAllowed(effectiveRoles, this.options.knowledgeBaseAccess ?? 'internal')) {
        try {
          const kbResult = await this.options.knowledgeBase.query(trimmedQuery, { maxResults: limit });
          for (const entry of kbResult.entries ?? []) {
            const entryAccess = inferKbEntryAccess(entry.content ?? '', entry.tags ?? []);
            const { content: projectedContent, strippedAny } = this.accessFilter.projectContent(
              entry.content ?? '', effectiveRoles, entryAccess
            );
            if (projectedContent === null) {
              continue;
            }
            const projectedBody = stripFrontmatter(projectedContent).trim();
            if (
              strippedAny &&
              !entry.title.toLowerCase().includes(lowerQuery) &&
              !projectedBody.toLowerCase().includes(lowerQuery)
            ) {
              continue;
            }
            if (seenIds.has(entry.id)) {
              continue;
            }
            seenIds.add(entry.id);
            results.push({
              documentId: entry.id,
              title: entry.title,
              path: `${entry.module}/${entry.id}`,
              snippet: projectedBody.slice(0, 160),
              score: 0.95,
            });
            if (results.length >= limit) {
              return results;
            }
          }
        } catch (error) {
          throw Errors.internal('Unable to search the configured knowledge base', error as Error);
        }
      }

      try {
        const diskDocs = await this.readDocuments();
        for (const doc of diskDocs) {
          const projectedContent = this.accessFilter.filterRawMarkdownContent(
            doc.content,
            effectiveRoles,
            doc.access
          );
          if (projectedContent === null) {
            continue;
          }

          const bodyText = stripFrontmatter(projectedContent);
          const matchTitle = doc.title.toLowerCase().includes(lowerQuery);
          const matchContent = bodyText.toLowerCase().includes(lowerQuery);
          const matchPath = doc.path.toLowerCase().includes(lowerQuery);

          if (matchTitle || matchContent || matchPath) {
            if (!seenIds.has(doc.id)) {
              seenIds.add(doc.id);
              results.push({
                documentId: doc.id,
                title: doc.title,
                path: doc.path,
                snippet: bodyText.trim().slice(0, 160),
                score: matchTitle ? 1.0 : 0.85,
              });
            }
          }

          if (results.length >= limit) {
            return results;
          }
        }
      } catch (error) {
        throw Errors.internal('Unable to read the configured documentation corpus', error as Error);
      }

      return results;
    });
  }

  private activePlaygrounds = 0;

  @Public({ auth: { permissions: ['lumen.playground.execute'] } })
  async executePlayground(code: string): Promise<PlaygroundResult> {
    this.requireMutation('executePlayground');
    if (typeof code !== 'string') {
      return { code: String(code), result: null, error: 'Code must be a string' };
    }

    if (this.options.enablePlayground === false) {
      return {
        code,
        result: null,
        error: 'Playground execution is disabled',
      };
    }

    if (Buffer.byteLength(code, 'utf8') > MAX_PLAYGROUND_CODE_BYTES) {
      return {
        code,
        result: null,
        error: `Playground code exceeds maximum size limit of ${MAX_PLAYGROUND_CODE_BYTES} bytes`,
      };
    }

    if (this.activePlaygrounds >= MAX_ACTIVE_PLAYGROUNDS) throw Errors.tooManyRequests(Math.ceil(PLAYGROUND_WALL_TIMEOUT_MS / 1000));
    this.activePlaygrounds++;
    return new Promise<PlaygroundResult>((resolvePromise) => {
      let settled = false;
      let worker: Worker | undefined;

      const finish = (outcome: PlaygroundResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(wallClockTimer);
        // Capacity is released only after the physical worker has exited.
        const release = () => { this.activePlaygrounds--; resolvePromise(outcome); };
        if (worker) void worker.terminate().then(release, release);
        else release();
      };

      const wallClockTimer = setTimeout(() => {
        finish({
          code,
          result: null,
          error: `Script execution timed out after ${PLAYGROUND_WALL_TIMEOUT_MS}ms`,
        });
      }, PLAYGROUND_WALL_TIMEOUT_MS);
      wallClockTimer.unref?.();

      try {
        worker = new Worker(PLAYGROUND_WORKER_SCRIPT, {
          eval: true,
          execArgv: [],
          workerData: {
            code,
            engine: import.meta.resolve('@omnitron-dev/lumen-ast/execution'),
          },
          env: {},
          resourceLimits: {
            maxOldGenerationSizeMb: 32,
            maxYoungGenerationSizeMb: 8,
            codeRangeSizeMb: 16,
            stackSizeMb: 2,
          },
        });
      } catch (spawnErr: any) {
        finish({
          code,
          result: null,
          error: spawnErr?.message ?? 'Failed to initialize sandbox worker',
        });
        return;
      }

      worker.on('message', (msg: { ok?: boolean; result?: unknown; error?: string }) => {
        if (msg && msg.ok) {
          finish({
            code,
            result: msg.result !== undefined ? msg.result : null,
          });
        } else {
          finish({
            code,
            result: null,
            error: msg?.error ?? 'Execution error',
          });
        }
      });

      worker.on('error', (err: Error) => {
        finish({
          code,
          result: null,
          error: err?.message ?? 'Worker execution error',
        });
      });

      worker.on('exit', (exitCode: number) => {
        if (!settled) {
          finish({
            code,
            result: null,
            error:
              exitCode === 0
                ? 'Sandbox worker exited without returning a result'
                : `Sandbox worker terminated (exit code ${exitCode})`,
          });
        }
      });
    });
  }

  @Public({ auth: { allowAnonymous: true } })
  async getDocument(docPath: string): Promise<string | null> {
    return this.withCorpusRead(async () => {
      if (!isCanonicalDocumentPath(docPath, ALLOWED_DOC_EXTENSIONS)) {
        return null;
      }

      const effectiveRoles = this.callerRoles();
      const candidates = extname(docPath) ? [docPath] : [`${docPath}.pdx`, `${docPath}.md`, `${docPath}.mdx`];
      for (const candidate of candidates) {
        const document = await this.readDocumentState(candidate);
        if (document) return this.accessFilter.filterRawMarkdownContent(document.content, effectiveRoles, document.access);
      }
      return null;
    });
  }

  private async readDocumentState(path: string): Promise<LumenEditableDocument | null> {
    if (this.liveEdit.isEnabled()) {
      const stored = await this.liveEdit.getDocument(path);
      if (stored) return { docId: stored.docId, content: stored.content, revision: stored.revision, hash: stored.hash, access: stored.access };
    }
    try {
      const root = await this.corpusRoot(this.options.docsDir ?? DEFAULT_DOCS_DIR);
      const content = await readCorpusFile(root, path, MAX_DOC_FILE_BYTES);
      return content === null ? null : {
        docId: path, content, revision: 0, hash: createHash('sha256').update(content).digest('hex'),
        access: extractDocumentAccess(content),
      };
    } catch (error) {
      throw Errors.internal('Unable to read the configured documentation corpus', error as Error);
    }
  }

  @Public({ auth: { permissions: ['lumen.documents.write'] } })
  async getEditableDocument(path: string): Promise<LumenEditableDocument | null> {
    return this.withCorpusRead(async () => {
      const actor = this.requireMutation('getEditableDocument');
      if (!isCanonicalDocumentPath(path, ALLOWED_DOC_EXTENSIONS) || !extname(path)) {
        throw Errors.badRequest('Editing requires a canonical document path with its extension');
      }
      if (!this.liveEdit.isEnabled()) throw Errors.badRequest('Durable authoring is not configured');
      const document = await this.readDocumentState(path);
      if (!document) return null;
      const projected = this.accessFilter.projectContent(document.content, [...(actor.roles ?? [])], document.access);
      if (projected.content === null || projected.strippedAny) throw Errors.forbidden('Editing requires access to the entire document');
      return document;
    });
  }

  @Public({ auth: { allowAnonymous: true } })
  async getSymbolContract(symbol: string): Promise<SymbolContract | null> {
    return this.withCorpusRead(async () => {
      if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
        return null;
      }

      if (symbol.length > 512) throw Errors.badRequest('Symbol name exceeds 512 characters');
      const trimmed = symbol.trim();
      const effectiveRoles = this.callerRoles();

      // 1. Check @omnitron-dev/kb KnowledgeBase first when provided
      if (this.options.knowledgeBase && this.accessFilter.isAllowed(effectiveRoles, this.options.knowledgeBaseAccess ?? 'internal')) {
        try {
          const kbSymbol = await this.options.knowledgeBase.getApi(trimmed);
          if (kbSymbol) {
            const methods: Record<string, unknown> = {};
            for (const member of kbSymbol.members ?? []) {
              if (member.visibility !== 'private' && member.visibility !== 'protected') {
                methods[member.name] = member.signature;
              }
            }
            return {
              name: kbSymbol.name,
              kind: kbSymbol.kind,
              filePath: kbSymbol.filePath,
              signatures: kbSymbol.signature ? [kbSymbol.signature] : [],
              ...(Object.keys(methods).length > 0 ? { methods } : {}),
            };
          }
        } catch (error) {
          throw Errors.internal('Unable to inspect the configured knowledge base', error as Error);
        }
      }

      if (this.options.sourceDir && this.accessFilter.isAllowed(effectiveRoles, this.options.sourceAccess ?? 'internal')) {
        try {
          const root = await this.corpusRoot(this.options.sourceDir);
          const files = await scanCorpusFiles(root, ALLOWED_TS_EXTENSIONS, MAX_SOURCE_FILE_BYTES, this.options.corpusLimits);
          for (const { path, content } of files) {
            if (!content.includes(trimmed)) continue;
            const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
            const found = extractSymbolFromSourceFile(sourceFile, trimmed, path);
            if (found) return found;
          }
        } catch (error) {
          throw Errors.internal('Unable to inspect the configured source corpus', error as Error);
        }
      }

      return null;
    });
  }

  @Public({ auth: { allowAnonymous: true } })
  async getTheoremGraph(): Promise<TheoremGraphData> {
    return this.withCorpusRead(async () => {
      const effectiveRoles = this.callerRoles();

      try {
        const diskDocs = await this.readDocuments();
        const nodes: TheoremGraphData['nodes'] = [];
        const edges: TheoremGraphData['edges'] = [];
        const nodeIds = new Set<string>();

        const collectSmartRefs = (subNodes: LumenNode[], out: Set<string>): void => {
          for (const child of subNodes) {
            if (!child || typeof child !== 'object') continue;
            if (child.type === 'smartRef') {
              const target = String((child as Record<string, unknown>)['target'] ?? '').trim();
              if (target.length > 0) {
                out.add(target);
              }
            }
            if (Array.isArray(child.children)) {
              collectSmartRefs(child.children, out);
            }
          }
        };

        const VALID_THEOREM_TYPES = new Set<TheoremGraphData['nodes'][number]['type']>([
          'axiom',
          'theorem',
          'definition',
          'lemma',
          'proposition',
          'corollary',
          'hypothesis',
          'remark',
          'example',
        ]);

        const normalizeTheoremType = (raw: string): TheoremGraphData['nodes'][number]['type'] => {
          const lower = raw.toLowerCase() as TheoremGraphData['nodes'][number]['type'];
          return VALID_THEOREM_TYPES.has(lower) ? lower : 'theorem';
        };

        const walkMathEnvs = (astNodes: LumenNode[], defaultStatus: string, docPath: string): void => {
          for (const node of astNodes) {
            if (!node || typeof node !== 'object') continue;
            if (node.type === 'mathEnvironment') {
              const rec = node as Record<string, unknown>;
              const envKind = String(rec['envKind'] ?? 'theorem');
              const id = typeof rec['id'] === 'string' && rec['id'].trim().length > 0 ? rec['id'].trim() : undefined;
              const title =
                typeof rec['title'] === 'string' && rec['title'].trim().length > 0
                  ? rec['title'].trim()
                  : (id ?? envKind);
              const attrs = (rec['attributes'] as Record<string, unknown> | undefined) ?? {};
              const status = typeof attrs['status'] === 'string' ? attrs['status'] : defaultStatus;
              const ofTarget =
                (typeof rec['of'] === 'string' ? rec['of'] : undefined) ??
                (typeof attrs['of'] === 'string' ? attrs['of'] : undefined);

              if (envKind !== 'proof' && id) {
                if (nodeIds.has(id)) throw new Error('Duplicate mathematical identity in the configured corpus');
                nodeIds.add(id);
                nodes.push({ id, type: normalizeTheoremType(envKind), title, status, path: docPath });
              }

              // For :::proof{of="thm-x"} containing @lem:lem-y, record thm-x dependsOn lem-y
              const dependencyOwner = envKind === 'proof' ? ofTarget : id;
              if (dependencyOwner && Array.isArray(node.children)) {
                const refs = new Set<string>();
                collectSmartRefs(node.children, refs);
                for (const refTarget of refs) {
                  if (refTarget !== dependencyOwner) {
                    edges.push({ source: dependencyOwner, target: refTarget, relation: 'dependsOn' });
                  }
                }
              }
            }
            if (Array.isArray(node.children)) {
              walkMathEnvs(node.children, defaultStatus, docPath);
            }
          }
        };

        for (const doc of diskDocs) {
          if (!this.accessFilter.isAllowed(effectiveRoles, doc.access)) {
            continue;
          }
          const ast = await parseDocument(doc.content, doc.path);
          const filtered = this.accessFilter.filterAst(ast, effectiveRoles);
          const docStatus = typeof filtered.frontmatter.status === 'string' ? filtered.frontmatter.status : 'canonical';
          walkMathEnvs(filtered.children, docStatus, doc.path);
        }

        if (nodes.length > 0) {
          const seenEdges = new Set<string>();
          const validEdges = edges.filter((edge) => {
            const key = JSON.stringify([edge.source, edge.target, edge.relation]);
            if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || seenEdges.has(key)) return false;
            seenEdges.add(key);
            return true;
          });
          return { nodes, edges: validEdges };
        }
      } catch (error) {
        throw Errors.internal('Unable to read the configured documentation corpus', error as Error);
      }

      return { nodes: [], edges: [] };
    });
  }

  @Public({ auth: { permissions: ['lumen.documents.write'] } })
  async saveLiveEdit(payload: LiveEditPayload): Promise<LiveEditResult> {
    const auth = this.requireMutation('saveLiveEdit');
    const actor = { userId: auth.userId, roles: auth.roles ?? [] };
    if (!this.liveEdit.isEnabled()) throw Errors.badRequest('Durable authoring is not configured');
    if (!this.liveEdit.validatePayload(payload).valid) return this.liveEdit.applyEdit(payload, actor);
    const existing = await this.readDocumentState(payload.docId);
    return this.liveEdit.applyEdit(payload, actor, existing?.revision === 0 ? existing.content : undefined);
  }
}
