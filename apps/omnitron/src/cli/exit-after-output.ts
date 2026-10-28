import type { Writable } from 'node:stream';

function flush(stream: Writable): Promise<void> {
  if (stream.destroyed || !stream.writable) return Promise.resolve();
  return new Promise((resolve) => stream.write('', () => resolve()));
}

/** Drain piped output before closing transport handles left by a CLI command. */
export async function exitAfterOutput(code: number | string): Promise<never> {
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(code);
}
