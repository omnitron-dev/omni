export interface TargetRuntime {
  platform: string;
  arch: string;
  node: string;
  abi: string;
  /** Bind the executable as well as its reported version. */
  executableSha256: string;
  libc: string | null;
}

/** Compare all fields, including the actual executable; a version string alone
 * cannot establish native-addon or sealed-runtime compatibility. */
export function assertReleaseTarget(expected: TargetRuntime | undefined, actual: TargetRuntime | undefined): void {
  const keys = ['platform', 'arch', 'node', 'abi', 'executableSha256', 'libc'] as const;
  for (const [label, value] of [['release', expected], ['execution owner', actual]] as const) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        keys.some(key => key === 'libc' && value[key] === null ? false : typeof value[key] !== 'string' || !value[key]) ||
        !/^[a-f0-9]{64}$/.test(value.executableSha256))
      throw Error('The ' + label + ' has no complete verified execution target');
  }
  const changed = keys.filter(key => expected![key] !== actual![key]);
  if (changed.length) throw Error('Execution owner does not match the recorded release target: ' + changed.join(', ') + '. Build for this owner\'s Node image or prepare an owner transition and rollback.');
}

/** Only explicitly recorded resource settings can be inherited by a release.
 * Node preloads, loaders, arbitrary V8 options and module search paths cannot. */
export function releaseNodeOptions(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !/^--max-old-space-size=[1-9][0-9]{0,6}$/.test(value) ||
      Number(value.split('=')[1]) > 1_048_576) throw Error('Release NODE_OPTIONS permits only --max-old-space-size=<MiB> (1–1048576)');
  return value;
}

export function releaseOptionsForEnv(env?: Readonly<Record<string, unknown>>): string {
  if (env?.['NODE_PATH']) throw Error('A release cannot extend NODE_PATH');
  return releaseNodeOptions(env?.['NODE_OPTIONS']);
}

/** Self-contained: run this under the node binary of the actual execution owner. */
export async function targetRuntime(): Promise<TargetRuntime> {
  const { createHash } = await import('node:crypto');
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  for await (const part of createReadStream(process.execPath)) hash.update(part);
  const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header;
  return { platform: process.platform, arch: process.arch, node: process.version, abi: process.versions.modules,
    executableSha256: hash.digest('hex'), libc: process.platform === 'linux' ? header?.glibcVersionRuntime ?? 'non-glibc' : null };
}
