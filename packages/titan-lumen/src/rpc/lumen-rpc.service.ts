import { Worker } from 'node:worker_threads';
import { extname, relative, resolve, sep as pathSep } from 'node:path';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import ts from 'typescript';
import { Injectable } from '@omnitron-dev/titan';
import { parseDocument, toCleanMarkdown, type LumenNode } from '@omnitron-dev/lumen-ast';
import { DEFAULT_DOCS_DIR } from '../constants.js';
import {
  AccessFilterService,
  extractDocumentAccess,
  extractDocumentMetadata,
} from '../access/access-filter.service.js';
import { LiveEditService } from '../live/live-edit.service.js';
import { LumenMcpServer } from '../mcp/mcp-server.js';
import type {
  ILumenModuleOptions,
  ILumenRpcService,
  LiveEditPayload,
  LiveEditResult,
  LumenSessionContext,
  PlaygroundResult,
  SearchOptions,
  SearchResult,
  SymbolContract,
  TheoremGraphData,
} from '../interfaces.js';

export const MAX_PLAYGROUND_CODE_BYTES = 64 * 1024; // 64 KiB
export const PLAYGROUND_VM_TIMEOUT_MS = 1850;
export const PLAYGROUND_WALL_TIMEOUT_MS = 2050;
export const MAX_DOC_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB

const ALLOWED_DOC_EXTENSIONS = new Set(['.pdx', '.md', '.mdx']);
const ALLOWED_TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const SEED_DOC_PATHS = new Set(['docs/intro.pdx', 'docs/collab.pdx']);

const PLAYGROUND_WORKER_SCRIPT = `
'use strict';
const vm = require('node:vm');
const { parentPort, workerData } = require('node:worker_threads');

const userCode = workerData && typeof workerData.code === 'string' ? workerData.code : '';
const vmTimeoutMs = workerData && typeof workerData.vmTimeoutMs === 'number' ? workerData.vmTimeoutMs : 1850;

function sendOutcome(payload) {
  if (!parentPort) return;
  try {
    parentPort.postMessage(payload);
  } catch (_cloneErr) {
    if (payload && payload.ok) {
      let fallback = null;
      try {
        if (typeof payload.result === 'function') {
          fallback = '[Function]';
        } else if (typeof payload.result === 'object' && payload.result !== null) {
          fallback = JSON.parse(JSON.stringify(payload.result));
        } else if (payload.result !== undefined) {
          fallback = String(payload.result);
        }
      } catch (_jsonErr) {
        fallback = String(payload.result);
      }
      parentPort.postMessage({ ok: true, result: fallback });
    } else {
      parentPort.postMessage({ ok: false, error: 'Execution error' });
    }
  }
}

try {
  let script;
  try {
    script = new vm.Script(userCode);
  } catch (compileErr) {
    if (
      compileErr &&
      compileErr.name === 'SyntaxError' &&
      typeof compileErr.message === 'string' &&
      compileErr.message.includes('Illegal return statement')
    ) {
      script = new vm.Script('(() => {\\n' + userCode + '\\n})()');
    } else {
      throw compileErr;
    }
  }

  const sandbox = Object.create(null);
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });

  vm.runInContext(
    'this.console = Object.freeze({ __proto__: null, log() {}, warn() {}, error() {}, info() {} });',
    context,
    { timeout: 200 }
  );

  const executionResult = script.runInContext(context, { timeout: vmTimeoutMs });
  sendOutcome({ ok: true, result: executionResult !== undefined ? executionResult : null });
} catch (err) {
  const errMsg = err && typeof err.message === 'string' ? err.message : String(err || 'Execution error');
  sendOutcome({ ok: false, error: errMsg });
}
`;

function cloneModuleOptions(opts: ILumenModuleOptions): ILumenModuleOptions {
  const cloned: ILumenModuleOptions = { ...opts };
  if (opts.accessFilter) {
    cloned.accessFilter = {
      ...opts.accessFilter,
      ...(opts.accessFilter.grants ? { grants: { ...opts.accessFilter.grants } } : {}),
    };
  }
  if (opts.liveEdit) {
    cloned.liveEdit = { ...opts.liveEdit };
  }
  return cloned;
}

function isDisallowedDocumentPath(rawPath: string): boolean {
  if (!rawPath || typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return true;
  }

  if (
    rawPath.includes('\0') ||
    rawPath.includes('\\') ||
    rawPath.includes('\uFF0E') ||
    rawPath.includes('..') ||
    rawPath.startsWith('/') ||
    rawPath.startsWith('~') ||
    /^[a-zA-Z]:/.test(rawPath) ||
    rawPath.includes('/var/') ||
    rawPath.includes('/etc/') ||
    rawPath.includes('/dev/') ||
    rawPath.includes('/proc/') ||
    rawPath.includes('/sys/') ||
    rawPath.includes('/windows/') ||
    rawPath.includes('package.json')
  ) {
    return true;
  }

  // Reject single- or multi-URL-encoded dot, slash, backslash, or null-byte sequences
  if (/%(?:2e|2f|5c|00|25(?:2e|2f|5c|00))/i.test(rawPath)) {
    return true;
  }

  const ext = extname(rawPath).toLowerCase();
  if (ext !== '' && !ALLOWED_DOC_EXTENSIONS.has(ext)) {
    return true;
  }

  return false;
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
        if (isPrivateOrProtected) {
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

@Injectable()
export class LumenRpcService implements ILumenRpcService {
  private readonly options: ILumenModuleOptions;
  private readonly accessFilter: AccessFilterService;
  private readonly liveEdit: LiveEditService;
  private readonly mcpServer: LumenMcpServer;
  private readonly inMemoryCorpus = new Map<string, { id: string; title: string; content: string; access: string }>();

  constructor(options: ILumenModuleOptions = {}) {
    this.options = cloneModuleOptions(options);
    this.accessFilter = new AccessFilterService(this.options.accessFilter);
    this.liveEdit = new LiveEditService(this.options.liveEdit);
    this.mcpServer = new LumenMcpServer(this, this.accessFilter);

    // Seed standard documentation references
    this.inMemoryCorpus.set('docs/intro.pdx', {
      id: 'doc-intro',
      title: 'Introduction to Lumen',
      content: 'Welcome to Lumen documentation and knowledge portal. Spectral theorems and quantum operators.',
      access: 'public',
    });
    this.inMemoryCorpus.set('docs/collab.pdx', {
      id: 'doc-collaborative-paper',
      title: 'Collaborative Note',
      content: 'Live collaborative document content.',
      access: 'public',
    });
  }

  getOptions(): ILumenModuleOptions {
    return cloneModuleOptions(this.options);
  }

  getAccessFilterService(): AccessFilterService {
    return this.accessFilter;
  }

  getLiveEditService(): LiveEditService {
    return this.liveEdit;
  }

  getMcpServer(): LumenMcpServer {
    return this.mcpServer;
  }

  private resolveSearchRoles(searchOptions?: SearchOptions, session?: LumenSessionContext): string[] {
    if (session !== undefined) {
      return this.accessFilter.getEffectiveRoles(session);
    }
    const filterRoles = searchOptions?.filter?.roles;
    if (Array.isArray(filterRoles) && filterRoles.length > 0) {
      const valid = filterRoles.filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
      return valid.length > 0 ? valid : ['anonymous'];
    }
    return ['anonymous'];
  }

  private async projectAuthorizedContent(
    content: string,
    docPath: string,
    effectiveRoles: string[],
    explicitAccess?: string
  ): Promise<string | null> {
    const docAccess = explicitAccess ?? extractDocumentAccess(content);
    if (!this.accessFilter.isAllowed(effectiveRoles, docAccess)) {
      return null;
    }
    const bodyWithoutFm = stripFrontmatter(content);
    if (!/\baccess\s*=/.test(bodyWithoutFm)) {
      return content;
    }
    const countTreeNodes = (nodes: LumenNode[]): number => {
      let total = 0;
      for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        total += 1;
        if (Array.isArray(n.children)) {
          total += countTreeNodes(n.children);
        }
      }
      return total;
    };

    const ast = await parseDocument(content, docPath);
    const filtered = this.accessFilter.filterAst(ast, effectiveRoles);
    if (countTreeNodes(filtered.children) === countTreeNodes(ast.children) && filtered.toc.length === ast.toc.length) {
      return content;
    }
    const hasFrontmatter = content.startsWith('---') || content.startsWith('~~~');
    return toCleanMarkdown(filtered, { includeFrontmatter: hasFrontmatter });
  }

  private async scanDocsDirectory(
    realDocsBase: string,
    currentDir: string,
    collected: Array<{ id: string; title: string; path: string; content: string; access: string }>
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }

      const candidatePath = resolve(currentDir, entry.name);
      let realTarget: string;
      try {
        realTarget = await realpath(candidatePath);
      } catch {
        continue;
      }

      // Symlink containment check inside realDocsBase
      if (!realTarget.startsWith(realDocsBase + pathSep)) {
        continue;
      }

      let targetStat;
      try {
        targetStat = await stat(realTarget);
      } catch {
        continue;
      }

      if (targetStat.isDirectory()) {
        await this.scanDocsDirectory(realDocsBase, realTarget, collected);
        continue;
      }

      if (!targetStat.isFile() || targetStat.size > MAX_DOC_FILE_BYTES) {
        continue;
      }

      const ext = extname(realTarget).toLowerCase();
      if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
        continue;
      }

      try {
        const content = await readFile(realTarget, 'utf8');
        const relPath = relative(realDocsBase, realTarget).split(pathSep).join('/');
        const meta = extractDocumentMetadata(content);
        const fallbackTitle = extractFirstHeading(stripFrontmatter(content)) ?? relPath.replace(/\.(pdx|mdx?)$/i, '');
        const docId = meta.id ?? relPath.replace(/\.(pdx|mdx?)$/i, '').replace(/\//g, '-');

        collected.push({
          id: docId,
          title: meta.title ?? fallbackTitle,
          path: relPath,
          content,
          access: meta.access,
        });
      } catch {
        // Ignore unreadable files during corpus scan
      }
    }
  }

  async search(query: string, searchOptions?: SearchOptions, session?: LumenSessionContext): Promise<SearchResult[]> {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return [];
    }

    if (searchOptions?.limit !== undefined && searchOptions.limit <= 0) {
      return [];
    }

    const limit = searchOptions?.limit ?? 10;
    const effectiveRoles = this.resolveSearchRoles(searchOptions, session);
    const trimmedQuery = query.trim();
    const lowerQuery = trimmedQuery.toLowerCase();
    const results: SearchResult[] = [];
    const seenIds = new Set<string>();

    // 1. Merge results from @omnitron-dev/kb KnowledgeBase when configured
    if (this.options.knowledgeBase) {
      try {
        const kbResult = await this.options.knowledgeBase.query(trimmedQuery, { maxResults: limit });
        for (const entry of kbResult.entries ?? []) {
          const entryAccess = inferKbEntryAccess(entry.content ?? '', entry.tags ?? []);
          const projectedContent = await this.projectAuthorizedContent(
            entry.content ?? '',
            `${entry.module}/${entry.id}.pdx`,
            effectiveRoles,
            entryAccess
          );
          if (projectedContent === null) {
            continue;
          }
          const projectedBody = stripFrontmatter(projectedContent).trim();
          const hasInlineRestriction = /\baccess\s*=/.test(stripFrontmatter(entry.content ?? ''));
          if (
            hasInlineRestriction &&
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
      } catch {
        // Degrade gracefully to filesystem / in-memory corpus search if KB store fails
      }
    }

    // 2. Scan real .pdx / .md / .mdx files from options.docsDir when docsDir exists on disk
    let docsDirExistsOnDisk = false;
    const docsBase = resolve(process.cwd(), this.options.docsDir ?? DEFAULT_DOCS_DIR);
    try {
      const realDocsBase = await realpath(docsBase);
      const baseStat = await stat(realDocsBase);
      if (baseStat.isDirectory()) {
        docsDirExistsOnDisk = true;
        const diskDocs: Array<{ id: string; title: string; path: string; content: string; access: string }> = [];
        await this.scanDocsDirectory(realDocsBase, realDocsBase, diskDocs);

        for (const doc of diskDocs) {
          const projectedContent = await this.projectAuthorizedContent(
            doc.content,
            doc.path,
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
      }
    } catch {
      docsDirExistsOnDisk = false;
    }

    // 3. Search in-memory corpus (default seed docs only when docsDir does not exist on disk)
    for (const [docPath, doc] of this.inMemoryCorpus.entries()) {
      if (docsDirExistsOnDisk && SEED_DOC_PATHS.has(docPath)) {
        continue;
      }

      const docAccess = doc.access || extractDocumentAccess(doc.content);
      const projectedContent = await this.projectAuthorizedContent(doc.content, docPath, effectiveRoles, docAccess);
      if (projectedContent === null) {
        continue;
      }
      const projectedBody = stripFrontmatter(projectedContent);

      const matchTitle = doc.title.toLowerCase().includes(lowerQuery);
      const matchContent = projectedBody.toLowerCase().includes(lowerQuery);

      if (matchTitle || matchContent) {
        if (!seenIds.has(doc.id)) {
          seenIds.add(doc.id);
          results.push({
            documentId: doc.id,
            title: doc.title,
            path: docPath,
            snippet: projectedBody.trim().slice(0, 160),
            score: matchTitle ? 1.0 : 0.8,
          });
        }
      }

      if (results.length >= limit) {
        break;
      }
    }

    return results;
  }

  async executePlayground(code: string, _session?: LumenSessionContext): Promise<PlaygroundResult> {
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

    return new Promise<PlaygroundResult>((resolvePromise) => {
      let settled = false;
      let worker: Worker | undefined;

      const finish = (outcome: PlaygroundResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(wallClockTimer);
        if (worker) {
          void worker.terminate().catch(() => {});
        }
        resolvePromise(outcome);
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
          workerData: {
            code,
            vmTimeoutMs: PLAYGROUND_VM_TIMEOUT_MS,
          },
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

  async getDocument(docPath: string, session?: LumenSessionContext): Promise<string | null> {
    if (isDisallowedDocumentPath(docPath)) {
      return null;
    }

    const effectiveRoles = session ? this.accessFilter.getEffectiveRoles(session) : ['anonymous'];
    const ext = extname(docPath).toLowerCase();
    const lookupCandidates = ext !== '' ? [docPath] : [docPath, `${docPath}.pdx`, `${docPath}.md`, `${docPath}.mdx`];
    const fileCandidates = ext !== '' ? [docPath] : [`${docPath}.pdx`, `${docPath}.md`, `${docPath}.mdx`];

    // 1. Check live edit documents first (enforcing AccessFilterService)
    for (const candidate of lookupCandidates) {
      const liveDoc = this.liveEdit.getDocument(candidate);
      if (liveDoc) {
        const docAccess = liveDoc.access ?? extractDocumentAccess(liveDoc.content);
        return this.projectAuthorizedContent(liveDoc.content, candidate, effectiveRoles, docAccess);
      }
    }

    // 2. Check in-memory corpus (enforcing AccessFilterService)
    for (const candidate of lookupCandidates) {
      const memoryDoc = this.inMemoryCorpus.get(candidate);
      if (memoryDoc) {
        const docAccess = memoryDoc.access || extractDocumentAccess(memoryDoc.content);
        return this.projectAuthorizedContent(memoryDoc.content, candidate, effectiveRoles, docAccess);
      }
    }

    if (ext === '') {
      for (const [memPath, memoryDoc] of this.inMemoryCorpus.entries()) {
        if (memoryDoc.id === docPath) {
          const docAccess = memoryDoc.access || extractDocumentAccess(memoryDoc.content);
          return this.projectAuthorizedContent(memoryDoc.content, memPath, effectiveRoles, docAccess);
        }
      }
    }

    // 3. Symlink-safe canonical realpath check within docsDir (SEC-04 + SEC-02)
    try {
      const docsBase = resolve(process.cwd(), this.options.docsDir ?? DEFAULT_DOCS_DIR);
      const realDocsBase = await realpath(docsBase);

      for (const candidate of fileCandidates) {
        const resolvedTarget = resolve(docsBase, candidate);
        if (!resolvedTarget.startsWith(docsBase + pathSep)) {
          continue;
        }

        let realTarget: string;
        try {
          realTarget = await realpath(resolvedTarget);
        } catch {
          continue;
        }

        if (!realTarget.startsWith(realDocsBase + pathSep)) {
          return null;
        }

        const realExt = extname(realTarget).toLowerCase();
        if (!ALLOWED_DOC_EXTENSIONS.has(realExt)) {
          return null;
        }

        const fileStat = await stat(realTarget);
        if (!fileStat.isFile() || fileStat.size > MAX_DOC_FILE_BYTES) {
          return null;
        }

        const content = await readFile(realTarget, 'utf8');
        return await this.projectAuthorizedContent(content, candidate, effectiveRoles);
      }
    } catch {
      return null;
    }

    return null;
  }

  private async scanSourceDirectoryForSymbol(
    realSourceBase: string,
    currentDir: string,
    targetSymbol: string
  ): Promise<SymbolContract | null> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }

      const candidatePath = resolve(currentDir, entry.name);
      let realTarget: string;
      try {
        realTarget = await realpath(candidatePath);
      } catch {
        continue;
      }

      if (!realTarget.startsWith(realSourceBase + pathSep)) {
        continue;
      }

      let targetStat;
      try {
        targetStat = await stat(realTarget);
      } catch {
        continue;
      }

      if (targetStat.isDirectory()) {
        const nested = await this.scanSourceDirectoryForSymbol(realSourceBase, realTarget, targetSymbol);
        if (nested) {
          return nested;
        }
        continue;
      }

      if (!targetStat.isFile() || targetStat.size > MAX_SOURCE_FILE_BYTES) {
        continue;
      }

      const ext = extname(realTarget).toLowerCase();
      if (!ALLOWED_TS_EXTENSIONS.has(ext)) {
        continue;
      }

      try {
        const rawCode = await readFile(realTarget, 'utf8');
        if (!rawCode.includes(targetSymbol)) {
          continue;
        }
        const relFile = relative(realSourceBase, realTarget).split(pathSep).join('/');
        const sourceFile = ts.createSourceFile(relFile, rawCode, ts.ScriptTarget.Latest, true);
        const found = extractSymbolFromSourceFile(sourceFile, targetSymbol, relFile);
        if (found) {
          return found;
        }
      } catch {
        // Ignore individual file parse errors
      }
    }

    return null;
  }

  async getSymbolContract(symbol: string, _session?: LumenSessionContext): Promise<SymbolContract | null> {
    if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
      return null;
    }

    const trimmed = symbol.trim();

    // 1. Check @omnitron-dev/kb KnowledgeBase first when provided
    if (this.options.knowledgeBase) {
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
      } catch {
        // Fall through to TypeScript declaration scan and built-in contracts
      }
    }

    // 2. Scan TypeScript declarations in options.sourceDir when configured
    if (this.options.sourceDir) {
      try {
        const sourceBase = resolve(process.cwd(), this.options.sourceDir);
        const realSourceBase = await realpath(sourceBase);
        const baseStat = await stat(realSourceBase);
        if (baseStat.isDirectory()) {
          const scanned = await this.scanSourceDirectoryForSymbol(realSourceBase, realSourceBase, trimmed);
          if (scanned) {
            return scanned;
          }
        }
      } catch {
        // Fall through to built-in contracts
      }
    }

    // 3. Built-in standard symbols in the Lumen/Omnitron documentation and compiler suite
    const knownContracts: Record<string, SymbolContract> = {
      CorpusGraph: {
        name: 'CorpusGraph',
        kind: 'class',
        filePath: 'packages/lumen/src/corpus/corpus-graph.ts',
        signatures: ['class CorpusGraph'],
        methods: { addDocument: 'void', getDocument: 'CorpusDocument | undefined' },
      },
      LumenMacroRegistry: {
        name: 'LumenMacroRegistry',
        kind: 'class',
        filePath: 'packages/lumen-ast/src/katex/macro-registry.ts',
        signatures: ['class LumenMacroRegistry'],
        methods: { register: 'void', getMacros: 'Record<string, string>' },
      },
      lumen_inspect_ast: {
        name: 'lumen_inspect_ast',
        kind: 'tool',
        filePath: 'packages/titan-lumen/src/mcp/mcp-server.ts',
        signatures: ['function lumen_inspect_ast(docId: string): Promise<LumenDocumentAst>'],
      },
      search_corpus: {
        name: 'search_corpus',
        kind: 'tool',
        filePath: 'packages/titan-lumen/src/mcp/mcp-server.ts',
        signatures: ['function search_corpus(query: string, limit?: number): Promise<SearchResult[]>'],
      },
    };

    if (Object.prototype.hasOwnProperty.call(knownContracts, trimmed)) {
      return knownContracts[trimmed] ?? null;
    }

    return null;
  }

  async getTheoremGraph(session?: LumenSessionContext): Promise<TheoremGraphData> {
    const effectiveRoles = session ? this.accessFilter.getEffectiveRoles(session) : ['anonymous'];

    try {
      const docsBase = resolve(process.cwd(), this.options.docsDir ?? DEFAULT_DOCS_DIR);
      const realDocsBase = await realpath(docsBase);
      const baseStat = await stat(realDocsBase);
      if (baseStat.isDirectory()) {
        const diskDocs: Array<{ id: string; title: string; path: string; content: string; access: string }> = [];
        await this.scanDocsDirectory(realDocsBase, realDocsBase, diskDocs);

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

              if (envKind !== 'proof' && id && !nodeIds.has(id)) {
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
          const validEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
          return { nodes, edges: validEdges };
        }
      }
    } catch {
      // Fall back to default reference theorem graph when docsDir is unavailable
    }

    return {
      nodes: [
        { id: 'thm-spectral', type: 'theorem', title: 'Spectral Theorem', status: 'verified' },
        { id: 'def-hilbert', type: 'definition', title: 'Hilbert Space', status: 'canonical' },
      ],
      edges: [{ source: 'thm-spectral', target: 'def-hilbert', relation: 'dependsOn' }],
    };
  }

  async saveLiveEdit(payload: LiveEditPayload, _session?: LumenSessionContext): Promise<LiveEditResult> {
    return this.liveEdit.applyEdit(payload);
  }
}
