import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { HOST_BINDING_NAMES, HOST_BINDING_PROFILES, hostBindingDigest, type HostBindingProfile, type HostBindingReview } from './host-binding-review.js';

export type HostConfigGrant = { ticket: string; nodeId: string; review: string };
export type HostConfigInstallRequest = HostConfigGrant & { project: string; stack: string; release: string; prepared: string };
export type HostConfigReceipt = HostConfigGrant & { protocol: 1; files: Array<{ profile: HostBindingProfile; receipt: string }> };
export type HostConfigHello = { grant: HostConfigGrant; review: HostBindingReview; templates: Record<string, string> };
export const hostConfigAuthenticationFailure = 'The registered administrative SSH route could not authenticate the connection';
export const hostConfigForwardFailure = 'The registered administrative SSH route cannot reach the authorized host configuration listener';
export function hostConfigCommandFailure(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : '';
  if (message === hostConfigAuthenticationFailure)
    return 'Administrative SSH authentication or host key verification failed before service vault access.';
  if (message === hostConfigForwardFailure)
    return 'The registered SSH route could not open the authorized ticket socket before service vault access. Verify the recipient listener and effective forwarding permissions.';
  return 'Host configuration installation is unconfirmed. Inspect the original ticket before retrying.';
}
const digest = /^[a-f0-9]{64}$/;
const label = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export function required(v: unknown): asserts v {
  if (!v) throw Error('Host configuration installation evidence is unavailable or differs from the authorization');
}
export function fields(v: unknown, keys: readonly string[]): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
}
export function checkGrant(grant: HostConfigGrant) {
  required(fields(grant, ['ticket', 'nodeId', 'review']) && typeof grant.ticket === 'string' && uuid.test(grant.ticket) &&
    typeof grant.nodeId === 'string' && label.test(grant.nodeId) && typeof grant.review === 'string' && digest.test(grant.review));
}
export function checkRequest(request: HostConfigInstallRequest) {
  required(fields(request, ['project', 'stack', 'release', 'prepared', 'nodeId', 'ticket', 'review']) &&
    [request.project, request.stack, request.release].every(value => typeof value === 'string' && label.test(value)) &&
    typeof request.prepared === 'string' && digest.test(request.prepared));
  checkGrant({ ticket: request.ticket, nodeId: request.nodeId, review: request.review });
}
export const socketPath = (ticket: string) => {
  required(uuid.test(ticket));
  return '/run/omnitron-host-config/' + ticket + '.sock';
};
export function sameGrant(a: HostConfigGrant, b: HostConfigGrant) {
  return a?.ticket === b.ticket && a.nodeId === b.nodeId && a.review === b.review;
}
export function checkHello(hello: HostConfigHello, grant: HostConfigGrant) {
  required(fields(hello, ['grant', 'review', 'templates']) && sameGrant(hello.grant, grant));
  const r = hello.review;
  required(fields(r, ['protocol', 'project', 'stack', 'release', 'commit', 'manifestSha256', 'nodeId', 'sshFingerprint',
    'referencesSha256', 'bindings', 'digest']) && r.protocol === 1 && r.nodeId === grant.nodeId && r.digest === grant.review &&
    Array.isArray(r.bindings) && r.bindings.length === HOST_BINDING_NAMES.length && hostBindingDigest(r) === grant.review &&
    fields(hello.templates, HOST_BINDING_NAMES));
  for (const [i, name] of HOST_BINDING_NAMES.entries()) {
    const b = r.bindings[i]!, p = HOST_BINDING_PROFILES[name], template = hello.templates[name];
    required(b.name === name && b.config === p.config && b.unit === p.unit + '.service' && b.user === p.user &&
      b.chainDataDir === p.chainDataDir && typeof template === 'string' && Buffer.byteLength(template) <= 128 * 1024 &&
      hash(template) === b.templateSha256 && template.startsWith('# managed-by: omnitron\n'));
    const dynamic = template.split('\n').map(line => line.trim()).filter(line => line.includes('${'));
    required(JSON.stringify(dynamic.sort()) === JSON.stringify([...p.directives].sort()));
  }
}

/** Only single-line values for the reviewed native configuration directives cross this interface. */
export function renderInstalledConfigs(hello: HostConfigHello, values: unknown): Record<string, string> {
  required(fields(values, HOST_BINDING_NAMES));
  return Object.fromEntries(HOST_BINDING_NAMES.map(name => {
    const table = values[name];
    const slots = HOST_BINDING_PROFILES[name].directives.flatMap(line => [...line.matchAll(/\$\{secret:(\w+)\}/g)].map(m => m[1]!));
    required(fields(table, slots));
    for (const slot of slots) {
      const value = table[slot];
      required(typeof value === 'string' && (slot === 'rpc_auth'
        ? /^[a-zA-Z0-9_.-]{1,128}:[a-fA-F0-9]{32}\$[a-fA-F0-9]{64}$/.test(value)
        : /^[a-zA-Z0-9_.~@+\-/=]{1,256}$/.test(value)));
    }
    const content = hello.templates[name]!.replace(/\$\{secret:(\w+)\}/g, (_token, slot: string) => String(table[slot]));
    required(Buffer.byteLength(content) <= 128 * 1024);
    return [name, content];
  }));
}
export function checkInstallReceipt(value: HostConfigReceipt, grant: HostConfigGrant) {
  required(fields(value, ['protocol', 'ticket', 'nodeId', 'review', 'files']) && value.protocol === 1 && sameGrant(value, grant) &&
    Array.isArray(value.files) && value.files.length === HOST_BINDING_NAMES.length && value.files.every((row, i) =>
      fields(row, ['profile', 'receipt']) && row.profile === HOST_BINDING_NAMES[i] && typeof row.receipt === 'string' && digest.test(row.receipt)));
  return value;
}

/** Bounded length-prefixed JSON over an already authenticated stream. No request diagnostics contain frame data. */
export class HostConfigFrames {
  private readonly chunks: AsyncIterator<Buffer | string>;
  private buffered = Buffer.alloc(0);
  constructor(private readonly stream: Duplex) { this.chunks = stream[Symbol.asyncIterator](); }
  async read(): Promise<any> {
    const fill = async (size: number) => {
      while (this.buffered.length < size) {
        const next = await this.chunks.next();
        required(!next.done && this.buffered.length + Buffer.byteLength(next.value) <= 512 * 1024 + 4);
        this.buffered = Buffer.concat([this.buffered, Buffer.from(next.value)]);
      }
    };
    await fill(4);
    const size = this.buffered.readUInt32BE();
    required(size > 0 && size <= 512 * 1024);
    await fill(size + 4);
    const frame = this.buffered.subarray(4, size + 4);
    this.buffered = this.buffered.subarray(size + 4);
    try { return JSON.parse(frame.toString('utf8')); } catch { throw Error('Invalid host configuration frame'); }
    finally { frame.fill(0); }
  }
  async send(value: unknown) {
    const body = Buffer.from(JSON.stringify(value));
    required(body.length > 0 && body.length <= 512 * 1024);
    const frame = Buffer.allocUnsafe(body.length + 4);
    frame.writeUInt32BE(body.length); body.copy(frame, 4); body.fill(0);
    // A Duplex may retain the passed buffer after acknowledging the write.
    await new Promise<void>((resolve, reject) => this.stream.write(frame, error => error ? reject(Error('Host configuration channel failed')) : resolve()));
  }
}
