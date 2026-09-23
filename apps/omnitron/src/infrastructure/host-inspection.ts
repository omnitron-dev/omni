/**
 * What a host looks like, for the services a stack declares — read, never
 * changed.
 *
 * `provisionStack` observes, plans and APPLIES a node's host services in one
 * call; there was no way to ask for the first two alone. On the test node
 * that left one way to learn what a deployment would do to a server holding
 * a mainnet chain — which unit it would write, whether it would restart a
 * node mid-sync, what it would refuse — and the way was to deploy. Nor any
 * other way to read the host: it takes SSH by password only, and the
 * password does not leave the vault.
 *
 * Nothing here writes, and nothing returns a file's content: a config holds
 * an `rpcauth` line, a unit's command line can hold a login. What comes back
 * is the shape — present or not, matching or differing, whose, how big — and
 * the plan a deployment would carry out.
 */

import { createHash, randomBytes } from 'node:crypto';
import { Agent, request } from 'node:http';
import type { NetworkInterfaceInfo } from 'node:os';

import { bindService, secretValues, type Provisioning } from './service-binding.js';
import { selectBareMetal, planBareMetal, OMNITRON_CONFIG_MARKER, type BareMetalSpec } from './bare-metal-plan.js';
import { observeBareMetal, describe as describeAction, type HostRunner } from './bare-metal-runner.js';
import type { IServiceHealthCheck, IServiceOverride, IServiceRequirement } from './types.js';

// =============================================================================
// What is asked, and what comes back
// =============================================================================

export interface HostInspectionRequest {
  /** The services the stack declares — as a deployment would send them. */
  services: Record<string, IServiceRequirement>;
  /** The stack's overrides, their references resolved by the master. */
  overrides?: Record<string, IServiceOverride> | undefined;
  /** Units to read beyond the declared ones — one a person wrote, say. */
  units?: string[] | undefined;
  /** Paths to measure: exists, owner, size, the room on their filesystem. */
  paths?: string[] | undefined;
  /** Snap packages: installed, and which version. */
  snaps?: string[] | undefined;
  /** `key=value` files and the keys wanted from each; a key naming a credential is refused. */
  configKeys?: Array<{ path: string; keys: string[] }> | undefined;
}

export type FileState = 'absent' | 'matches' | 'differs' | 'not-managed' | 'not-declared';

export interface DiskReading {
  mount: string;
  sizeBytes: number;
  availBytes: number;
}

export interface UnitReading {
  unit: string;
  known: boolean;
  active: boolean;
  enabled: boolean;
  /**
   * systemd's own words — `active (running)`, `activating (start)`,
   * `failed (exit-code)` — where `active` above is one bit of them. The test
   * node's bitcoind read «inactive» while its chain advanced, and a bit
   * could not say which of five states it was in (2026-09-23).
   */
  state: string;
  /** `Result`: `success`, or how it last ended — `exit-code`, `timeout`, `signal`… */
  result: string;
  mainPid: number | null;
  restarts: number | null;
  /** When it last entered `active`. */
  since: string | null;
  /** Its cgroup, which every process it runs is inside. */
  cgroup: string | null;
  fragmentPath: string | null;
  /** The command line, with the value after any `password=`, `login=` or `auth=` struck out. */
  execStart: string | null;
  /** Jobs systemd has pending — this unit's, and those it waits on — as `systemctl list-jobs` prints them. */
  jobs: string[];
  /** Its last journal lines, with every credential struck out as a command line's is. */
  journal: string[];
  /** Processes running its program, and whether each is inside it. */
  processes: Array<{ pid: number; cgroup: string | null; inUnit: boolean }>;
}

export interface ProbeReading {
  method: string;
  ok: boolean;
  /** The answer's scalar fields: height, target height, synchronized, version. */
  result?: Record<string, string | number | boolean>;
  /** The fields its declaration reads the answer by (`healthCheck.jsonrpc.report`). */
  report?: string[];
  error?: string;
}

/**
 * The fields of an answer worth a line: those its declaration names, in its
 * order — or, naming none, the first dozen short ones — and how many more
 * `--json` holds.
 *
 * The first `infra inspect` of the test node printed monerod's fields as
 * they came, `adjusted_time` to `database_size`, and cut off the network,
 * height and sync state the probe had been sent for (2026-09-23).
 */
export function probeFields(reading: ProbeReading): {
  fields: Array<[string, string | number | boolean | undefined]>;
  more: number;
} {
  const result = reading.result ?? {};
  const short = (name: string) => typeof result[name] !== 'string' || String(result[name]).length <= 24;
  const names = reading.report?.length ? reading.report : Object.keys(result).filter(short).slice(0, 12);
  const shown = names.filter((name) => name in result).length;
  return { fields: names.map((name) => [name, result[name]]), more: Object.keys(result).length - shown };
}

export interface HostServiceReading {
  name: string;
  provisioning: Provisioning;
  networkMode?: string | undefined;
  /** An `external` service: its declared address, as this node sees it. */
  external?: {
    host: string;
    port: number | null;
    /** The address is one of this node's own, or loopback. */
    local: boolean;
    reachable: boolean;
    probe?: ProbeReading | undefined;
  };
  /** A `bareMetal` service: what is there, and what a deployment would do. */
  onHost?: {
    installed: boolean;
    userExists: boolean;
    dataDir: { path: string; exists: boolean; owner: string | null; disk: DiskReading | null } | null;
    /** `active` is the plan's bit — up, or on its way; `state` is systemd's words for it. */
    unit: { name: string; known: boolean; active: boolean; enabled: boolean; state: string } | null;
    config: FileState;
    unitFile: FileState;
    actions: string[];
    refusals: string[];
    /** Its declared health check, asked on loopback — where its applications reach it. */
    probe?: ProbeReading | undefined;
  };
}

export interface HostInspection {
  interfaces: Array<{ name: string; address: string; family: string; internal: boolean }>;
  /** The machine's memory as its kernel counts it; null where there is no `/proc/meminfo`. */
  memory: MemoryReading | null;
  services: HostServiceReading[];
  units: UnitReading[];
  paths: Array<{
    path: string;
    exists: boolean;
    owner: string | null;
    sizeBytes: number | null;
    disk: DiskReading | null;
  }>;
  snaps: Array<{ name: string; installed: boolean; version: string | null; revision: string | null }>;
  configKeys: Array<{ path: string; exists: boolean; values: Record<string, string | null>; refused: string[] }>;
}

export interface MemoryReading {
  totalBytes: number;
  /** `MemAvailable`: what can be taken without swapping, reclaimable cache counted in — the kernel's estimate. */
  availableBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
}

/** What the inspection needs of the machine, so a court can be one. */
export interface InspectionDeps {
  host: HostRunner;
  interfaces: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  reach: (host: string, port: number) => Promise<boolean>;
  jsonRpc: (url: string, method: string, auth: RpcAuth | null) => Promise<ProbeReading>;
}

export interface RpcAuth {
  type: 'basic' | 'digest';
  user: string;
  password: string;
}

// =============================================================================
// The inspection
// =============================================================================

export async function inspectHost(request: HostInspectionRequest, deps: InspectionDeps): Promise<HostInspection> {
  const interfaces = Object.entries(deps.interfaces()).flatMap(([name, entries]) =>
    (entries ?? []).map((i) => ({ name, address: i.address, family: String(i.family), internal: i.internal }))
  );
  const own = new Set(interfaces.map((i) => i.address));

  const services: HostServiceReading[] = [];
  for (const [name, requirement] of Object.entries(request.services)) {
    services.push(await readService(name, requirement, request.overrides?.[name], own, deps));
  }

  return {
    interfaces,
    memory: await readMemory(deps.host),
    services,
    units: await Promise.all((request.units ?? []).map((unit) => readUnit(unit, deps.host))),
    paths: await Promise.all((request.paths ?? []).map((path) => readPath(path, deps.host))),
    snaps: await Promise.all((request.snaps ?? []).map((snap) => readSnap(snap, deps.host))),
    configKeys: await Promise.all((request.configKeys ?? []).map((wanted) => readConfigKeys(wanted, deps.host))),
  };
}

/**
 * The host's memory, from `/proc/meminfo` — read, never a command run.
 *
 * Nothing said it before: bitcoind's first run on the test node logged a
 * 25.7 GB «memory peak» (2026-09-23), a figure that counts the page cache of
 * a chain it had just read, and whether the host had room left beside monerod
 * could be asked of no reading. `MemAvailable` answers that; `MemFree` does
 * not, since the kernel keeps free memory filled with reclaimable cache.
 */
async function readMemory(host: HostRunner): Promise<MemoryReading | null> {
  const content = await host.readFile('/proc/meminfo');
  if (!content) return null;
  const bytes = (key: string) => {
    const kib = new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm').exec(content)?.[1];
    return kib === undefined ? null : Number(kib) * 1024;
  };
  const total = bytes('MemTotal');
  const available = bytes('MemAvailable');
  if (total === null || available === null) return null;
  return {
    totalBytes: total,
    availableBytes: available,
    swapTotalBytes: bytes('SwapTotal') ?? 0,
    swapFreeBytes: bytes('SwapFree') ?? 0,
  };
}

async function readService(
  name: string,
  requirement: IServiceRequirement,
  override: IServiceOverride | undefined,
  own: ReadonlySet<string>,
  deps: InspectionDeps
): Promise<HostServiceReading> {
  const binding = bindService(requirement, override);
  const reading: HostServiceReading = { name, provisioning: binding.provisioning, networkMode: binding.networkMode };

  if (binding.provisioning === 'external' && binding.host) {
    const port = binding.ports['rpc'] ?? Object.values(binding.ports)[0] ?? null;
    const reachable = port === null ? false : await deps.reach(binding.host, port);
    reading.external = {
      host: binding.host,
      port,
      local: isLocal(binding.host, own),
      reachable,
      probe:
        reachable && port !== null
          ? await probe(requirement.healthCheck, requirement, binding, binding.host, port, deps)
          : undefined,
    };
    return reading;
  }

  if (binding.provisioning === 'bareMetal') {
    const spec = selectBareMetal(name, requirement, override);
    if (spec) {
      reading.onHost = await readOnHost(spec, deps.host);
      const check = spec.healthCheck ?? requirement.healthCheck;
      if (check?.type === 'jsonrpc') {
        const method = check.jsonrpc?.method ?? check.target;
        const portName = check.jsonrpc?.port ?? 'rpc';
        const port = binding.ports[portName];
        reading.onHost.probe =
          port === undefined
            ? { method, ok: false, error: `no \`${portName}\` port in this stack's network` }
            : !(await deps.reach(LOOPBACK, port))
              ? { method, ok: false, error: `nothing listens on ${LOOPBACK}:${port}` }
              : await probe(check, requirement, binding, LOOPBACK, port, deps, spec.dataDir);
      }
    }
  }
  return reading;
}

/** Where a service on the node is asked, as its applications reach it (`LOCAL_INFRA_HOST`). */
const LOOPBACK = '127.0.0.1';

async function readOnHost(spec: BareMetalSpec, host: HostRunner): Promise<NonNullable<HostServiceReading['onHost']>> {
  const observed = await observeBareMetal(spec, host);
  const plan = planBareMetal(spec, observed);
  const unitPath = spec.systemdUnit ? (spec.unitFile ?? `/etc/systemd/system/${spec.systemdUnit}.service`) : null;

  return {
    installed: observed.installed,
    userExists: observed.userExists,
    dataDir: spec.dataDir
      ? {
          path: spec.dataDir,
          exists: observed.dataDirExists,
          owner: observed.dataDirExists ? await ownerOf(spec.dataDir, host) : null,
          disk: await diskOf(spec.dataDir, host),
        }
      : null,
    unit: spec.systemdUnit
      ? {
          name: spec.systemdUnit,
          known: observed.unitKnown,
          active: observed.unitActive,
          enabled: observed.unitEnabled,
          state: await stateOf(spec.systemdUnit, host),
        }
      : null,
    config: fileState(spec.configFile ? spec.configContent : undefined, observed.configContent),
    unitFile: fileState(unitPath ? spec.unitContent : undefined, observed.unitContent ?? null),
    actions: plan.actions.map(describeAction),
    refusals: plan.refusals,
  };
}

/** How a file on the host stands against the one a deployment would write — never its content. */
export function fileState(wanted: string | undefined, current: string | null): FileState {
  if (wanted === undefined) return 'not-declared';
  if (current === null) return 'absent';
  if (!current.includes(OMNITRON_CONFIG_MARKER)) return 'not-managed';
  const normal = (text: string) => text.replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
  const marked = wanted.includes(OMNITRON_CONFIG_MARKER) ? wanted : `${OMNITRON_CONFIG_MARKER}\n${wanted}`;
  return normal(current) === normal(marked) ? 'matches' : 'differs';
}

export function isLocal(host: string, own: ReadonlySet<string>): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.') || own.has(host);
}

/**
 * A declared health check, asked of the address the stack gives, as the
 * credentials the stack gives.
 *
 * A declaration's `jsonrpc` check authenticates as its own credentials —
 * monerod's as `omni_stagenet`, the laptop's. On a stack those are the
 * stack's: each is found by the value it has in the declaration and
 * replaced with the stack's value under the same name. A `cookie` is read
 * from the service's data directory, on the node — never a reading's.
 */
async function probe(
  check: IServiceHealthCheck | undefined,
  requirement: IServiceRequirement,
  binding: ReturnType<typeof bindService>,
  host: string,
  port: number,
  deps: InspectionDeps,
  dataDir?: string | undefined
): Promise<ProbeReading | undefined> {
  if (check?.type !== 'jsonrpc') return undefined;
  const method = check.jsonrpc?.method ?? check.target;
  const path = check.jsonrpc?.path ?? '/json_rpc';
  const declared = check.jsonrpc?.auth;

  let auth: RpcAuth | null = null;
  if (declared?.type === 'cookie') {
    const cookie = await readCookie(declared.file, dataDir, deps.host);
    if ('error' in cookie) return { method, ok: false, error: cookie.error };
    auth = { type: 'basic', ...cookie };
  } else if (declared) {
    const values = secretValues(binding);
    const stackValue = (literal: string) => {
      const key = Object.entries(requirement.secrets ?? {}).find(([, v]) => v === literal)?.[0];
      return key !== undefined ? values[key] : undefined;
    };
    const user = stackValue(declared.user);
    const password = stackValue(declared.password);
    if (user === undefined || password === undefined) {
      return { method, ok: false, error: "the stack gives no credentials for this service's health check" };
    }
    auth = { type: declared.type === 'digest' ? 'digest' : 'basic', user, password };
  }
  const where = host.includes(':') ? `[${host}]` : host;
  const reading = await deps.jsonRpc(`http://${where}:${port}${path}`, method, auth);
  const report = check.jsonrpc?.report;
  return report?.length ? { ...reading, report } : reading;
}

// =============================================================================
// Host facts
// =============================================================================

const CREDENTIAL = /pass|auth|secret|login|token|key/i;

/** systemd's words for where a unit is: `active (running)`, `activating (start)`… */
async function stateOf(unit: string, host: HostRunner): Promise<string> {
  const shown = await host.run(['systemctl', 'show', unit, '-p', 'ActiveState', '-p', 'SubState']);
  const read = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(shown.stdout)?.[1]?.trim() ?? '';
  return `${read('ActiveState') || 'unknown'} (${read('SubState') || '?'})`;
}

const UNIT_PROPERTIES = [
  'LoadState',
  'ActiveState',
  'SubState',
  'Result',
  'UnitFileState',
  'FragmentPath',
  'ExecStart',
  'MainPID',
  'NRestarts',
  'ActiveEnterTimestamp',
  'ControlGroup',
];

async function readUnit(unit: string, host: HostRunner): Promise<UnitReading> {
  const shown = await host.run(['systemctl', 'show', unit, ...UNIT_PROPERTIES.flatMap((p) => ['-p', p])]);
  const read = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(shown.stdout)?.[1]?.trim() ?? '';
  const count = (key: string) => (/^\d+$/.test(read(key)) ? Number(read(key)) : null);
  const argv = /argv\[\]=([^;]*)/.exec(read('ExecStart'))?.[1]?.trim() ?? '';
  const cgroup = read('ControlGroup') || null;

  const [jobs, journal, processes] = await Promise.all([
    host.run(['systemctl', 'list-jobs', '--no-legend', '--no-pager']).then((r) => lines(r.stdout).slice(0, 20)),
    host
      .run(['journalctl', '-u', unit, '-n', '30', '--no-pager', '-o', 'short-iso'])
      .then((r) => lines(r.stdout).map((line) => redactArgv(line).slice(0, 300))),
    argv ? processesOf(argv.split(/\s+/)[0]!, cgroup, host) : Promise.resolve([]),
  ]);

  return {
    unit,
    known: read('LoadState') === 'loaded',
    active: read('ActiveState') === 'active',
    enabled: ['enabled', 'enabled-runtime', 'static', 'indirect'].includes(read('UnitFileState')),
    state: `${read('ActiveState') || 'unknown'} (${read('SubState') || '?'})`,
    result: read('Result'),
    mainPid: count('MainPID') || null,
    restarts: count('NRestarts'),
    since: read('ActiveEnterTimestamp') || null,
    cgroup,
    fragmentPath: read('FragmentPath') || null,
    execStart: argv ? redactArgv(argv) : null,
    jobs,
    journal,
    processes,
  };
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * The processes running a unit's program, each placed by its cgroup: one
 * outside the unit is not the unit's, whatever systemd says of the unit.
 * Only `/proc/<pid>/cgroup` is read — never a command line, which may hold
 * a credential.
 */
async function processesOf(
  program: string,
  unitCgroup: string | null,
  host: HostRunner
): Promise<UnitReading['processes']> {
  const name = program.slice(program.lastIndexOf('/') + 1).slice(0, 15);
  const found = await host.run(['pgrep', '-x', name]);
  const pids = lines(found.stdout)
    .filter((pid) => /^\d+$/.test(pid))
    .slice(0, 10)
    .map(Number);
  return Promise.all(
    pids.map(async (pid) => {
      const content = (await host.readFile(`/proc/${pid}/cgroup`)) ?? '';
      // cgroup v2 is one `0::<path>` line; v1 names systemd's hierarchy.
      const cgroup = /^0::(.*)$/m.exec(content)?.[1] ?? /name=systemd:(.*)$/m.exec(content)?.[1] ?? null;
      const inUnit =
        cgroup !== null && unitCgroup !== null && (cgroup === unitCgroup || cgroup.startsWith(`${unitCgroup}/`));
      return { pid, cgroup, inUnit };
    })
  );
}

/**
 * A command line with every credential struck out and every flag kept.
 *
 * Two forms: `-rpcpassword=x` and `--rpc-login user:password` — the value
 * after a space. Only the first was struck out, and the test node's
 * monero-walletd unit passes both of its logins the second way: the first
 * `infra inspect` of it printed a mainnet RPC password in the clear
 * (2026-09-23).
 */
export function redactArgv(argv: string): string {
  const words = argv.split(/\s+/);
  return words
    .map((word, i) => {
      const eq = word.indexOf('=');
      if (eq > 0) return CREDENTIAL.test(word.slice(0, eq)) ? `${word.slice(0, eq)}=…` : word;
      const flag = words[i - 1];
      const valueOfACredentialFlag =
        flag !== undefined &&
        flag.startsWith('-') &&
        !flag.includes('=') &&
        CREDENTIAL.test(flag) &&
        !word.startsWith('-');
      return valueOfACredentialFlag ? '…' : word;
    })
    .join(' ');
}

async function readPath(path: string, host: HostRunner): Promise<HostInspection['paths'][number]> {
  const exists = await host.exists(path);
  if (!exists) return { path, exists, owner: null, sizeBytes: null, disk: await diskOf(path, host) };
  const du = await host.run(['du', '-sb', path], { timeoutMs: 300_000 });
  const size = du.ok ? Number(du.stdout.split(/\s+/)[0]) : NaN;
  return {
    path,
    exists,
    owner: await ownerOf(path, host),
    sizeBytes: Number.isFinite(size) ? size : null,
    disk: await diskOf(path, host),
  };
}

async function ownerOf(path: string, host: HostRunner): Promise<string | null> {
  const stat = await host.run(['stat', '-c', '%U:%G', path]);
  return stat.ok ? stat.stdout.trim() : null;
}

/** The filesystem a path is on — or would be, measured at its nearest existing ancestor. */
async function diskOf(path: string, host: HostRunner): Promise<DiskReading | null> {
  let at = path;
  while (at !== '/' && !(await host.exists(at))) at = at.replace(/\/[^/]*\/?$/, '') || '/';
  const df = await host.run(['df', '-B1', '--output=target,size,avail', at]);
  const row = df.ok ? df.stdout.trim().split('\n')[1]?.trim().split(/\s+/) : undefined;
  if (!row || row.length < 3) return null;
  return { mount: row[0]!, sizeBytes: Number(row[1]), availBytes: Number(row[2]) };
}

async function readSnap(name: string, host: HostRunner): Promise<HostInspection['snaps'][number]> {
  const listed = await host.run(['snap', 'list', name]);
  const row = listed.ok ? listed.stdout.trim().split('\n')[1]?.trim().split(/\s+/) : undefined;
  return row && row[0] === name
    ? { name, installed: true, version: row[1] ?? null, revision: row[2] ?? null }
    : { name, installed: false, version: null, revision: null };
}

async function readConfigKeys(
  wanted: { path: string; keys: string[] },
  host: HostRunner
): Promise<HostInspection['configKeys'][number]> {
  const refused = wanted.keys.filter((key) => CREDENTIAL.test(key));
  const content = await host.readFile(wanted.path);
  const values: Record<string, string | null> = {};
  for (const key of wanted.keys.filter((k) => !refused.includes(k))) {
    // The last assignment wins, as bitcoind and monerod read their files.
    const matches = [...(content ?? '').matchAll(new RegExp(`^\\s*${escape(key)}\\s*=\\s*(.*?)\\s*$`, 'gm'))];
    values[key] = matches.at(-1)?.[1] ?? null;
  }
  return { path: wanted.path, exists: content !== null, values, refused };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// =============================================================================
// The machine, for a daemon
// =============================================================================

/** TCP, with a deadline: an address that answers nothing is not reachable. */
export async function reachTcp(host: string, port: number, timeoutMs = 3_000): Promise<boolean> {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * One JSON-RPC 2.0 call, over HTTP basic or digest authentication.
 *
 * Digest because monerod speaks nothing else, and implemented here rather
 * than by running `curl --digest -u user:password`: a password on a command
 * line is in the node's process table for as long as the call takes.
 *
 * The answer goes on the connection the challenge came on: monerod keeps a
 * nonce per connection, and `fetch` sent the two requests on two — the first
 * `infra inspect` of the test node read HTTP 401 from its daemon and its
 * wallet (2026-09-23). Measured against the dev stack's monerod and
 * wallet-rpc, the same answer is 200 on the challenge's socket, 401 on
 * another.
 */
export async function jsonRpcCall(
  url: string,
  method: string,
  auth: RpcAuth | null,
  timeoutMs = 10_000
): Promise<ProbeReading> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'inspect', method });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth?.type === 'basic') {
    headers['authorization'] = `Basic ${Buffer.from(`${auth.user}:${auth.password}`).toString('base64')}`;
  }
  const connection = new Agent({ keepAlive: true, maxSockets: 1 });
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    let response = await post(url, headers, body, connection, signal);
    if (response.status === 401 && auth?.type === 'digest') {
      if (!response.challenge) return { method, ok: false, error: 'HTTP 401 with no challenge' };
      headers['authorization'] = digestAuthorization(response.challenge, auth, 'POST', new URL(url).pathname);
      response = await post(url, headers, body, connection, signal);
    }
    if (response.status !== 200) return { method, ok: false, error: `HTTP ${response.status}` };
    const answer = JSON.parse(response.text) as { result?: unknown; error?: { message?: string } };
    if (answer.error) return { method, ok: false, error: answer.error.message ?? 'error' };
    return { method, ok: true, result: scalars(answer.result) };
  } catch (err) {
    return { method, ok: false, error: signal.aborted ? `no answer in ${timeoutMs} ms` : (err as Error).message };
  } finally {
    connection.destroy();
  }
}

function post(
  url: string,
  headers: Record<string, string>,
  body: string,
  agent: Agent,
  signal: AbortSignal
): Promise<{ status: number; challenge: string | undefined; text: string }> {
  return new Promise((resolve, reject) => {
    const sent = request(
      url,
      { method: 'POST', agent, signal, headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            challenge: response.headers['www-authenticate'],
            text: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    sent.on('error', reject);
    sent.end(body);
  });
}

/** RFC 7616 with MD5 or MD5-sess and `qop=auth` — what monerod offers. */
export function digestAuthorization(
  challenge: string,
  auth: RpcAuth,
  httpMethod: string,
  uri: string,
  cnonce = randomBytes(8).toString('hex')
): string {
  const field = (name: string) => new RegExp(`${name}="?([^",]+)"?`, 'i').exec(challenge)?.[1];
  const realm = field('realm') ?? '';
  const nonce = field('nonce') ?? '';
  const algorithm = (field('algorithm') ?? 'MD5').toUpperCase();
  const qop = field('qop')
    ?.split(/\s*,\s*/)
    .includes('auth')
    ? 'auth'
    : undefined;
  const md5 = (text: string) => createHash('md5').update(text).digest('hex');
  const nc = '00000001';

  let ha1 = md5(`${auth.user}:${realm}:${auth.password}`);
  if (algorithm === 'MD5-SESS') ha1 = md5(`${ha1}:${nonce}:${cnonce}`);
  const ha2 = md5(`${httpMethod}:${uri}`);
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);

  return [
    `Digest username="${auth.user}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `algorithm=${algorithm === 'MD5-SESS' ? 'MD5-sess' : 'MD5'}`,
    ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`] : []),
    `response="${response}"`,
  ].join(', ');
}

/**
 * A daemon's cookie, `user:secret`, from inside its data directory. Used for
 * one call to loopback on the node it was read on.
 */
async function readCookie(
  file: string,
  dataDir: string | undefined,
  host: HostRunner
): Promise<{ user: string; password: string } | { error: string }> {
  if (!dataDir) return { error: 'a cookie is read from the data directory, and the service on the node declares none' };
  if (file.startsWith('/') || file.split('/').includes('..')) {
    return { error: `a cookie is named inside the data directory, and \`${file}\` is not` };
  }
  const path = `${dataDir.replace(/\/+$/, '')}/${file}`;
  const content = (await host.readFile(path))?.trim();
  if (!content) return { error: `no ${path} — the daemon writes it while it runs` };
  const colon = content.indexOf(':');
  if (colon <= 0) return { error: `${path} holds no \`user:secret\`` };
  return { user: content.slice(0, colon), password: content.slice(colon + 1) };
}

function scalars(result: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!result || typeof result !== 'object') return out;
  for (const [key, value] of Object.entries(result as Record<string, unknown>).slice(0, 60)) {
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && value.length <= 80) out[key] = value;
  }
  return out;
}
