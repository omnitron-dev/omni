import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IKbStats, KnowledgeBase } from '@omnitron-dev/kb';
import { getEnv } from '../shared/env-config.js';

/**
 * Where the knowledge base lives: `~/.omnitron/kb.db`, a SurrealKV directory.
 *
 * One definition for the four commands below, which each spelled it out.
 */
function kbDbPath(): string {
  return resolve(process.env['HOME'] ?? '.', '.omnitron', 'kb.db');
}

/**
 * The knowledge base, opened for reading — or `null`, after saying why there
 * is nothing to read and setting exit code 1.
 *
 * `kb status` and `kb query` used to open the store unconditionally, and for
 * a store that is not there opening is creating: `SurrealKbStore.initialize()`
 * connects, which makes the SurrealKV directory, and applies `KB_SCHEMA`.
 * Measured 2026-09-23 with a scratch HOME: `kb status` printed eight lines of
 * zeros, exited 0 and left a 32 KB `.omnitron/kb.db` behind; `kb query`
 * answered «Found 0 results (0 tokens)» and exited 0. Both read as «indexed,
 * and nothing matched» — the one thing that was not true — and on a real HOME
 * both would have written into `~/.omnitron` the same way. So the path is
 * checked before anything is opened.
 *
 * A store that exists and holds no module is the same answer, and is refused
 * the same way: every source `kb index` takes writes its module first
 * (`Indexer.indexSource`), so zero modules means nothing was ever indexed into
 * it. That is exactly what the old `kb status` and `kb query` left behind, and
 * what `kb mcp` still creates on a machine that never ran `kb index`.
 */
async function openIndexedKb(): Promise<{ kb: KnowledgeBase; stats: IKbStats } | null> {
  const { log } = await import('@xec-sh/kit');
  const dbPath = kbDbPath();

  if (!existsSync(dbPath)) {
    log.error('The knowledge base is not indexed — run `omnitron kb index`.');
    log.info(`Nothing at ${dbPath}; nothing was created there.`);
    process.exitCode = 1;
    return null;
  }

  const { KnowledgeBase } = await import('@omnitron-dev/kb');
  const { SurrealKbStore } = await import('@omnitron-dev/kb/surreal');
  const root = getEnv().OMNITRON_ROOT ?? process.cwd();

  const kb = new KnowledgeBase({ store: new SurrealKbStore({ url: `surrealkv://${dbPath}` }), root });
  await kb.initialize();
  const stats = await kb.status();

  if (stats.modules === 0) {
    await kb.close();
    log.error('The knowledge base is not indexed: no module has been indexed into it — run `omnitron kb index`.');
    log.info(`${dbPath} exists and is empty. \`kb index\` reads the workspace at OMNITRON_ROOT, or the current directory.`);
    process.exitCode = 1;
    return null;
  }

  return { kb, stats };
}

/**
 * `omnitron kb mcp` — Start MCP server for AI assistants.
 * Connects to daemon for management tools, initializes KB for knowledge tools.
 */
export async function kbMcpCommand(): Promise<void> {
  const { McpBridge } = await import('../mcp/mcp-bridge.js');
  const { createKbTools } = await import('../mcp/tool-groups/kb.tools.js');
  const { createAppsTools } = await import('../mcp/tool-groups/apps.tools.js');
  const { createInfraTools } = await import('../mcp/tool-groups/infra.tools.js');
  const { createMonitoringTools } = await import('../mcp/tool-groups/monitoring.tools.js');
  const { createManagementTools } = await import('../mcp/tool-groups/management.tools.js');

  const { createUnavailableTools, DAEMON_TOOL_NAMES, KB_TOOL_NAMES } = await import(
    '../mcp/unavailable-tools.js'
  );
  const DAEMON_DOWN = 'The omnitron daemon is not running. Run `omnitron up` to start it.';

  const bridge = new McpBridge();

  // Initialize KB (standalone, no daemon required)
  let kbService: any = null;
  try {
    const { KnowledgeBase } = await import('@omnitron-dev/kb');
    const { SurrealKbStore } = await import('@omnitron-dev/kb/surreal');

    const dbPath = kbDbPath();
    const root = getEnv().OMNITRON_ROOT ?? process.cwd();

    // Opens — and on a machine that never ran `kb index`, creates — the
    // store, deliberately: this server's `kb.index` tool indexes into it.
    const store = new SurrealKbStore({ url: `surrealkv://${dbPath}` });
    const kb = new KnowledgeBase({ store, root });
    await kb.initialize();
    kbService = kb;

    bridge.registerTools(createKbTools(kbService));
  } catch (err) {
    // Register stubs rather than nothing. An agent that cannot see a tool
    // concludes the capability does not exist; one that sees it and is told
    // why relays something the user can act on. stderr is not read by MCP
    // clients, so the message below reaches a human tailing the process and
    // no one else.
    process.stderr.write(`[mcp] KB initialization failed: ${err}\n`);
    process.stderr.write('[mcp] KB tools will report: run `omnitron kb index` first.\n');
    bridge.registerTools(
      createUnavailableTools(KB_TOOL_NAMES, 'The knowledge base is not indexed. Run `omnitron kb index` first.')
    );
  }

  // Try connecting to daemon for management tools
  let daemonClient: any = null;
  try {
    const { createDaemonClient } = await import('../daemon/daemon-client.js');
    daemonClient = createDaemonClient();

    if (await daemonClient.isReachable()) {
      bridge.registerTools(createAppsTools(daemonClient));
      bridge.registerTools(createInfraTools(daemonClient));
      bridge.registerTools(createMonitoringTools(daemonClient));
      bridge.registerTools(createManagementTools(daemonClient));
    } else {
      process.stderr.write('[mcp] Daemon not running — management tools will report why.\n');
      bridge.registerTools(createUnavailableTools(DAEMON_TOOL_NAMES, DAEMON_DOWN));
    }
  } catch (err) {
    process.stderr.write(`[mcp] Daemon connection failed: ${err}\n`);
    bridge.registerTools(createUnavailableTools(DAEMON_TOOL_NAMES, DAEMON_DOWN));
  }

  // Start stdio MCP server
  await bridge.start();

  // Cleanup
  if (kbService?.close) await kbService.close();
  if (daemonClient?.disconnect) await daemonClient.disconnect();
}

/**
 * `omnitron kb index` — Reindex the knowledge base.
 */
export async function kbIndexCommand(options: {
  full?: boolean;
  watch?: boolean;
}): Promise<void> {
  const { log } = await import('@xec-sh/kit');
  const { spinner } = await import('./spinner.js');
  const { KnowledgeBase } = await import('@omnitron-dev/kb');
  const { SurrealKbStore } = await import('@omnitron-dev/kb/surreal');

  const dbPath = kbDbPath();
  const root = getEnv().OMNITRON_ROOT ?? process.cwd();

  const s = spinner();
  s.start('Initializing knowledge base...');

  const store = new SurrealKbStore({ url: `surrealkv://${dbPath}` });
  const kb = new KnowledgeBase({ store, root });
  await kb.initialize();

  s.stop('KB initialized');

  s.start(options.full ? 'Full reindexing...' : 'Incremental reindexing...');
  const result = await kb.reindex({ full: options.full ?? false });
  s.stop(`Indexed: ${result.indexed}, Skipped: ${result.skipped}`);

  const stats = await kb.status();
  log.info(`Modules: ${stats.modules}`);
  log.info(`Symbols: ${stats.symbols}`);
  log.info(`Specs: ${stats.specs}`);
  log.info(`Gotchas: ${stats.gotchas}`);
  log.info(`Patterns: ${stats.patterns}`);
  log.info(`Dependencies: ${stats.dependencies}`);

  if (stats.embeddingsIndexed > 0) {
    log.info(`Embeddings: ${stats.embeddingsIndexed}`);
  }

  await kb.close();
}

/**
 * `omnitron kb status` — Show KB index status.
 */
export async function kbStatusCommand(): Promise<void> {
  const { log } = await import('@xec-sh/kit');
  const opened = await openIndexedKb();
  if (!opened) return;
  const { kb, stats } = opened;

  log.info('Knowledge Base Status:');
  log.info(`  Modules:       ${stats.modules}`);
  log.info(`  Symbols:       ${stats.symbols}`);
  log.info(`  Specs:         ${stats.specs}`);
  log.info(`  Chunks:        ${stats.chunks}`);
  log.info(`  Gotchas:       ${stats.gotchas}`);
  log.info(`  Patterns:      ${stats.patterns}`);
  log.info(`  Dependencies:  ${stats.dependencies}`);
  // Counted by the store now; it was the constant 0 there (surreal/client.ts).
  log.info(`  Embeddings:    ${stats.embeddingsIndexed}`);
  // No «Last indexed» line: nothing records when an index ran, so the store
  // can only answer `null`, and a line that could never print was a promise
  // of a measurement that does not exist.

  await kb.close();
}

/**
 * `omnitron kb query` — Test query against the KB.
 */
export async function kbQueryCommand(question: string): Promise<void> {
  const { log } = await import('@xec-sh/kit');
  const opened = await openIndexedKb();
  if (!opened) return;
  const { kb } = opened;

  const result = await kb.query(question, { maxResults: 5 });

  log.info(`Found ${result.entries.length} results (${result.totalTokens} tokens):`);
  for (const entry of result.entries) {
    log.info(`\n[${entry.kind}] ${entry.title}`);
    log.info(`  Module: ${entry.module}`);
    log.info(`  ${entry.content.slice(0, 200)}${entry.content.length > 200 ? '...' : ''}`);
  }

  await kb.close();
}
