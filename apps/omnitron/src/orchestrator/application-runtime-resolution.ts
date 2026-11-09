import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/** Shared policy for fresh readers and the one-shot remote installer.
 * Only resolves entries; never executes application code or runs in a resident owner. */
export function resolveApplicationBootstrapRuntime(bootstrap: string, fallback: string, allowSdklessBootstrap = false): string {
  if (!path.isAbsolute(bootstrap) || !path.isAbsolute(fallback)) {
    throw new Error('Application runtime resolution requires absolute entry paths');
  }
  const request = createRequire(bootstrap);
  function installed(name: string): string | undefined {
    try { return request.resolve(name); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND' &&
          !request.resolve.paths(name)?.some(directory => fs.lstatSync(path.join(directory, name), { throwIfNoEntry: false }))) return undefined;
      throw new Error('The installed application package ' + name + ' cannot be resolved; repair its dependency installation', { cause: error });
    }
  }
  const entry = installed('@omnitron-dev/omnitron');
  const application = installed('@omnitron-dev/titan');
  // A directly supervising daemon also accepts plain bootstrap files. A missing
  // dependency declared by the application is an installation error.
  if (!entry && !application && allowSdklessBootstrap) {
    let directory = path.dirname(bootstrap);
    while (true) {
      const manifest = path.join(directory, 'package.json');
      if (fs.existsSync(manifest)) {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        const sections = [pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies, pkg.devDependencies];
        if (sections.some(deps => deps && (Object.hasOwn(deps, '@omnitron-dev/omnitron') || Object.hasOwn(deps, '@omnitron-dev/titan'))))
          throw new Error('The application declares a missing Omnitron or Titan package; install its dependencies');
        break;
      }
      const parent = path.dirname(directory);
      if (directory === parent) break;
      directory = parent;
    }
    return fallback;
  }
  if (!application) throw new Error('The application Titan runtime cannot be resolved; install the application dependencies');
  if (!entry) {
    const owner = createRequire(fallback).resolve('@omnitron-dev/titan');
    if (fs.realpathSync(owner) === fs.realpathSync(application)) return fallback;
    throw new Error('The application uses a different Titan runtime. Install an aligned @omnitron-dev/omnitron adapter with the application before starting it.');
  }
  const adapter = path.join(path.dirname(entry), 'orchestrator/bootstrap-process.js');
  if (!fs.statSync(adapter, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('The application Omnitron package has no compiled bootstrap adapter');
  }
  const actual = createRequire(adapter).resolve('@omnitron-dev/titan');
  if (fs.realpathSync(application) !== fs.realpathSync(actual)) {
    throw new Error('The application and its Omnitron adapter resolve different Titan instances; align their installed dependencies');
  }
  return adapter;
}

