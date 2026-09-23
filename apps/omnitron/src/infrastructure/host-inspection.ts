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
import type { NetworkInterfaceInfo } from 'node:os';

import { bindService, secretValues, type Provisioning } from './service-binding.js';
import { selectBareMetal, planBareMetal, OMNITRON_CONFIG_MARKER, type BareMetalSpec } from './bare-metal-plan.js';
import { observeBareMetal, describe as describeAction, type HostRunner } from './bare-metal-runner.js';
import type { IServiceOverride, IServiceRequirement } from './types.js';

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
  fragmentPath: string | null;
  /** The command line, with the value after any `password=`, `login=` or `auth=` struck out. */
  execStart: string | null;
}

export interface ProbeReading {
  method: string;
  ok: boolean;
  /** The answer's scalar fields: height, target height, synchronized, version. */
  result?: Record<string, string | number | boolean>;
  error?: string;
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
    unit: { name: string; known: boolean; active: boolean; enabled: boolean } | null;
    config: FileState;
    unitFile: FileState;
    actions: string[];
    refusals: string[];
  };
}

export interface HostInspection {
  interfaces: Array<{ name: string; address: string; family: string; internal: boolean }>;
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
    services,
    units: await Promise.all((request.units ?? []).map((unit) => readUnit(unit, deps.host))),
    paths: await Promise.all((request.paths ?? []).map((path) => readPath(path, deps.host))),
    snaps: await Promise.all((request.snaps ?? []).map((snap) => readSnap(snap, deps.host))),
    configKeys: await Promise.all((request.configKeys ?? []).map((wanted) => readConfigKeys(wanted, deps.host))),
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
      probe: reachable && port !== null ? await probe(requirement, binding, binding.host, port, deps) : undefined,
    };
    return reading;
  }

  if (binding.provisioning === 'bareMetal') {
    const spec = selectBareMetal(name, requirement, override);
    if (spec) reading.onHost = await readOnHost(spec, deps.host);
  }
  return reading;
}

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
 * The service's own declared health check, asked of the address the stack
 * gives, as the credentials the stack gives.
 *
 * A declaration's `jsonrpc` check authenticates as its own credentials —
 * monerod's as `omni_stagenet`, the laptop's. On a stack those are the
 * stack's: each is found by the value it has in the declaration and
 * replaced with the stack's value under the same name.
 */
async function probe(
  requirement: IServiceRequirement,
  binding: ReturnType<typeof bindService>,
  host: string,
  port: number,
  deps: InspectionDeps
): Promise<ProbeReading | undefined> {
  const check = requirement.healthCheck;
  if (check?.type !== 'jsonrpc') return undefined;
  const method = check.jsonrpc?.method ?? check.target;
  const path = check.jsonrpc?.path ?? '/json_rpc';
  const declared = check.jsonrpc?.auth;

  let auth: RpcAuth | null = null;
  if (declared) {
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
  return deps.jsonRpc(`http://${where}:${port}${path}`, method, auth);
}

// =============================================================================
// Host facts
// =============================================================================

const CREDENTIAL = /pass|auth|secret|login|token|key/i;

async function readUnit(unit: string, host: HostRunner): Promise<UnitReading> {
  const shown = await host.run([
    'systemctl',
    'show',
    unit,
    '-p',
    'LoadState',
    '-p',
    'ActiveState',
    '-p',
    'UnitFileState',
    '-p',
    'FragmentPath',
    '-p',
    'ExecStart',
  ]);
  const read = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(shown.stdout)?.[1]?.trim() ?? '';
  const argv = /argv\[\]=([^;]*)/.exec(read('ExecStart'))?.[1]?.trim() ?? '';
  return {
    unit,
    known: read('LoadState') === 'loaded',
    active: read('ActiveState') === 'active',
    enabled: ['enabled', 'enabled-runtime', 'static', 'indirect'].includes(read('UnitFileState')),
    fragmentPath: read('FragmentPath') || null,
    execStart: argv ? redactArgv(argv) : null,
  };
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
  try {
    let response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 401 && auth?.type === 'digest') {
      const challenge = response.headers.get('www-authenticate');
      if (!challenge) return { method, ok: false, error: 'HTTP 401 with no challenge' };
      headers['authorization'] = digestAuthorization(challenge, auth, 'POST', new URL(url).pathname);
      response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
    }
    if (!response.ok) return { method, ok: false, error: `HTTP ${response.status}` };
    const answer = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (answer.error) return { method, ok: false, error: answer.error.message ?? 'error' };
    return { method, ok: true, result: scalars(answer.result) };
  } catch (err) {
    return { method, ok: false, error: (err as Error).message };
  }
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

function scalars(result: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!result || typeof result !== 'object') return out;
  for (const [key, value] of Object.entries(result as Record<string, unknown>).slice(0, 60)) {
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && value.length <= 80) out[key] = value;
  }
  return out;
}
