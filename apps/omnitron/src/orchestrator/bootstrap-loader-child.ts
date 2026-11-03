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
 * same loader code (`loadBootstrapConfig`, selected mode, in-process), the same Node
 * flags (`--import tsx/esm` among them), working directory and environment.
 * Then it answers once over IPC and exits, whatever the definition left open —
 * a client, a timer — since nothing here will ever use it.
 */

import { definitionAsData, loadBootstrapConfig } from './bootstrap-loader.js';
import { initializeModuleReader, answerModuleRead } from '../shared/fresh-module-reader.js';

initializeModuleReader();

const bootstrapPath = process.argv[2];
try {
  if (!bootstrapPath) throw new Error('no definition path was given');
  const definition = await loadBootstrapConfig(bootstrapPath, { devMode: process.argv[3] !== 'production' });
  const data = definitionAsData(definition);
  if (data === undefined) throw new Error('the definition loaded, but could not be read as data');
  answerModuleRead({ ok: true, value: data });
} catch (err) {
  answerModuleRead({ ok: false, error: err });
}
