#!/usr/bin/env node
import { compileTypst } from '@omnitron-dev/lumen-ast/typst';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
/**
 * Lumen SSG CLI dispatcher
 * Platforms: Vite 8, Rolldown, Pagefind WASM, Typst, MCP.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { parseDocument, type LumenNode } from '@omnitron-dev/lumen-ast';
import { withLumenProject, type LumenProject } from '../config/project.js';
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
import { captureGeneration, recoverGeneration } from '../ssg/publish-generation.js';
import { directoryRouteRedirects } from '../ssg/serve-routes.js';
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
  host: string;
  port: number;
  gatesFilter?: string[];
}

interface CliValues {
  root: string;
  outDir?: string;
  write?: boolean;
  strict?: boolean;
  json?: boolean;
  format?: 'json';
  host?: string;
  port?: number;
  gates?: string;
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
  rootDir: string,
  config: LumenConfig
): Promise<{
  config: LumenConfig;
  graph: CorpusGraph;
  docsDir: string;
  docsDirExists: boolean;
  astDiagnostics: LumenGateDiagnostic[];
}> {
  const docsDir = resolve(rootDir, config.srcDir);
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

function buildReferenceGates(config: LumenConfig): CorpusGate[] {
  const policies = [
    [linksGate, config.onBrokenLinks ?? 'throw'],
    [anchorsGate, config.onBrokenAnchors ?? 'throw'],
  ] as const;
  return policies.flatMap(([gate, policy]): CorpusGate[] => {
    if (policy === 'ignore') return [];
    if (policy === 'throw') return [gate];
    return [{
      ...gate,
      async run(context) {
        const reported: LumenGateDiagnostic[] = [];
        const result = await gate.run({ ...context, reportDiagnostic: diagnostic => reported.push(diagnostic) });
        const diagnostics = [...result.diagnostics, ...reported].map(diagnostic => ({
          ...diagnostic,
          severity: diagnostic.severity === 'error' ? 'warning' as const : diagnostic.severity,
        }));
        const messages = new Set(diagnostics.map(diagnostic =>
          `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code} (${diagnostic.file ?? 'corpus'}): ${diagnostic.message}`
        ));
        for (const message of messages) {
          if (policy === 'warn') console.warn(message);
          else console.log(message);
        }
        return { ...result, passed: true, diagnostics };
      },
    }];
  });
}

export async function runLumenCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const program = new Command('lumen')
    .description('Build, verify and serve a Lumen documentation project')
    .version(VERSION, '-v, --version')
    .exitOverride()
    .configureOutput({
      writeOut: text => console.log(text.trimEnd()),
      writeErr: text => console.error(text.trimEnd()),
    });
  const descriptions = {
    dev: 'Build and serve documentation with live updates',
    build: 'Build verified static documentation',
    serve: 'Preview a verified static generation',
    check: 'Run corpus verification gates',
    pdf: 'Compile academic PDFs through Typst',
    mcp: 'Serve the corpus through Model Context Protocol on stdio',
    types: 'Generate TypeScript contracts from the corpus',
  };
  for (const [name, description] of Object.entries(descriptions)) {
    const command = program.command(name).description(description)
      .allowExcessArguments(false)
      .option('--root <directory>', 'Project directory', process.cwd());
    if (['dev', 'build', 'serve', 'pdf', 'types'].includes(name)) {
      command.option('--outDir <directory>', 'Output directory relative to the project');
    }
    if (['build', 'pdf', 'types'].includes(name)) command.option('--write', 'Write output even for an empty corpus');
    if (['dev', 'serve'].includes(name)) {
      command.option('--host <host>', 'Listening interface', '127.0.0.1')
        .option('--port <port>', 'Listening port', value => {
          const port = Number(value);
          if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
            throw new InvalidArgumentError('Port must be an integer from 1 to 65535');
          }
          return port;
        }, 4173);
    }
    if (name === 'check') {
      command.option('--json', 'Write only JSON diagnostics to stdout')
        .addOption(new Option('--format <format>', 'Diagnostic output format').choices(['json']))
        .option('--strict', 'Throw when corpus verification fails')
        .option('--gates <names>', 'Comma-separated built-in gate names');
    }
    if (name === 'mcp') command.option('--stdio', 'Use the stdio transport');
    command.action(async (values: CliValues) => {
      const options: ParsedCliOptions = {
        rootDir: resolve(values.root), outDir: values.outDir,
        write: values.write ?? false, strict: values.strict ?? false,
        json: Boolean(values.json || values.format === 'json'),
        host: values.host ?? '127.0.0.1', port: values.port ?? 4173,
        gatesFilter: values.gates?.split(',').map((value: string) => value.trim()).filter(Boolean),
      };
      await withLumenProject(options.rootDir, project => executeLumenCommand(name, options, project), {
        logLevel: options.json || name === 'mcp' ? 'silent' : 'info',
      });
    });
  }
  if (!argv.length) { program.outputHelp(); return; }
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.exitCode !== 0) process.exitCode = error.exitCode;
  }
}

async function executeLumenCommand(command: string, cliOpts: ParsedCliOptions, project: LumenProject): Promise<void> {
  const initialConfig = project.config;
  switch (command) {
    case 'dev': {
      console.log(`Lumen CLI v${VERSION} (command: dev)`);
      await executeLumenCommand('build', cliOpts, project);
      const config = initialConfig;
      const { createServer } = await import('vite');
      // Vite's default cache is inside its root. The served generation is
      // verified publication output and must never contain compiler state.
      const cacheDir = mkdtempSync(join(tmpdir(), 'lumen-dev-'));
      const outDir = resolve(cliOpts.rootDir, cliOpts.outDir ?? config.outDir);
      const server = await createServer({
        configFile: false,
        root: outDir,
        base: config.baseUrl,
        cacheDir,
        publicDir: false,
        appType: 'mpa',
        plugins: [config.trailingSlash && directoryRouteRedirects(outDir), {
          name: 'lumen-dev-cache',
          // Vite awaits this hook after the optimizer and server environments
          // close, including its own SIGTERM shutdown path.
          closeServer: () => { rmSync(cacheDir, { recursive: true, force: true }); },
        }],
        server: { host: cliOpts.host, port: cliOpts.port, strictPort: true },
      }).catch(error => { rmSync(cacheDir, { recursive: true, force: true }); throw error; });
      await server.listen().catch(async error => {
        await server.close();
        rmSync(cacheDir, { recursive: true, force: true });
        throw error;
      });
      server.printUrls();
      let pending = false;
      let building = false;
      let closing = false;
      const rebuild = async () => {
        if (closing) return;
        pending = true;
        if (building) return;
        building = true;
        while (pending && !closing) {
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
      const shutdown = () => {
        if (closing) return;
        closing = true;
        for (const watcher of watchers) watcher.close();
        process.removeListener('SIGINT', shutdown);
        process.removeListener('SIGTERM', shutdown);
        void server.close().catch(error => {
          console.error(error);
          process.exitCode = 1;
        });
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
      server.httpServer?.once('close', shutdown);
      break;
    }

    case 'build': {
      console.log(`Lumen CLI v${VERSION} (command: build)`);

      recoverGeneration(resolve(cliOpts.rootDir, cliOpts.outDir ?? initialConfig.outDir));
      const { config, graph, docsDirExists, astDiagnostics } = await loadCorpusFromDirectory(cliOpts.rootDir, initialConfig);
      const gateResult = await runCorpusGates(
        { documents: graph.getAllDocuments(), graph, config, reportDiagnostic: () => {} },
        [...buildReferenceGates(config), ...(config.gates ?? [])]
      );
      const errors = [...astDiagnostics, ...gateResult.diagnostics].filter((item) => item.severity === 'error');
      if (!gateResult.passed || errors.length)
        throw new Error(errors.length
          ? errors.map((item) => `${item.file}: ${item.code}: ${item.message}`).join('\n')
          : `Corpus gates failed: ${gateResult.results.filter(result => !result.passed).map(result => result.name).join(', ')}`);
      const targetOutDir = cliOpts.outDir
        ? resolve(cliOpts.rootDir, cliOpts.outDir)
        : resolve(cliOpts.rootDir, config.outDir || 'dist');

      const shouldWriteToDisk = cliOpts.write || docsDirExists;
      await project.build(graph, config, {
        rootDir: cliOpts.rootDir,
        outDir: targetOutDir,
        writeToDisk: shouldWriteToDisk,
      });
      break;
    }

    case 'serve': {
      console.log(`Lumen CLI v${VERSION} (command: serve)`);
      const config = initialConfig;
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
        plugins: [config.trailingSlash && directoryRouteRedirects(snapshot.directory)],
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
      if (!cliOpts.json) {
        console.log(`Lumen CLI v${VERSION} (command: check)`);
      }

      const { config, graph, astDiagnostics } = await loadCorpusFromDirectory(cliOpts.rootDir, initialConfig);
      const builtinGates: CorpusGate[] = [
        linksGate,
        anchorsGate,
        codeDefaultsGate,
        codeExamplesGate,
        undocumentedExportsGate,
        mathKernelGate,
      ];

      if (cliOpts.gatesFilter) {
        const names = new Set(builtinGates.map(gate => gate.name));
        const unknown = cliOpts.gatesFilter.filter(name => !names.has(name));
        if (!cliOpts.gatesFilter.length || unknown.length) {
          throw new Error(`Unknown built-in gates: ${unknown.join(', ') || '(empty selection)'}. Available: ${[...names].join(', ')}`);
        }
      }
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

      const { config, graph, docsDirExists } = await loadCorpusFromDirectory(cliOpts.rootDir, initialConfig);
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

      const { graph, docsDirExists, astDiagnostics } = await loadCorpusFromDirectory(cliOpts.rootDir, initialConfig);
      if (!docsDirExists) throw new Error('Configured corpus directory does not exist');
      if (astDiagnostics.some(diagnostic => diagnostic.severity === 'error')) throw new Error('Corpus parsing failed; run lumen check for diagnostics');
      await runLumenMcpServer(graph);
      break;
    }

    case 'types': {
      console.log(`Lumen CLI v${VERSION} (command: types)`);

      const { graph, docsDirExists } = await loadCorpusFromDirectory(cliOpts.rootDir, initialConfig);
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

    default:
      throw new Error(`Unknown Lumen command: ${command}`);
  }
}
