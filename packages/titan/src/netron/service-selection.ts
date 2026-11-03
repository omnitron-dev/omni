import semver from 'semver';

/** Shared by packet and HTTP transports: an explicit unversioned publication
 * takes precedence; otherwise an unqualified request selects the latest version.
 * Explicit versions are exact, never silently redirected to another contract.
 */
export function selectServiceName(names: Iterable<string>, requested: string): string | undefined {
  const name = requested.endsWith('@*') || requested.endsWith('@')
    ? requested.slice(0, requested.lastIndexOf('@')) : requested;
  const explicitVersion = name.includes('@');
  const prefix = name + '@';
  let selected: string | undefined, selectedVersion: string | undefined;
  for (const key of names) {
    if (key === name) return key;
    if (explicitVersion || !key.startsWith(prefix)) continue;
    const version = semver.valid(key.slice(prefix.length));
    if (version && (!selectedVersion || semver.gt(version, selectedVersion))) {
      selected = key; selectedVersion = version;
    }
  }
  return selected;
}
