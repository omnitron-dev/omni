#!/usr/bin/env node
import { compileTypst } from '@omnitron-dev/lumen-ast/typst';
/**
 * Lumen SSG CLI dispatcher
 * Platforms: Vite 8, Rolldown, Pagefind WASM, Typst, MCP.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseDocument, type LumenNode } from '@omnitron-dev/lumen-ast';
import { loadLumenConfig } from '../config/loader.js';
import type { LumenConfig } from '../config/schema.js';
import { CorpusGraph } from '../corpus/graph.js';
import { projectCorpus } from '../corpus/projection.js';
import type { CorpusDocument, CorpusHeader, CorpusMathObject } from '../corpus/types.js';
import { runCorpusGates } from '../gates/runner.js';
import type { CorpusGate, LumenGateDiagnostic } from '../gates/types.js';
import {
  linksGate,
  anchorsGate,
  codeDefaultsGate,
  codeExamplesGate,
  undocumentedExportsGate,
  mathKernelGate,
} from '../gates/builtins/index.js';
import { computeContentHash } from '../manifest/hashing.js';
import { buildStaticSite } from '../ssg/ssg-engine.js';
import { captureGeneration, recoverGeneration } from '../ssg/publish-generation.js';
import { runLumenMcpServer } from '../ai/mcp-server.js';
import { documentRoute } from '../corpus/routes.js';
import { createRequire } from 'node:module';

const { version: VERSION } = createRequire(import.meta.url)('../../package.json') as { version: string };

interface ParsedCliOptions {
  rootDir: string;
  outDir?: string;
  write: boolean;
  strict: boolean;
  json: boolean;
  pureJson: boolean;
  stdio: boolean;
  help: boolean;
  host: string;
  port: number;
  gatesFilter?: string[];
}

function parseCliOptions(argv: string[]): ParsedCliOptions {
  let rootDir = process.cwd();
  let outDir: string | undefined;
  let write = false;
  let strict = false;
  let json = false;
  let pureJson = false;
  let stdio = false;
  let help = false;
  let host = '127.0.0.1';
  let port = 4173;
  let gatesFilter: string[] | undefined;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--write') {
      write = true;
    } else if (arg === '--strict') {
      strict = true;
    } else if (arg === '--json') {
      json = true;
      pureJson = true;
    } else if (arg.startsWith('--format=json')) {
      json = true;
    } else if (arg === '--stdio') {
      stdio = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--host' && argv[i + 1]) {
      host = argv[++i]!;
    } else if (arg === '--port' && argv[i + 1]) {
      port = Number(argv[++i]);
    } else if (arg === '--root' && argv[i + 1]) {
      rootDir = resolve(process.cwd(), argv[i + 1]!);
      i += 1;
    } else if (arg.startsWith('--root=')) {
      rootDir = resolve(process.cwd(), arg.slice('--root='.length));
    } else if (arg === '--outDir' && argv[i + 1]) {
      outDir = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--outDir=')) {
      outDir = arg.slice('--outDir='.length);
    } else if (arg === '--gates' && argv[i + 1]) {
      gatesFilter = argv[i + 1]!.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg.startsWith('--gates=')) {
      gatesFilter = arg
        .slice('--gates='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535');
  return {
    rootDir,
    outDir,
    write,
    strict,
    json,
    pureJson,
    stdio,
    help,
    host,
    port,
    gatesFilter,
  };
}

function extractNodePlainText(node: LumenNode): string {
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(extractNodePlainText).join('');
}

function isExternalHref(url: string): boolean {
  const trimmed = url.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed === '#unsafe-url' ||
    /^(?:https?:|mailto:|tel:|javascript:|vbscript:|data:)/i.test(trimmed)
  );
}

function scanDocFilesRecursively(dir: string): string[] {
  const collected: string[] = [];
  const ignored = new Set(['node_modules', '.git', 'dist', '.turbo']);

  const walk = (currentDir: string) => {
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /\.(pdx|mdx?)$/.test(entry.name)) {
        collected.push(fullPath);
      }
    }
  };

  walk(dir);
  return collected;
}

export async function loadCorpusFromDirectory(
  rootDir: string = process.cwd(),
  explicitConfig?: LumenConfig
): Promise<{
  config: LumenConfig;
  graph: CorpusGraph;
  docsDir: string;
  docsDirExists: boolean;
  astDiagnostics: LumenGateDiagnostic[];
}> {
  const config = explicitConfig ?? (await loadLumenConfig(rootDir));
  const rawDocsDir = (config as unknown as Record<string, unknown>)['docsDir'];
  const configuredSrcDir =
    typeof rawDocsDir === 'string' && rawDocsDir.trim() ? rawDocsDir.trim() : config.srcDir || 'docs';
  const docsDir = resolve(rootDir, configuredSrcDir);
  const docsDirExists = existsSync(docsDir) && statSync(docsDir).isDirectory();
  const graph = new CorpusGraph();
  const astDiagnostics: LumenGateDiagnostic[] = [];

  if (!docsDirExists) {
    return { config, graph, docsDir, docsDirExists, astDiagnostics };
  }

  const pagesDir = config.pagesDir ? resolve(rootDir, config.pagesDir) : undefined;
  const docFiles = [
    ...scanDocFilesRecursively(docsDir),
    ...(pagesDir && existsSync(pagesDir) ? scanDocFilesRecursively(pagesDir) : []),
  ];
  const routes = new Set<string>();
  for (const fullPath of docFiles) {
    const raw = readFileSync(fullPath, 'utf8');
    const relFromDocs = relative(docsDir, fullPath).replace(/\\/g, '/');
    const relFromRoot = relative(rootDir, fullPath).replace(/\\/g, '/');
    const ast = await parseDocument(raw, relFromRoot);

    for (const diag of ast.diagnostics ?? []) {
      if (diag.severity === 'error' || diag.severity === 'warning') {
        astDiagnostics.push({
          code: diag.code,
          message: diag.message,
          file: relFromRoot,
          line: diag.line,
          column: diag.column,
          severity: diag.severity,
        });
      }
    }

    const isPage = pagesDir !== undefined && fullPath.startsWith(`${pagesDir}/`);
    const stemFromDocs = (isPage ? `pages/${relative(pagesDir!, fullPath)}` : relFromDocs).replace(/\.(pdx|mdx?)$/, '');
    const id =
      typeof ast.frontmatter.id === 'string' && ast.frontmatter.id.trim() ? ast.frontmatter.id.trim() : stemFromDocs;
    const anchors: string[] = [];
    const headers: CorpusHeader[] = [];
    const mathObjects: CorpusMathObject[] = [];
    const dependsOn: string[] = [];
    const seeAlso: string[] = [];

    if (Array.isArray(ast.frontmatter['dependsOn'])) {
      for (const dep of ast.frontmatter['dependsOn']) {
        if (typeof dep === 'string') dependsOn.push(dep);
      }
    }
    if (Array.isArray(ast.frontmatter['seeAlso'])) {
      for (const sa of ast.frontmatter['seeAlso']) {
        if (typeof sa === 'string') seeAlso.push(sa);
      }
    }

    const inspectNodes = (nodes: LumenNode[]) => {
      for (const node of nodes) {
        if (node.type === 'heading') {
          const headingId = typeof node.id === 'string' ? node.id : '';
          const headingTitle = extractNodePlainText(node).trim();
          if (headingId) {
            anchors.push(headingId);
          }
          headers.push({
            id: headingId,
            title: headingTitle,
            depth: Number(node.depth ?? 1),
          });
        } else if (node.type === 'mathEnvironment') {
          const mathId = typeof node.id === 'string' ? node.id : '';
          if (mathId) {
            anchors.push(mathId);
            mathObjects.push({
              id: mathId,
              type: String(node.envKind ?? 'theorem'),
              title: typeof node.title === 'string' ? node.title : undefined,
              docId: id,
              number: typeof node.number === 'string' ? node.number : undefined,
              status:
                node.status === 'verified' || node.status === 'draft' || node.status === 'unverified'
                  ? node.status
                  : undefined,
              dependsOn: Array.isArray(node.dependsOn) ? node.dependsOn.map(String) : undefined,
              proves: Array.isArray(node.proves) ? node.proves.map(String) : undefined,
            });
          }
        } else if (node.type === 'link' && typeof node.url === 'string') {
          const href = node.url.trim();
          if (href && !isExternalHref(href)) {
            // Navigation links may be cyclic; only declared dependsOn edges
            // participate in dependency ordering and cycle verification.
            if (href.includes('#')) {
              seeAlso.push(href);
            }
          }
        }

        if (Array.isArray(node.children) && node.children.length > 0) {
          inspectNodes(node.children);
        }
      }
    };

    inspectNodes(ast.children ?? []);

    const inferredTitle =
      (typeof ast.frontmatter.title === 'string' && ast.frontmatter.title.trim()) || headers[0]?.title || id;

    let routePath: string;
    try {
      routePath = documentRoute(isPage ? relative(pagesDir!, fullPath) : relFromRoot, ast.frontmatter);
      if (routes.has(routePath)) throw new Error(`Duplicate document route: ${routePath}`);
      if (graph.getDocument(id)) throw new Error(`Duplicate document id: ${id}`);
      routes.add(routePath);
    } catch (error) {
      astDiagnostics.push({
        code: 'LUMEN_INVALID_ROUTE',
        message: String(error),
        file: relFromRoot,
        severity: 'error',
      });
      continue;
    }

    const corpusDoc: CorpusDocument = {
      id,
      path: relFromRoot,
      routePath,
      title: inferredTitle,
      locale: typeof ast.frontmatter['locale'] === 'string' ? ast.frontmatter['locale'] : config.defaultLocale,
      hash: computeContentHash(raw, 16),
      anchors,
      headers,
      mathObjects,
      backlinks: [],
      relations: {
        dependsOn,
        seeAlso,
      },
      frontmatter: { ...(ast.frontmatter as Record<string, unknown>) },
      ast,
    };

    try {
      graph.addDocument(corpusDoc);
    } catch (dupErr) {
      astDiagnostics.push({
        code: 'LUMEN_DUPLICATE_MATH_OBJECT',
        message: dupErr instanceof Error ? dupErr.message : String(dupErr),
        file: relFromRoot,
        severity: 'error',
      });
    }
  }

  return { config, graph, docsDir, docsDirExists, astDiagnostics };
}

function generateCorpusTypesDeclaration(graph: CorpusGraph): string {
  const docs = graph.getAllDocuments();
  const docIds = docs.map((d) => JSON.stringify(d.id));
  const routes = docs.map((d) => JSON.stringify(d.routePath ?? `/${d.path.replace(/\.(pdx|md)$/, '')}`));
  const mathIds = docs.flatMap((d) => d.mathObjects.map((m) => JSON.stringify(m.id)));

  const docIdUnion = docIds.length > 0 ? docIds.join(' | ') : 'never';
  const routeUnion = routes.length > 0 ? routes.join(' | ') : 'never';
  const mathUnion = mathIds.length > 0 ? Array.from(new Set(mathIds)).join(' | ') : 'never';

  return [
    '// Auto-generated by @omnitron-dev/lumen `lumen types`',
    `export type LumenDocumentId = ${docIdUnion};`,
    `export type LumenRoutePath = ${routeUnion};`,
    `export type LumenMathObjectId = ${mathUnion};`,
    '',
  ].join('\n');
}

export async function runLumenCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(`Lumen CLI v${VERSION}
Commands:
  dev       Start the Vite documentation dev server
  build     Build static documentation assets and html
  serve     Preview static production build
  check     Run corpus graph verification gates
  pdf       Compile academic PDFs via Typst
  mcp       Start Lumen Model Context Protocol server
  types     Generate TypeScript contracts from corpus
`);
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return;
  }

  const cliOpts = parseCliOptions(argv);

  // Handle known and unknown subcommands
  switch (command) {
    case 'dev': {
      console.log(`Lumen CLI v${VERSION} (command: dev)`);
      if (cliOpts.help) break;
      await runLumenCli(['build', '--root', cliOpts.rootDir, ...(cliOpts.outDir ? ['--outDir', cliOpts.outDir] : [])]);
      const config = await loadLumenConfig(cliOpts.rootDir);
      const { createServer } = await import('vite');
      const server = await createServer({
        configFile: false,
        root: resolve(cliOpts.rootDir, cliOpts.outDir ?? config.outDir),
        publicDir: false,
        appType: 'mpa',
        server: { host: cliOpts.host, port: cliOpts.port, strictPort: true },
      });
      await server.listen();
      server.printUrls();
      let pending = false;
      let building = false;
      const rebuild = async () => {
        pending = true;
        if (building) return;
        building = true;
        while (pending) {
          pending = false;
          try {
            await runLumenCli([
              'build',
              '--root',
              cliOpts.rootDir,
              ...(cliOpts.outDir ? ['--outDir', cliOpts.outDir] : []),
            ]);
            server.ws.send({ type: 'full-reload', path: '*' });
          } catch (error) {
            console.error(error);
          }
        }
        building = false;
      };
      const watched = [config.srcDir, config.pagesDir, config.publicDir, 'src'].filter((path): path is string =>
        Boolean(path)
      );
      const watchers = watched
        .filter((path) => existsSync(resolve(cliOpts.rootDir, path)))
        .map((path) =>
          watch(resolve(cliOpts.rootDir, path), { recursive: true }, () => {
            void rebuild();
          })
        );
      server.httpServer?.once('close', () => {
        for (const watcher of watchers) watcher.close();
      });
      break;
    }

    case 'build': {
      console.log(`Lumen CLI v${VERSION} (command: build)`);
      if (cliOpts.help) break;

      const initialConfig = await loadLumenConfig(cliOpts.rootDir);
      recoverGeneration(resolve(cliOpts.rootDir, cliOpts.outDir ?? initialConfig.outDir));
      const { config, graph, docsDirExists, astDiagnostics } = await loadCorpusFromDirectory(cliOpts.rootDir, initialConfig);
      const gateResult = await runCorpusGates(
        { documents: graph.getAllDocuments(), graph, config, reportDiagnostic: () => {} },
        [
          ...(config.onBrokenLinks === 'throw' ? [linksGate] : []),
          ...(config.onBrokenAnchors === 'throw' ? [anchorsGate] : []),
          ...(config.gates ?? []),
        ]
      );
      const errors = [...astDiagnostics, ...gateResult.diagnostics].filter((item) => item.severity === 'error');
      if (errors.length)
        throw new Error(errors.map((item) => `${item.file}: ${item.code}: ${item.message}`).join('\n'));
      const targetOutDir = cliOpts.outDir
        ? resolve(cliOpts.rootDir, cliOpts.outDir)
        : resolve(cliOpts.rootDir, config.outDir || 'dist');

      // Only materialize to disk when --write is explicitly requested OR docsDir exists on disk
      // (Preserves TC-B23-03 repo cleanliness in repo root where ./docs does not exist)
      const shouldWriteToDisk = cliOpts.write || docsDirExists;

      await buildStaticSite(graph, config, {
        rootDir: cliOpts.rootDir,
        outDir: targetOutDir,
        writeToDisk: shouldWriteToDisk,
      });
      break;
    }

    case 'serve': {
      console.log(`Lumen CLI v${VERSION} (command: serve)`);
      if (cliOpts.help) break;
      const config = await loadLumenConfig(cliOpts.rootDir);
      const outDir = resolve(cliOpts.rootDir, cliOpts.outDir ?? config.outDir);
      recoverGeneration(outDir);
      if (!existsSync(outDir)) throw new Error(`Build output does not exist: ${outDir}. Run lumen build first.`);
      const snapshot = captureGeneration(outDir);
      const { preview } = await import('vite');
      const server = await preview({
        configFile: false,
        root: cliOpts.rootDir,
        appType: 'mpa',
        base: config.baseUrl,
        build: { outDir: snapshot.directory },
        preview: { host: cliOpts.host, port: cliOpts.port, strictPort: true },
      }).catch(error => { snapshot.release(); throw error; });
      const shutdown = () => { server.httpServer.close(); if ('closeIdleConnections' in server.httpServer) server.httpServer.closeIdleConnections(); };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
      server.httpServer.once('close', () => {
        process.removeListener('SIGINT', shutdown);
        process.removeListener('SIGTERM', shutdown);
        snapshot.release();
      });
      server.printUrls();
      break;
    }

    case 'check': {
      if (!cliOpts.pureJson) {
        console.log(`Lumen CLI v${VERSION} (command: check)`);
      }
      if (cliOpts.help) break;

      const { config, graph, astDiagnostics } = await loadCorpusFromDirectory(cliOpts.rootDir);
      const builtinGates: CorpusGate[] = [
        linksGate,
        anchorsGate,
        codeDefaultsGate,
        codeExamplesGate,
        undocumentedExportsGate,
        mathKernelGate,
      ];

      const filteredBuiltins = cliOpts.gatesFilter
        ? builtinGates.filter((g) => cliOpts.gatesFilter!.includes(g.name))
        : builtinGates;
      const gates = [...filteredBuiltins, ...(config.gates ?? [])];

      const summary = await runCorpusGates(
        {
          documents: graph.getAllDocuments(),
          graph,
          config,
          reportDiagnostic: () => {},
        },
        gates
      );

      const combinedDiagnostics = [...astDiagnostics, ...summary.diagnostics];
      const hasErrors = !summary.passed || combinedDiagnostics.some((d) => d.severity === 'error');

      if (cliOpts.json) {
        console.log(JSON.stringify(combinedDiagnostics, null, 2));
      } else if (combinedDiagnostics.length > 0) {
        for (const diag of combinedDiagnostics) {
          const loc = diag.file ? `${diag.file}${diag.line ? `:${diag.line}` : ''}` : 'corpus';
          console.log(`[${diag.severity.toUpperCase()}] ${diag.code} (${loc}): ${diag.message}`);
        }
      }

      if (hasErrors) {
        process.exitCode = 1;
        if (cliOpts.strict) {
          throw new Error(`Corpus verification failed with ${combinedDiagnostics.length} diagnostic(s)`);
        }
      }
      break;
    }

    case 'pdf': {
      console.log(`Lumen CLI v${VERSION} (command: pdf)`);
      if (cliOpts.help) break;

      const { config, graph, docsDirExists } = await loadCorpusFromDirectory(cliOpts.rootDir);
      const projectedGraph = projectCorpus(graph, { roles: ['anonymous'] });
      const allDocs = projectedGraph.getAllDocuments();
      const paperSections = config.pdf?.paperSections ?? [];
      const selectedDocs =
        paperSections.length > 0
          ? allDocs.filter((d) => paperSections.includes(d.id) || paperSections.includes(d.path))
          : allDocs;

      const shouldWritePdf = (cliOpts.write || (docsDirExists && selectedDocs.length > 0)) && Boolean(cliOpts.outDir);
      const pdfOutDir = cliOpts.outDir ? resolve(cliOpts.rootDir, cliOpts.outDir) : undefined;

      for (const doc of selectedDocs) {
        if (doc.ast) {
          const pdfBytes = await compileTypst(doc.ast);
          if (shouldWritePdf && pdfOutDir) {
            const pdfTarget = resolve(pdfOutDir, `${doc.id}.pdf`);
            mkdirSync(dirname(pdfTarget), { recursive: true });
            writeFileSync(pdfTarget, pdfBytes);
          }
        }
      }
      break;
    }

    case 'mcp': {
      console.error(`Lumen CLI v${VERSION} (command: mcp)`);
      if (cliOpts.help) break;

      const { graph, docsDirExists, astDiagnostics } = await loadCorpusFromDirectory(cliOpts.rootDir);
      if (!docsDirExists) throw new Error('Configured corpus directory does not exist');
      if (astDiagnostics.some(diagnostic => diagnostic.severity === 'error')) throw new Error('Corpus parsing failed; run lumen check for diagnostics');
      await runLumenMcpServer(graph);
      break;
    }

    case 'types': {
      console.log(`Lumen CLI v${VERSION} (command: types)`);
      if (cliOpts.help) break;

      const { graph, docsDirExists } = await loadCorpusFromDirectory(cliOpts.rootDir);
      const projectedGraph = projectCorpus(graph, { roles: ['anonymous'] });
      const dtsContent = generateCorpusTypesDeclaration(projectedGraph);
      const shouldWriteTypes =
        (cliOpts.write || (docsDirExists && projectedGraph.size() > 0)) && Boolean(cliOpts.outDir);

      if (shouldWriteTypes && cliOpts.outDir) {
        const targetFile = resolve(cliOpts.rootDir, cliOpts.outDir, 'lumen-corpus.d.ts');
        mkdirSync(dirname(targetFile), { recursive: true });
        writeFileSync(targetFile, dtsContent, 'utf8');
      }
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      process.exitCode = 1;
      if (cliOpts.strict) {
        throw new Error(`Unknown command: ${command}`);
      }
      break;
    }
  }
}

// Auto-invoking entry check for direct execution via tsx or node
const invokedFile = process.argv[1];
if (invokedFile && /[/\\]cli[/\\]index\.(ts|js)$/.test(invokedFile)) {
  runLumenCli().catch((err) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
