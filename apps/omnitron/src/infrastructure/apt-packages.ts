import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AptPackageReading } from '../shared/dto/host-inspection.js';
import type { HostRunner } from './bare-metal-runner.js';
import type { AptPackagePolicy } from './types.js';

type Host = Pick<HostRunner, 'run' | 'readFile'>;
const packageName = /^[a-z0-9][a-z0-9+.-]+$/;
const version = /^[0-9][0-9A-Za-z.+:~_-]*$/;
const cLocale = ['env', 'LC_ALL=C'];
const installOptions = ['--no-remove', '--no-install-recommends', '-o', 'APT::Get::AllowUnauthenticated=false'];

function diagnostic(line: string): string {
  return (line.trim().split('\n')[0] ?? '')
    .replace(/\w+:\/\/\S+/g, (value) => {
      try {
        return new URL(value).origin;
      } catch {
        return '[repository]';
      }
    })
    .slice(0, 300);
}

function validate(policy: AptPackagePolicy): string | undefined {
  if (
    !Array.isArray(policy?.latest) ||
    !policy.latest.length ||
    policy.latest.length > 100 ||
    policy.latest.some((name) => typeof name !== 'string' || !packageName.test(name)) ||
    new Set(policy.latest).size !== policy.latest.length
  )
    return 'APT latest requires 1–100 distinct Debian package names.';
  if (policy.repository !== undefined) {
    try {
      const url = new URL(policy.repository);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^https:\/\/[^\s?#]+$/.test(policy.repository)
      )
        throw new Error();
    } catch {
      return 'APT repository must be an HTTPS base URL without credentials, query or fragment.';
    }
  }
  return undefined;
}

function blocked(
  name: string,
  detail: string,
  installed: string | null = null,
  candidate: string | null = null
): AptPackageReading {
  return { name, installed, candidate, state: 'blocked', detail };
}

/** Reads the installed package database and local repository indices. Never downloads or installs. */
export async function inspectAptPackages(
  policy: AptPackagePolicy,
  host: Host,
  aptOptions: readonly string[] = []
): Promise<AptPackageReading[]> {
  const error = validate(policy);
  if (error) return [blocked('APT', error)];
  const names = policy.latest;
  const [selection, available, holds, os] = await Promise.all([
    host.run([...cLocale, 'apt-cache', ...aptOptions, 'policy', '--', ...names]),
    host.run([...cLocale, 'apt-cache', ...aptOptions, 'madison', '--', ...names]),
    host.run([...cLocale, 'apt-mark', ...aptOptions, 'showhold', '--', ...names]),
    policy.repository ? host.readFile('/etc/os-release').catch(() => null) : null,
  ]);
  const failed = [selection, available, holds].find((result) => !result.ok);
  if (failed) return names.map((name) => blocked(name, 'Cannot read APT package state: ' + diagnostic(failed.stderr)));
  const codename = os?.match(/^VERSION_CODENAME=["']?([a-z0-9-]+)["']?$/m)?.[1];
  const repository = policy.repository?.replace(/\/+$/, '');
  const channel = repository ? repository + ' ' + (codename ?? '?') + '/main' : undefined;
  const held = new Set(holds.stdout.trim().split(/\s+/));
  const selections = new Map<string, { installed: string | null; candidate: string | null }>();
  for (const block of selection.stdout.split(/^(?=\S)/m)) {
    const name = block.match(/^([a-z0-9+.-]+):\n/)?.[1];
    if (!name) continue;
    const field = (key: string) => {
      const value = block.match(new RegExp('^\\s*' + key + ':\\s*(\\S+)', 'm'))?.[1];
      return value && version.test(value) ? value : null;
    };
    selections.set(name, { installed: field('Installed'), candidate: field('Candidate') });
  }
  const listings = available.stdout.split('\n').map((line) => line.trim().split(/\s*\|\s*/));
  return Promise.all(
    names.map(async (name) => {
      const { installed, candidate } = selections.get(name) ?? { installed: null, candidate: null };
      const refuse = (reason: string) => blocked(name, reason, installed, candidate);
      if (repository && !codename) return refuse('Cannot determine the host release from /etc/os-release.');
      const sources = listings.filter(([pkg, , source]) => {
        if (pkg !== name || !source) return false;
        const [uri, suite] = source.split(/\s+/);
        return !repository || (uri?.replace(/\/+$/, '') === repository && suite === codename + '/main');
      });
      if (!candidate || !sources.some(([, v]) => v === candidate)) {
        return refuse(
          'No indexed APT candidate from ' +
            (channel ?? 'the configured repositories') +
            '. Check the signed source, refresh its index and review APT pins.'
        );
      }
      if (repository) {
        const versions = new Set(sources.map(([, v]) => v).filter((v): v is string => Boolean(v && v !== candidate)));
        for (const other of versions) {
          if (!version.test(other) || !(await host.run(['dpkg', '--compare-versions', other, 'le', candidate])).ok) {
            return refuse(
              'APT selection does not track the newest indexed version from ' + channel + '. Review APT pins.'
            );
          }
        }
      }
      const origin = channel ?? diagnostic(sources.find(([, v]) => v === candidate)![2]!);
      if (installed) {
        const state = await host.run([...cLocale, 'dpkg-query', '-W', '-f=${db:Status-Status}', '--', name]);
        if (!state.ok || state.stdout.trim() !== 'installed')
          return refuse('dpkg has not finished configuring this package.');
      }
      if (held.has(name)) return refuse('Package is held; release the hold explicitly to track the latest version.');
      if (installed === candidate) return { name, installed, candidate, state: 'current', detail: origin };
      if (installed && !(await host.run(['dpkg', '--compare-versions', installed, 'lt', candidate])).ok) {
        return refuse('The selected version would downgrade the installed package.');
      }
      return { name, installed, candidate, state: installed ? 'upgrade' : 'install', detail: origin };
    })
  );
}

export type AptPackageReader = (policy: AptPackagePolicy) => Promise<AptPackageReading[]>;

// Per-source settings take precedence over APT's Acquire defaults. A successful
// update with Trusted=yes can even omit a Release file. Preserve the host's
// sources and Signed-By restrictions, and reject exceptions in active entries.
function weakSource(options: string): boolean {
  const fields = options.matchAll(
    /(?:^|\s)(trusted|allow-(?:insecure|weak|downgrade-to-insecure)|check-(?:date|valid-until)|valid-until-min)\s*[:=][ \t]*(\S*)/gi
  );
  for (const [, key, raw] of fields) {
    const value = raw!.replace(/^["']|["']$/g, '').toLowerCase();
    if (key!.toLowerCase() === 'valid-until-min') {
      if (value !== '0') return true;
    } else if (
      key!.toLowerCase().startsWith('check-')
        ? !['yes', 'true', 'on', '1'].includes(value)
        : !['no', 'false', 'off', '0'].includes(value)
    ) {
      return true;
    }
  }
  return false;
}

async function privateAptSources(host: Host, directory: string): Promise<string[]> {
  const found = await host.run([
    ...cLocale,
    'apt-config',
    'shell',
    'MAIN',
    'Dir::Etc::sourcelist/f',
    'PARTS',
    'Dir::Etc::sourceparts/d',
  ]);
  const main = found.stdout.match(/^MAIN='(\/[^'\r\n]*)'$/m)?.[1];
  const parts = found.stdout.match(/^PARTS='(\/[^'\r\n]*)'$/m)?.[1];
  if (!found.ok || !main || !parts) throw Error('Cannot resolve the configured APT sources.');
  const sources = join(directory, 'sources.list.d');
  const source = join(directory, main.endsWith('.sources') ? 'main.sources' : 'main.list');
  await mkdir(sources, { mode: 0o700 });
  async function copy(from: string, to: string) {
    const content = await host.readFile(from);
    if (content === null) return;
    const lines = content.replace(/^[ \t]*#[^\n]*\n?/gm, '');
    const unsafe = from.endsWith('.sources')
      ? lines.split(/\r?\n[ \t]*\r?\n/).some((stanza) => {
          const fields = stanza.replace(/\r?\n[ \t]+/g, ' ');
          return !/^Enabled:\s*(?:no|false|off|0)\s*$/im.test(fields) && weakSource(fields);
        })
      : lines
          .split('\n')
          .some((line) => weakSource((line.match(/^\s*deb(?:-src)?\s+\[([^\]]+)\]/)?.[1] ?? '').replace(/["']/g, '')));
    if (unsafe) throw Error('Cannot refresh APT indices: a configured source disables signature or validity checks.');
    await writeFile(to, content, { flag: 'wx', mode: 0o600 });
  }
  await copy(main, source);
  let names: string[];
  try {
    names = await readdir(parts);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    names = [];
  }
  for (const name of names.filter((entry) => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(list|sources)$/.test(entry))) {
    await copy(join(parts, name), join(sources, name));
  }
  return ['-o', 'Dir::Etc::sourcelist=' + source, '-o', 'Dir::Etc::sourceparts=' + sources];
}

/** One successful refresh per reconciliation. Inspection outside this scope remains read-only. */
export async function withFreshAptPackages<T>(
  host: Host,
  reconcile: (read: AptPackageReader) => Promise<T>
): Promise<T> {
  let directory: string | undefined;
  let refresh: Promise<string[]> | undefined;
  async function update(): Promise<string[]> {
    const identity = await host.run(['id', '-u']);
    if (!identity.ok || !/^\d+$/.test(identity.stdout.trim())) throw Error('Cannot determine APT provisioning UID.');
    const options: string[] = [];
    if (identity.stdout.trim() !== '0') {
      directory = await mkdtemp(join(tmpdir(), 'omnitron-apt-'));
      const lists = join(directory, 'lists');
      await mkdir(join(lists, 'partial'), { recursive: true, mode: 0o700 });
      const config = join(directory, 'apt.conf');
      // System update hooks may change shared caches. A private refresh needs only APT's signed indices.
      await writeFile(
        config,
        [
          '#clear APT::Update::Pre-Invoke;',
          '#clear APT::Update::Post-Invoke;',
          '#clear APT::Update::Post-Invoke-Success;',
          'Dir::Cache::pkgcache "";',
          'Dir::Cache::srcpkgcache "";',
          'Acquire::Languages "none";',
          'Acquire::AllowInsecureRepositories "false";',
          'Acquire::AllowWeakRepositories "false";',
          'Acquire::AllowDowngradeToInsecureRepositories "false";',
          '#clear Acquire::Min-ValidTime;',
          'Acquire::Min-ValidTime "0";',
          'Acquire::Check-Date "true";',
          'Acquire::Check-Valid-Until "true";',
        ].join('\n'),
        { flag: 'wx', mode: 0o600 }
      );
      options.push('-c', config, '-o', 'Dir::State::lists=' + lists, ...(await privateAptSources(host, directory)));
    }
    const result = await host.run([...cLocale, 'apt-get', ...options, '--error-on=any', 'update'], {
      timeoutMs: 120_000,
    });
    if (!result.ok) throw Error('Cannot refresh APT indices: ' + diagnostic(result.stderr));
    return options;
  }

  try {
    return await reconcile(async (policy) => {
      const invalid = validate(policy);
      if (invalid) return [blocked('APT', invalid)];
      const options = await (refresh ??= update());
      const readings = await inspectAptPackages(policy, host, options);
      return readings.map((p) =>
        options.length && (p.state === 'install' || p.state === 'upgrade')
          ? blocked(
              p.name,
              `Have the host administrator install ${p.name}=${p.candidate} from ${p.detail}, then retry provisioning.`,
              p.installed,
              p.candidate
            )
          : p
      );
    });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export type AptChange = { name: string; installed: string | null; candidate: string };

export interface AptDependency {
  name: string;
  version: string;
}
export interface AptTransaction {
  dependencies: AptDependency[];
  error?: string;
}

const aptTargets = (changes: readonly AptChange[]) => [
  'install',
  '--',
  ...changes.map((p) => p.name + '=' + p.candidate),
];

export function aptChanges(packages: readonly AptPackageReading[]): AptChange[] {
  return packages.flatMap((p) =>
    (p.state === 'install' || p.state === 'upgrade') && p.candidate
      ? [{ name: p.name, installed: p.installed, candidate: p.candidate }]
      : []
  );
}

/** Preview APT's native solver. A new dependency is admissible; changing an unrelated installed package is not. */
export async function previewAptTransaction(changes: readonly AptChange[], host: Host): Promise<AptTransaction> {
  const refuse = (error: string): AptTransaction => ({ dependencies: [], error });
  const simulated = await host.run([...cLocale, 'apt-get', '--simulate', ...installOptions, ...aptTargets(changes)]);
  if (!simulated.ok) return refuse('APT simulation failed: ' + diagnostic(simulated.stderr));
  const targets = new Map(changes.map((p) => [p.name, p.candidate]));
  const installing = new Map<string, string>();
  const configuring = new Map<string, string>();
  const dependencies: AptDependency[] = [];
  for (const line of simulated.stdout.split('\n')) {
    if (/^(Remv|Purg) /.test(line)) return refuse('APT would remove packages.');
    if (!/^(Inst|Conf) /.test(line)) continue;
    const match = line.match(/^(Inst|Conf) ([a-z0-9][a-z0-9+.-]*(?::[a-z0-9-]+)?)(?: \[([^\]]+)\])? \((\S+?)(?:\s|\))/);
    if (!match) return refuse('Cannot interpret the APT transaction.');
    const [, operation, name, installed, selected] = match;
    if (!name || !selected || !version.test(selected))
      return refuse('Invalid APT package or version in the transaction.');
    if (operation === 'Conf') {
      configuring.set(name, selected);
      continue;
    }
    if (targets.has(name) ? targets.get(name) !== selected : installed !== undefined) {
      return refuse('Unplanned APT change: ' + name + ' ' + (installed ?? 'absent') + ' → ' + selected);
    }
    installing.set(name, selected);
    if (!targets.has(name)) dependencies.push({ name, version: selected });
  }
  for (const [name, selected] of [...targets, ...configuring]) {
    if (installing.get(name) !== selected)
      return refuse('APT did not resolve the planned installation of ' + name + '.');
  }
  return { dependencies: dependencies.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Revalidate the preview immediately before installing its exact package versions. */
export async function installAptPackages(
  changes: readonly AptChange[],
  policy: AptPackagePolicy,
  host: Host,
  dependencies: readonly AptDependency[] = []
): Promise<void> {
  const readings = await inspectAptPackages(policy, host);
  const refused = readings.find((p) => p.state === 'blocked');
  if (refused) throw new Error(refused.name + ': ' + refused.detail);
  const expected = new Map(changes.map((p) => [p.name, p]));
  const pending: AptChange[] = [];
  for (const reading of readings) {
    const planned = expected.get(reading.name);
    if (reading.state === 'current' && (!planned || reading.installed === planned.candidate)) continue;
    if (!planned || reading.installed !== planned.installed || reading.candidate !== planned.candidate) {
      throw new Error('APT selection changed for ' + reading.name + '; inspect the host again.');
    }
    pending.push(planned);
  }
  if (!pending.length) return;
  if (policy.repository) {
    const base = policy.repository.replace(/\/+$/, '') + '/';
    for (const p of pending) {
      const download = await host.run([
        ...cLocale,
        'apt-get',
        '--print-uris',
        'download',
        '--',
        p.name + '=' + p.candidate,
      ]);
      const uri = download.stdout.match(/^'([^']+)' /m)?.[1];
      if (!download.ok || !uri?.startsWith(base))
        throw new Error('APT would fetch ' + p.name + ' outside its declared repository.');
    }
  }
  const preview = await previewAptTransaction(pending, host);
  if (preview.error) throw new Error(preview.error);
  if (
    dependencies.length !== preview.dependencies.length ||
    dependencies.some(
      (p, i) => p.name !== preview.dependencies[i]?.name || p.version !== preview.dependencies[i]?.version
    )
  ) {
    throw new Error('APT dependency selection changed; inspect the host again.');
  }
  const args = aptTargets(pending);
  const result = await host.run(
    [
      ...cLocale,
      'DEBIAN_FRONTEND=noninteractive',
      'NEEDRESTART_MODE=l',
      'apt-get',
      '-y',
      ...installOptions,
      '-o',
      'DPkg::Lock::Timeout=30',
      '-o',
      'Dpkg::Options::=--force-confold',
      ...args,
    ],
    { timeoutMs: 20 * 60_000 }
  );
  if (!result.ok) throw new Error('APT install failed: ' + diagnostic(result.stderr));
  const verified = await inspectAptPackages(policy, host);
  const mismatch = verified.find(
    (p) => p.state !== 'current' || (expected.has(p.name) && p.installed !== expected.get(p.name)!.candidate)
  );
  if (mismatch) throw new Error('APT did not confirm ' + mismatch.name + ': ' + mismatch.detail);
}
