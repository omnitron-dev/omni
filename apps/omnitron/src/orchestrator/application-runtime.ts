import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/** Keep an application's Titan/DI identity independent of the controller's release. */
export function applicationBootstrapRuntime(bootstrap: string, fallback: string): string {
  const request = createRequire(bootstrap);
  let entry: string;
  try { entry = request.resolve('@omnitron-dev/omnitron'); }
  catch {
    // A standalone app can use the owner's adapter if both share Titan.
    const owner = createRequire(fallback).resolve('@omnitron-dev/titan');
    const application = request.resolve('@omnitron-dev/titan');
    if (fs.realpathSync(owner) === fs.realpathSync(application)) return fallback;
    throw new Error('The application uses a different Titan runtime. Install an aligned @omnitron-dev/omnitron adapter with the application before starting it.');
  }
  const adapter = path.join(path.dirname(entry), 'orchestrator/bootstrap-process.js');
  if (!fs.statSync(adapter).isFile()) throw new Error('The application Omnitron package has no compiled bootstrap adapter');
  const expected = request.resolve('@omnitron-dev/titan');
  const actual = createRequire(adapter).resolve('@omnitron-dev/titan');
  if (fs.realpathSync(expected) !== fs.realpathSync(actual)) throw new Error('The application and its Omnitron adapter resolve different Titan instances; align their installed dependencies');
  return adapter;
}
