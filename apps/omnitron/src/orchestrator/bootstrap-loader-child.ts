/**
 * Reads one app definition in a process of its own and answers with it as
 * data — the other half of `loadBootstrapConfig`'s `freshModuleGraph`.
 *
 * A process keeps one module graph for its life, so the daemon, which lives
 * until someone restarts it, cannot see a package change by importing a
 * definition again: it gets every package as it was at its first import. This
 * process is started
 * for one read and is gone after it; the graph it builds is the tree as it is
 * now.
 *
 * It reads the definition as the daemon would have in its own process: the
 * same loader code (`loadBootstrapConfig`, dev mode, in-process), the same Node
 * flags (`--import tsx/esm` among them), working directory and environment.
 * Then it answers once over IPC and exits, whatever the definition left open —
 * a client, a timer — since nothing here will ever use it.
 */

import {
  FRESH_GRAPH_ANSWER,
  definitionAsData,
  loadBootstrapConfig,
  type FreshGraphAnswer,
} from './bootstrap-loader.js';

// The parent is the only one this answer is for. Gone, it leaves nothing to do.
process.once('disconnect', () => process.exit(3));

function answer(message: FreshGraphAnswer): void {
  const code = message.ok ? 0 : 1;
  if (!process.send) {
    process.stderr.write('bootstrap-loader-child: started without an IPC channel, so there is no one to answer\n');
    process.exit(2);
  }
  process.send(message, undefined, {}, () => process.exit(code));
}

const bootstrapPath = process.argv[2];
try {
  if (!bootstrapPath) throw new Error('no definition path was given');
  const definition = await loadBootstrapConfig(bootstrapPath, { devMode: true });
  const data = definitionAsData(definition);
  if (data === undefined) throw new Error('the definition loaded, but could not be read as data');
  answer({ type: FRESH_GRAPH_ANSWER, ok: true, definition: data });
} catch (err) {
  const error = err instanceof Error ? err : new Error(String(err));
  answer({ type: FRESH_GRAPH_ANSWER, ok: false, message: error.message, name: error.name, stack: error.stack });
}
