/**
 * Building a node bundle in a process of its own.
 *
 * `buildOwnBundle` compiles and stages omnitron with dozens of synchronous
 * filesystem calls, a recursive `cpSync` of whole packages among them. Run on
 * the daemon's thread it is not a slow call but a STOP: measured from the
 * console on 2026-09-22, the master answered nothing for ~150 seconds —
 * health checks, node polls, every RPC — while one upgrade built. So the
 * daemon runs this file as a child and waits for one line of JSON.
 *
 * The staging directory and the archive are NOT removed here. They belong to
 * the rollout that asked for them: one bundle is installed on every node of
 * that rollout, and the parent removes both when the last node is done.
 *
 * Usage: node bundle-build-worker.js <workspaceRoot> <label>
 * Last line of stdout: {"version": "...", "dirty": false, "archive": "/tmp/..."}
 */

import { buildOwnBundle } from './bundle-builder.js';
import { failureOutput } from './bundle-worker-protocol.js';

async function main(): Promise<void> {
  const [workspaceRoot, label] = process.argv.slice(2);
  if (!workspaceRoot || !label) {
    process.stderr.write('usage: bundle-build-worker <workspaceRoot> <label>\n');
    process.exit(2);
  }
  const bundle = await buildOwnBundle({
    workspaceRoot,
    label,
    logger: { info: (message: string) => process.stderr.write(`${message}\n`) },
  });
  const archive = await bundle.pack();
  process.stdout.write(`${JSON.stringify({ version: bundle.version, dirty: bundle.dirty, archive })}\n`);
}

main().catch((err: unknown) => {
  // The stack for the log, and the reason as the last line — which is what
  // the daemon reports (`bundle-worker-protocol.ts`).
  process.stderr.write(failureOutput(err));
  process.exit(1);
});
