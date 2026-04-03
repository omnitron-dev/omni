import { resolve } from 'node:path';

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

  const bridge = new McpBridge();

  // Initialize KB (standalone, no daemon required)
  let kbService: any = null;
  try {
    const { KnowledgeBase } = await import('@omnitron-dev/kb');
    const { SurrealKbStore } = await import('@omnitron-dev/kb/surreal');

    const dbPath = resolve(
      process.env['HOME'] ?? '.',
      '.omnitron',
      'kb.db',
    );
    const root = process.env['OMNITRON_ROOT'] ?? process.cwd();

    const store = new SurrealKbStore({ url: `surrealkv://${dbPath}` });
    const kb = new KnowledgeBase({ store, root });
    await kb.initialize();
    kbService = kb;

    bridge.registerTools(createKbTools(kbService));
  } catch (err) {
    // KB not available — register stub tools that return helpful errors
    process.stderr.write(`[mcp] KB initialization failed: ${err}\n`);
    process.stderr.write('[mcp] KB tools will not be available. Run `omnitron kb index` first.\n');
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
      process.stderr.write('[mcp] Daemon not running — management tools not available.\n');
      process.stderr.write('[mcp] Run `omnitron up` to start the daemon.\n');
    }
  } catch {
    process.stderr.write('[mcp] Daemon connection failed — management tools not available.\n');
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
  const { log, spinner } = await import('@xec-sh/kit');
  const { KnowledgeBase } = await import('@omnitron-dev/kb');
  const { SurrealKbStore } = await import('@omnitron-dev/kb/surreal');

  const dbPath = resolve(
    process.env['HOME'] ?? '.',
    '.omnitron',
    'kb.db',
  );
  const root = process.env['OMNITRON_ROOT'] ?? process.cwd();

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
  const { KnowledgeBase } = await import('@omnitron-dev/kb');
  const { SurrealKbStore } = await import('@omnitron-dev/kb/surreal');

  const dbPath = resolve(
    process.env['HOME'] ?? '.',
    '.omnitron',
    'kb.db',
  );
  const root = process.env['OMNITRON_ROOT'] ?? process.cwd();

  const store = new SurrealKbStore({ url: `surrealkv://${dbPath}` });
  const kb = new KnowledgeBase({ store, root });
  await kb.initialize();

  const stats = await kb.status();

  log.info('Knowledge Base Status:');
  log.info(`  Modules:       ${stats.modules}`);
  log.info(`  Symbols:       ${stats.symbols}`);
  log.info(`  Specs:         ${stats.specs}`);
  log.info(`  Chunks:        ${stats.chunks}`);
  log.info(`  Gotchas:       ${stats.gotchas}`);
  log.info(`  Patterns:      ${stats.patterns}`);
  log.info(`  Dependencies:  ${stats.dependencies}`);
  log.info(`  Embeddings:    ${stats.embeddingsIndexed}`);

  if (stats.lastIndexedAt) {
    log.info(`  Last indexed:  ${stats.lastIndexedAt}`);
  }

  await kb.close();
}

/**
 * `omnitron kb query` — Test query against the KB.
 */
export async function kbQueryCommand(question: string): Promise<void> {
  const { log } = await import('@xec-sh/kit');
  const { KnowledgeBase } = await import('@omnitron-dev/kb');
  const { SurrealKbStore } = await import('@omnitron-dev/kb/surreal');

  const dbPath = resolve(
    process.env['HOME'] ?? '.',
    '.omnitron',
    'kb.db',
  );
  const root = process.env['OMNITRON_ROOT'] ?? process.cwd();

  const store = new SurrealKbStore({ url: `surrealkv://${dbPath}` });
  const kb = new KnowledgeBase({ store, root });
  await kb.initialize();

  const result = await kb.query(question, { maxResults: 5 });

  log.info(`Found ${result.entries.length} results (${result.totalTokens} tokens):`);
  for (const entry of result.entries) {
    log.info(`\n[${entry.kind}] ${entry.title}`);
    log.info(`  Module: ${entry.module}`);
    log.info(`  ${entry.content.slice(0, 200)}${entry.content.length > 200 ? '...' : ''}`);
  }

  await kb.close();
}
