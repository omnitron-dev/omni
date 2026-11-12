import semver from 'semver';
import { distributionTag, registryAddress, releaseCommand, ReleaseCommandError, releaseTag } from '@xec-sh/ops/release';

const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Admission for a new release, before changing versions or building anything.
 * Prepared-release resumption uses its existing archive identity checks instead.
 * Availability is an observation, not a reservation; publication rechecks npm. */
export async function assertReleaseVersionAvailable(root, packages, version, options = {}) {
  releaseTag(version);
  const registry = registryAddress(options.registry), channel = distributionTag(version);
  if (!Array.isArray(packages) || !packages.length) throw Error('Release registry preflight requires a nonempty package inventory');
  const names = new Set();
  for (const pkg of packages) {
    if (!pkg || typeof pkg.name !== 'string' || !packageName.test(pkg.name) || names.has(pkg.name))
      throw Error('Invalid or duplicate release package identity');
    releaseTag(pkg.version);
    names.add(pkg.name);
  }
  const run = options.run ?? releaseCommand;
  const inspect = async pkg => {
    const args = ['view', pkg.name, 'name', 'versions', 'dist-tags', '--json', '--prefer-online', '--registry', registry];
    if (pkg.name.startsWith('@')) args.push(`--${pkg.name.split('/')[0]}:registry=${registry}`);
    let text;
    try { text = await run(root, 'npm', args, { env: options.env }); }
    catch (error) {
      if (error instanceof ReleaseCommandError) {
        try { if (JSON.parse(error.stdout)?.error?.code === 'E404') return; }
        catch { /* A malformed error never proves that the version is available. */ }
      }
      throw Error(`Cannot verify registry availability of ${pkg.name}@${version}; no release preparation admitted`, { cause: error });
    }
    let metadata;
    try { metadata = JSON.parse(text); }
    catch (error) { throw Error(`Invalid npm metadata for ${pkg.name}`, { cause: error }); }
    const versions = metadata?.versions, tags = metadata?.['dist-tags'];
    if (!object(metadata) || metadata.name !== pkg.name || !Array.isArray(versions) || !versions.length ||
        versions.some(value => typeof value !== 'string' || semver.valid(value) !== value) ||
        new Set(versions).size !== versions.length || !object(tags) ||
        Object.values(tags).some(value => typeof value !== 'string' || semver.valid(value) !== value || !versions.includes(value)))
      throw Error(`Invalid npm metadata for ${pkg.name}`);
    if (versions.includes(version))
      throw Error(`Cannot prepare ${pkg.name}@${version}: this version already exists in ${registry}. Select an unused version; npm versions cannot be overwritten`);
    const current = tags[channel];
    if (current !== undefined && semver.gt(current, version))
      throw Error(`Cannot prepare ${pkg.name}@${version}: ${channel} is already ${current}; refusing a registry channel downgrade`);
  };
  let next = 0, failure;
  await Promise.all(Array.from({ length: Math.min(4, packages.length) }, async () => {
    while (!failure && next < packages.length) {
      const pkg = packages[next++];
      try { await inspect(pkg); }
      catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
}
