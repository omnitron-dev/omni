import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/** Shared policy for fresh readers and the one-shot remote installer.
 * Only resolves entries; never executes application code or runs in a resident owner. */
export function resolveApplicationBootstrapRuntime(bootstrap: string, fallback: string): string {
  if (!path.isAbsolute(bootstrap) || !path.isAbsolute(fallback)) {
    throw new Error('Application runtime resolution requires absolute entry paths');
  }
  const request = createRequire(bootstrap);
  let entry: string;
  try { entry = request.resolve('@omnitron-dev/omnitron'); }
  catch (error) {
    // A broken installed adapter is not an absent adapter. Replacing it with
    // the owner's SDK would conceal an incomplete dependency installation.
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND' ||
        request.resolve.paths('@omnitron-dev/omnitron')?.some(directory =>
          fs.lstatSync(path.join(directory, '@omnitron-dev/omnitron'), { throwIfNoEntry: false }))) {
      throw new Error('The installed application Omnitron adapter cannot be resolved; repair its dependency installation', { cause: error });
    }
    // A standalone app can use the owner's adapter if both share Titan.
    const owner = createRequire(fallback).resolve('@omnitron-dev/titan');
    const application = request.resolve('@omnitron-dev/titan');
    if (fs.realpathSync(owner) === fs.realpathSync(application)) return fallback;
    throw new Error('The application uses a different Titan runtime. Install an aligned @omnitron-dev/omnitron adapter with the application before starting it.', { cause: error });
  }
  const adapter = path.join(path.dirname(entry), 'orchestrator/bootstrap-process.js');
  if (!fs.statSync(adapter, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('The application Omnitron package has no compiled bootstrap adapter');
  }
  const expected = request.resolve('@omnitron-dev/titan');
  const actual = createRequire(adapter).resolve('@omnitron-dev/titan');
  if (fs.realpathSync(expected) !== fs.realpathSync(actual)) {
    throw new Error('The application and its Omnitron adapter resolve different Titan instances; align their installed dependencies');
  }
  return adapter;
}

