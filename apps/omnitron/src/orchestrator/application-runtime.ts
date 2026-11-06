import path from 'node:path';
import { readInFreshProcess, moduleReaderEntry } from '../shared/fresh-module-reader.js';

/** Keep an application's Titan/DI identity independent of the controller's release. */
export async function applicationBootstrapRuntime(bootstrap: string, fallback: string): Promise<string> {
  // createRequire() shares Node's resolution and realpath caches. Recreating
  // the require function does not observe a replaced pnpm link or package.json
  // in a resident owner. Use the same bounded reader as application metadata;
  // never clear global loader internals or retain another module graph here.
  const adapter = await readInFreshProcess({
    entryPath: moduleReaderEntry(import.meta.url, 'application-runtime-child'),
    args: [bootstrap, fallback],
    timeoutMs: 10_000,
    label: 'the current application runtime',
  });
  if (typeof adapter !== 'string' || !path.isAbsolute(adapter)) {
    throw new Error('The application runtime reader returned an invalid adapter path');
  }
  return adapter;
}

