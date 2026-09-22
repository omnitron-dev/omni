/**
 * Where a release goes so that a master which did not build it can deploy it.
 *
 * A release exists in one place: `~/.omnitron/releases/<id>` on the master
 * that built it. `release list`, `stack start --release` and the console all
 * read that directory, so a second master — the one production will be run
 * from, or a laptop standing in for a master that died — has none, and the
 * only way across was a directory copied by hand with nothing checking what
 * arrived. `omnitron release push <id>` puts the release in an S3-compatible
 * bucket; `omnitron release pull <id>` takes it out onto any master and holds
 * it to the checks a deployment makes before it becomes visible there.
 *
 * WHAT TRAVELS is the five parts a release is made of — `manifest.json`,
 * `artifacts/`, `statics/`, `scripts/`, `attestations/` — laid out in the
 * bucket as on disk, under `<prefix>/<id>/`. Not `logs/`, `gate-logs/` or a
 * kept `src/`: those are the building master's evidence about its own build,
 * and a pulled release says it has no logs rather than carrying somebody
 * else's.
 *
 * THE INDEX. The manifest names each artifact by sha256 and the static
 * bundle by count and size; it says nothing about `scripts/` or
 * `attestations/`, which are written beside it. So the store keeps its own
 * record, `<id>/index.json`: every object of the release with its sha256 and
 * size. A pull hashes each object as it arrives and holds it to that record,
 * and a refusal names both sums in full. The index is written LAST — a push
 * that dies halfway leaves objects and no index, and a pull refuses that as a
 * push that did not finish instead of taking half a release.
 *
 * WHAT A PULL CHECKS, in the order it can fail:
 *
 *   1. every object against the index — sha256 and size;
 *   2. the index against the manifest — each artifact's sum, and the static
 *      bundle's file count and bytes (`loadRelease` only asks whether the
 *      directory exists);
 *   3. `loadRelease` itself, on the copy — the check `stack start --release`
 *      runs, so a pulled release has passed what a deployment will ask.
 *
 * Only then is the copy renamed into the releases directory. It is fetched
 * into a sibling of that directory rather than into it, because `release
 * list` and `release prune` read every directory there: the console would
 * show a half-fetched release as a failed build, and a prune could delete it
 * mid-pull — what 4ca4527c found a prune doing to a build.
 *
 * A RELEASE IS IMMUTABLE; WHAT WAS MEASURED ABOUT IT IS NOT. An attestation
 * arrives after the first push — test is attested once it carries the
 * release — and production, deployed from another master, asks for it by
 * name (`verifiedOn`). So a push or a pull of a release that is already
 * there compares everything else file by file and refuses any difference,
 * and moves only attestations. A difference means a different build under
 * the same id, which is not hypothetical: the id has minute resolution, so
 * two masters building one pair of commits in one minute produce exactly
 * that. Between two copies of one stack's attestation, the one that measured
 * later wins — `storeAttestation` keeps the newer run the same way — and the
 * side that keeps its own says so. Two masters pushing attestations for one
 * release in the same second: the later index wins, the other's object is in
 * the bucket, and its next push adds it back. An attestation that travels
 * was admitted at the door of the master that stored it (`attest.ts`); this
 * proves it is the same file and nothing more.
 *
 * NO SDK. There is no S3 client in this monorepo. The obvious one,
 * `@aws-sdk/client-s3@3.1137.0`, installs 26 packages — 3 338 files, 8.4 MB,
 * 18 MB on disk (measured 2026-09-22 into an empty directory) — and it would
 * install on every node, because a node installs omnitron's dependencies when
 * the bundle arrives. The size is the lesser half. Its default credential
 * chain reads `AWS_*` from the environment, `~/.aws/credentials`, the SSO
 * cache and a credential process, and asks the instance-metadata address:
 * `credential-provider-{env,ini,sso,process,web-identity,http,login}` and
 * `credential-provider-imds`, all in that install. The key to this store
 * comes from the daemon's vault and from nowhere else, and a client that
 * looks in eight other places when it is handed an empty key has eight other
 * doors. What this module needs is two verbs, PUT and GET, signed with
 * Signature Version 4: `node:crypto`, pinned in the court by AWS's own worked
 * examples and in practice by MinIO, which verifies every signature.
 *
 * THE KEY. `~/.omnitron/config.json` names the store and NAMES its key:
 *
 *     "releaseStore": { "endpoint", "bucket", "region", "forcePathStyle", "prefix",
 *                       "accessKey": { "secret": "<vault key>" },
 *                       "secretKey": { "secret": "<vault key>" } }
 *
 * — the `{ secret }` reference `resolveSecretRefs` resolves everywhere else.
 * The values are read from the daemon's vault through `OmnitronSecrets.get`,
 * which records each read in the audit trail. A literal credential in the
 * config is refused, a reference the vault cannot answer is refused by name,
 * and the pair is never logged and never sent: a signed request carries the
 * key's id and a signature, not the secret. Plain http is refused anywhere
 * but loopback — the signature protects the key and not the bytes, and a
 * release fetched over a network anyone can write to is code from anyone.
 *
 * WHAT THIS DOES NOT PROVE. The index lives in the bucket it describes. It
 * catches a changed byte, a lost object, a truncated upload and a push that
 * did not finish; it cannot catch someone who can write the bucket and
 * rewrites an object together with its index entry — the manifest then
 * catches an artifact or the static bundle's size, and nothing catches a
 * script or an attestation. Both commands print the index's sha256 so two
 * masters can compare it out of band; a signature over the index is the step
 * after that, and it needs a key decision nobody has made. Each object goes
 * up in one PUT, so a single file may be up to 5 GiB; the largest artifact
 * today is 8.3 MB.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { SecretRef } from '../infrastructure/types.js';
import { resolveSecretRefs } from '../project/config-resolver.js';
import { loadRelease, releasesRoot } from './load.js';
import type { ReleaseManifest } from './manifest.js';

// ============================================================================
// Which store, and whose key opens it
// ============================================================================

/** `releaseStore` in `~/.omnitron/config.json`, as an operator writes it. */
export interface ReleaseStoreConfig {
  /** `https://s3.<provider>` — or `http://127.0.0.1:9000`: plain http is taken on loopback only. */
  readonly endpoint: string;
  readonly bucket: string;
  /** Default `us-east-1`: MinIO's, and what S3-compatible providers take when they have none. */
  readonly region?: string;
  /**
   * `<endpoint>/<bucket>/<key>` rather than `<bucket>.<endpoint>/<key>`.
   * Default true, as every S3 address omnitron hands an application: MinIO
   * needs it, and the providers that prefer the other accept it too.
   */
  readonly forcePathStyle?: boolean;
  /** Where in the bucket releases live, for a bucket that holds other things too. */
  readonly prefix?: string;
  readonly accessKey: SecretRef;
  readonly secretKey: SecretRef;
}

export interface StoreCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** A store with its key read — held by `S3ObjectStore` and by nothing that prints. */
export interface ResolvedStore {
  readonly endpoint: URL;
  readonly bucket: string;
  readonly region: string;
  readonly forcePathStyle: boolean;
  /** Without leading or trailing slashes; empty for the bucket's root. */
  readonly prefix: string;
  readonly credentials: StoreCredentials;
  /** Which vault keys the pair came from — what a refusal names instead of the values. */
  readonly credentialKeys: { readonly accessKey: string; readonly secretKey: string };
}

const CONFIG_FIELDS = new Set(['endpoint', 'bucket', 'region', 'forcePathStyle', 'prefix', 'accessKey', 'secretKey']);

/** What a store looks like in the config, for a refusal to show — references, never values. */
export const STORE_CONFIG_EXAMPLE = [
  '"releaseStore": {',
  '  "endpoint": "https://s3.example.com",',
  '  "bucket": "omnitron-releases",',
  '  "region": "us-east-1",',
  '  "forcePathStyle": true,',
  '  "accessKey": { "secret": "release-store.access_key" },',
  '  "secretKey": { "secret": "release-store.secret_key" }',
  '}',
].join('\n');

function isLoopback(hostname: string): boolean {
  const h = hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Read `releaseStore` as the config holds it, or say what is wrong with it.
 *
 * Every refusal names the field and what it should be. Unknown fields are
 * refused as well: `forcePathStlye: false`, silently ignored, is a store that
 * answers «NoSuchBucket» for a reason nobody would look for in a spelling.
 */
export function parseStoreConfig(raw: unknown, source: string): ReleaseStoreConfig {
  if (raw === undefined || raw === null) {
    throw new Error(
      `No artifact store is configured on this master. ${source} takes one:\n\n${STORE_CONFIG_EXAMPLE}\n\n` +
        "and the daemon's vault holds the two keys it names (`omnitron secret set <key> …`).",
    );
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`'releaseStore' in ${source} is ${Array.isArray(raw) ? 'a list' : typeof raw}, not an object:\n\n${STORE_CONFIG_EXAMPLE}`);
  }
  const o = raw as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !CONFIG_FIELDS.has(k));
  if (unknown.length > 0) {
    throw new Error(`'releaseStore' in ${source} has ${unknown.map((k) => `'${k}'`).join(', ')}, which it does not read — it reads ${[...CONFIG_FIELDS].join(', ')}`);
  }

  const reference = (field: 'accessKey' | 'secretKey'): SecretRef => {
    const value = o[field];
    if (typeof value === 'string') {
      throw new Error(
        `'releaseStore.${field}' in ${source} is a literal credential. The key lives in the daemon's vault and the config names it: ` +
          `"${field}": { "secret": "<vault key>" }`,
      );
    }
    const ref = value as Record<string, unknown> | null | undefined;
    if (!ref || typeof ref !== 'object' || typeof ref['secret'] !== 'string' || ref['secret'] === '') {
      throw new Error(`'releaseStore.${field}' in ${source} must name a vault key: "${field}": { "secret": "<vault key>" }`);
    }
    if ('default' in ref) {
      // `resolveSecretRefs` falls back to it when the vault has nothing —
      // which is a literal credential in the config by another name.
      throw new Error(`'releaseStore.${field}' in ${source} carries a 'default' — a credential the vault does not hold is refused, not replaced`);
    }
    return { secret: ref['secret'] };
  };
  const accessKey = reference('accessKey');
  const secretKey = reference('secretKey');

  const endpoint = o['endpoint'];
  if (typeof endpoint !== 'string' || endpoint === '') {
    throw new Error(`'releaseStore.endpoint' in ${source} must be the store's address, e.g. "https://s3.example.com"`);
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`'releaseStore.endpoint' in ${source} is '${endpoint}', which is not an address`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`'releaseStore.endpoint' in ${source} is ${url.protocol} — the store speaks http(s)`);
  }
  if (url.username || url.password) {
    throw new Error(`'releaseStore.endpoint' in ${source} carries credentials in the address — they belong in the vault, named by accessKey and secretKey`);
  }
  if (url.search || url.hash) {
    throw new Error(`'releaseStore.endpoint' in ${source} has a query or a fragment; it is a base address`);
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new Error(
      `'releaseStore.endpoint' in ${source} is plain http to ${url.hostname}. The signature protects the key and not the bytes: ` +
        `anyone on the path could hand this master a release. Use https, or reach the store through a tunnel on loopback.`,
    );
  }

  const bucket = o['bucket'];
  if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error(`'releaseStore.bucket' in ${source} must be a bucket name — 3 to 63 of a-z, 0-9, '.' and '-'`);
  }
  const region = o['region'];
  if (region !== undefined && (typeof region !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(region))) {
    throw new Error(`'releaseStore.region' in ${source} must be a region name such as "us-east-1"`);
  }
  const forcePathStyle = o['forcePathStyle'];
  if (forcePathStyle !== undefined && typeof forcePathStyle !== 'boolean') {
    throw new Error(`'releaseStore.forcePathStyle' in ${source} is true or false`);
  }
  const prefix = o['prefix'];
  if (prefix !== undefined) {
    const trimmed = typeof prefix === 'string' ? prefix.replace(/^\/+|\/+$/g, '') : null;
    const fits =
      trimmed !== null &&
      (trimmed === '' || trimmed.split('/').every((s) => /^[A-Za-z0-9._-]+$/.test(s) && s !== '.' && s !== '..'));
    if (!fits) {
      throw new Error(`'releaseStore.prefix' in ${source} must be a path inside the bucket, of A-Z, a-z, 0-9, '.', '_' and '-'`);
    }
  }

  return {
    endpoint,
    bucket,
    ...(typeof region === 'string' ? { region } : {}),
    ...(typeof forcePathStyle === 'boolean' ? { forcePathStyle } : {}),
    ...(typeof prefix === 'string' ? { prefix } : {}),
    accessKey,
    secretKey,
  };
}

/**
 * The store with its key, read through `getSecret` — the daemon's
 * `OmnitronSecrets.get` in the command, a fake vault in the court.
 *
 * `resolveSecretRefs` turns a reference the vault cannot answer into an empty
 * string, which a store reports as a bad signature against a key it was never
 * given. The misses are counted here instead and refused by name, before a
 * single request is made.
 */
export async function resolveStore(
  config: ReleaseStoreConfig,
  getSecret: (key: string) => Promise<string | null>,
): Promise<ResolvedStore> {
  const missing: string[] = [];
  const resolved = await resolveSecretRefs(
    { accessKey: config.accessKey, secretKey: config.secretKey } as unknown as Record<string, unknown>,
    async (key) => {
      const value = await getSecret(key);
      if (value === null || value === '') missing.push(key);
      return value;
    },
  );
  if (missing.length > 0) {
    throw new Error(
      `The artifact store's key is not in the daemon's vault: it holds no ${missing.map((k) => `'${k}'`).join(' and ')}. ` +
        '`omnitron secret list` shows what it holds; `omnitron secret set <key> …` adds one.',
    );
  }
  const accessKeyId = resolved['accessKey'];
  const secretAccessKey = resolved['secretKey'];
  if (typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string') {
    throw new Error("The vault's answer for the artifact store's key is not a string");
  }
  return {
    endpoint: new URL(config.endpoint),
    bucket: config.bucket,
    region: config.region ?? 'us-east-1',
    forcePathStyle: config.forcePathStyle ?? true,
    prefix: (config.prefix ?? '').replace(/^\/+|\/+$/g, ''),
    credentials: { accessKeyId, secretAccessKey },
    credentialKeys: { accessKey: config.accessKey.secret, secretKey: config.secretKey.secret },
  };
}

// ============================================================================
// Signature Version 4 — the part of it two verbs need
// ============================================================================

const EMPTY_SHA256 = crypto.createHash('sha256').digest('hex');

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Percent-encoding as SigV4 defines it: everything but `A-Z a-z 0-9 - _ . ~`.
 * `encodeURIComponent` leaves `! ' ( ) *` alone, and a statics file named
 * with one of them would be signed as one path and sent as another.
 */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface SignInput {
  readonly method: string;
  /** The path as it is sent, already encoded. */
  readonly canonicalUri: string;
  readonly query?: Readonly<Record<string, string>>;
  /** Every header that is sent and signed besides the two this adds; `host` among them. */
  readonly headers: Readonly<Record<string, string>>;
  /** sha256 of the body — the store recomputes it and refuses a body that does not match. */
  readonly payloadSha256: string;
  readonly region: string;
  readonly credentials: StoreCredentials;
  readonly now: Date;
}

/**
 * Sign one request; returns the headers to add — `x-amz-date`,
 * `x-amz-content-sha256` and `authorization`.
 *
 * The payload is signed by its real sum rather than as `UNSIGNED-PAYLOAD`:
 * then the store itself refuses an upload whose bytes changed on the way,
 * before this side ever reads them back.
 */
export function signV4(input: SignInput): { headers: Record<string, string>; signature: string } {
  const amzDate = input.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/s3/aws4_request`;

  const headers = new Map<string, string>();
  for (const [name, value] of Object.entries(input.headers)) headers.set(name.toLowerCase(), value);
  headers.set('x-amz-date', amzDate);
  headers.set('x-amz-content-sha256', input.payloadSha256);
  const names = [...headers.keys()].sort();
  const canonicalHeaders = names.map((n) => `${n}:${(headers.get(n) ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');

  // By key, then by value — not by the joined `k=v`, which puts `a-b=` before
  // `a=` because '-' sorts below '='.
  const canonicalQuery = Object.entries(input.query ?? {})
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([ka, va], [kb, vb]) => (ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    input.canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadSha256,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const hmac = (key: string | Buffer, data: string) => crypto.createHmac('sha256', key).update(data).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, day), input.region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    signature,
    headers: {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': input.payloadSha256,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/** Where an object is, in either addressing style. */
export function objectAddress(
  store: Pick<ResolvedStore, 'endpoint' | 'bucket' | 'forcePathStyle' | 'prefix'>,
  key: string,
): { readonly https: boolean; readonly hostname: string; readonly port: string; readonly host: string; readonly path: string } {
  const base = store.endpoint;
  const basePath = base.pathname.replace(/\/+$/, '');
  const full = store.prefix ? `${store.prefix}/${key}` : key;
  const encoded = full.split('/').map(encodeRfc3986).join('/');
  const hostname = base.hostname.replace(/^\[(.*)\]$/, '$1');
  const secure = base.protocol === 'https:';
  if (store.forcePathStyle) {
    return { https: secure, hostname, port: base.port, host: base.host, path: `${basePath}/${store.bucket}/${encoded}` };
  }
  return {
    https: secure,
    hostname: `${store.bucket}.${hostname}`,
    port: base.port,
    host: `${store.bucket}.${base.host}`,
    path: `${basePath}/${encoded}`,
  };
}

// ============================================================================
// The client
// ============================================================================

export interface ObjectSum {
  readonly sha256: string;
  readonly bytes: number;
}

/** What push and pull need of a store: two verbs, and a name for refusals. */
export interface ObjectStore {
  readonly location: string;
  /** Write `source` — a file, or bytes — whose sum is already known. */
  put(key: string, source: string | Buffer, sum: ObjectSum): Promise<void>;
  /**
   * Stream an object into `into`, hashing it on the way; null when there is
   * no such object. Stops, and refuses, past `recordedBytes`: what the index
   * recorded bounds what a pull will write.
   */
  get(key: string, into: string, recordedBytes: number): Promise<ObjectSum | null>;
  /** A small object whole, or null when there is none. */
  read(key: string, limitBytes: number): Promise<Buffer | null>;
}

/** S3 refuses a single PUT above this; a multipart upload is the way past it. */
const SINGLE_PUT_LIMIT = 5 * 1024 ** 3;
/** An S3 error document is a few hundred bytes; this is how much of one is read. */
const ERROR_BODY_LIMIT = 64 * 1024;

function xmlField(body: string, field: string): string | null {
  const match = new RegExp(`<${field}>([^<]*)</${field}>`).exec(body);
  if (!match) return null;
  return match[1]!
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readCapped(res: http.IncomingMessage, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      if (size < cap) chunks.push(chunk.subarray(0, cap - size));
      size += chunk.length;
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
    // A connection closed mid-answer ends with neither of the two above on
    // every path through `http`; unanswered, this promise would wait for ever.
    res.on('close', () => {
      if (!res.complete) reject(new Error('the connection closed before the store finished answering'));
    });
  });
}

/**
 * An S3-compatible bucket, reached with `node:http(s)` and SigV4.
 *
 * The key pair is a private field: nothing that prints this object — a log
 * line, an `inspect`, a `JSON.stringify` of an error that holds it — can
 * reach it.
 */
export class S3ObjectStore implements ObjectStore {
  readonly location: string;
  readonly #credentials: StoreCredentials;
  readonly #store: ResolvedStore;
  readonly #agent: http.Agent;
  readonly #idleMs: number;

  constructor(store: ResolvedStore, options: { idleTimeoutMs?: number; sockets?: number } = {}) {
    this.#store = store;
    this.#credentials = store.credentials;
    this.#idleMs = options.idleTimeoutMs ?? 60_000;
    const agentOptions = { keepAlive: true, maxSockets: options.sockets ?? 8 };
    this.#agent = store.endpoint.protocol === 'https:' ? new https.Agent(agentOptions) : new http.Agent(agentOptions);
    const base = `${store.endpoint.origin}${store.endpoint.pathname.replace(/\/+$/, '')}`;
    this.location = `s3://${store.bucket}${store.prefix ? `/${store.prefix}` : ''} at ${base}`;
  }

  /** Keep-alive sockets hold the process open; a command closes the store when it is done. */
  close(): void {
    this.#agent.destroy();
  }

  async put(key: string, source: string | Buffer, sum: ObjectSum): Promise<void> {
    if (sum.bytes > SINGLE_PUT_LIMIT) {
      throw new Error(`${key} is ${sum.bytes} bytes; one PUT carries at most ${SINGLE_PUT_LIMIT}, and this store does not split uploads`);
    }
    const res = await this.send('PUT', key, { source, sum });
    const body = await readCapped(res, ERROR_BODY_LIMIT);
    if (res.statusCode !== 200) throw this.failure('PUT', key, res.statusCode ?? 0, body.toString('utf8'));
  }

  async get(key: string, into: string, recordedBytes: number): Promise<ObjectSum | null> {
    const res = await this.send('GET', key, null);
    if (res.statusCode !== 200) {
      const body = (await readCapped(res, ERROR_BODY_LIMIT)).toString('utf8');
      if (res.statusCode === 404 && xmlField(body, 'Code') === 'NoSuchKey') return null;
      throw this.failure('GET', key, res.statusCode ?? 0, body);
    }
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > recordedBytes) {
      res.destroy();
      throw new Error(`${key} in ${this.location} is ${declared} bytes, and the index recorded ${recordedBytes} — it is not the object that was pushed`);
    }
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const location = this.location;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > recordedBytes) {
          done(new Error(`${key} in ${location} runs past the ${recordedBytes} bytes the index recorded — it is not the object that was pushed`));
          return;
        }
        hash.update(chunk);
        done(null, chunk);
      },
    });
    await pipeline(res, meter, fs.createWriteStream(into));
    return { sha256: hash.digest('hex'), bytes };
  }

  async read(key: string, limitBytes: number): Promise<Buffer | null> {
    const res = await this.send('GET', key, null);
    if (res.statusCode !== 200) {
      const body = (await readCapped(res, ERROR_BODY_LIMIT)).toString('utf8');
      if (res.statusCode === 404 && xmlField(body, 'Code') === 'NoSuchKey') return null;
      throw this.failure('GET', key, res.statusCode ?? 0, body);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res) {
      size += (chunk as Buffer).length;
      if (size > limitBytes) {
        res.destroy();
        throw new Error(`${key} in ${this.location} is larger than ${limitBytes} bytes — more than this reads whole`);
      }
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  /**
   * One signed request; resolves with the response once its headers arrive.
   *
   * `setTimeout` is an IDLE timeout on the socket: a transfer that is moving
   * is never cut, one that has said nothing for a minute is — and the error
   * reaches the response too, so a stream being read does not wait forever.
   */
  private send(
    method: 'GET' | 'PUT',
    key: string,
    body: { source: string | Buffer; sum: ObjectSum } | null,
  ): Promise<http.IncomingMessage> {
    const address = objectAddress(this.#store, key);
    const signed = signV4({
      method,
      canonicalUri: address.path,
      headers: { host: address.host },
      payloadSha256: body ? body.sum.sha256 : EMPTY_SHA256,
      region: this.#store.region,
      credentials: this.#credentials,
      now: new Date(),
    });
    const headers: http.OutgoingHttpHeaders = { host: address.host, ...signed.headers };
    if (body) headers['content-length'] = String(body.sum.bytes);

    return new Promise((resolve, reject) => {
      let response: http.IncomingMessage | null = null;
      const req = (address.https ? https : http).request(
        {
          hostname: address.hostname,
          ...(address.port ? { port: Number(address.port) } : {}),
          path: address.path,
          method,
          headers,
          agent: this.#agent,
        },
        (res) => {
          response = res;
          resolve(res);
        },
      );
      req.setTimeout(this.#idleMs, () => {
        const err = new Error(`${this.location}: ${method} ${key} — nothing for ${Math.round(this.#idleMs / 1000)}s, abandoned`);
        req.destroy(err);
        response?.destroy(err);
      });
      req.on('error', reject);
      if (!body) {
        req.end();
      } else if (Buffer.isBuffer(body.source)) {
        req.end(body.source);
      } else {
        // A store that answers early — a 403 before the body is through —
        // ends this pipe with an error; the response carries the verdict.
        pipeline(fs.createReadStream(body.source), req).catch(() => undefined);
      }
    });
  }

  /** A refusal in the store's own words, and what it usually means here. */
  private failure(method: string, key: string, status: number, body: string): Error {
    const code = xmlField(body, 'Code');
    const message = xmlField(body, 'Message')?.replace(/\.\s*$/, '');
    const keys = this.#store.credentialKeys;
    const hints: Record<string, string> = {
      NoSuchBucket: `create the bucket '${this.#store.bucket}' there, or name the right one in releaseStore.bucket`,
      InvalidAccessKeyId: `the key pair is the vault's '${keys.accessKey}' and '${keys.secretKey}', and the store does not know it`,
      SignatureDoesNotMatch: `the key pair is the vault's '${keys.accessKey}' and '${keys.secretKey}', and the store does not accept it`,
      AccessDenied:
        method === 'GET'
          ? 'S3 answers 403 rather than 404 for a missing object when the key may not list the bucket — grant s3:ListBucket on it'
          : `the vault's '${keys.accessKey}' may not write here`,
      RequestTimeTooSkewed: "this machine's clock is too far from the store's",
      PermanentRedirect: 'the bucket is in another region — releaseStore.region, or path style off',
    };
    const hint = code ? hints[code] : undefined;
    return new Error(
      `${this.location}: ${method} ${key} answered ${status}${code ? ` ${code}` : ''}` +
        `${message ? ` — ${message}` : ''}${hint ? `. ${hint[0]!.toUpperCase()}${hint.slice(1)}.` : ''}`,
    );
  }
}

// ============================================================================
// The index: every object of a release, by sha256
// ============================================================================

const INDEX_NAME = 'index.json';
/** The 555 objects of daos-202609221654-8d2f51e0-225cde48 make a 95 536-byte index; this is a bound, not an estimate. */
const INDEX_LIMIT = 16 * 1024 * 1024;
const DIRECTORY_PARTS = ['artifacts', 'statics', 'scripts', 'attestations'] as const;

export type ReleasePart = 'manifest' | (typeof DIRECTORY_PARTS)[number];

export interface IndexEntry {
  /** Relative to the release, `/`-separated: `artifacts/main-0.0.1.tar.gz`. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  /** The owner may execute it — 21 of the 117 files of daos's `scripts/` at 8d2f51e0. */
  readonly executable?: true;
  /** An attestation's own `at`: which of two differing copies measured later. */
  readonly at?: string;
}

export interface StoreIndex {
  readonly format: 1;
  readonly release: string;
  readonly pushedAt: string;
  readonly pushedBy: string;
  readonly files: readonly IndexEntry[];
}

/** The same rule `loadRelease` applies — the court holds the two to one answer. */
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isReleaseId(id: string): boolean {
  return RELEASE_ID.test(id) && !id.includes('..');
}

/**
 * Why a path may not be a file of a release — or null.
 *
 * Applied on both sides: a pull reads paths from the store, which is input
 * from outside, and a path that climbs would write wherever it points; a
 * push applies the same rule so it never writes an index a pull would
 * refuse.
 */
export function entryPathProblem(p: unknown): string | null {
  if (typeof p !== 'string' || p === '') return 'it is not a path';
  if (p.length > 1024) return 'it is longer than 1024 characters';
  if (p.includes('\\') || p.includes('\0')) return 'it holds a backslash or a NUL';
  const segments = p.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return 'it is absolute, climbs, or has an empty segment';
  const top = segments[0]!;
  if (top === 'manifest.json') return segments.length === 1 ? null : 'manifest.json is a file';
  if (top === 'artifacts') return segments.length === 2 ? null : 'an artifact is a file directly in artifacts/';
  if (top === 'attestations') {
    return segments.length === 2 && segments[1]!.endsWith('.json') ? null : 'an attestation is attestations/<stack>.json';
  }
  if (top === 'statics' || top === 'scripts') return segments.length >= 2 ? null : `${top} is a directory`;
  return `'${top}' is not one of the five parts of a release`;
}

function partOf(p: string): ReleasePart {
  const top = p.split('/')[0]!;
  return top === 'manifest.json' ? 'manifest' : (top as ReleasePart);
}

const isAttestation = (e: IndexEntry): boolean => partOf(e.path) === 'attestations';
const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

async function hashFile(file: string): Promise<ObjectSum> {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

function attestationAt(file: string): string | undefined {
  try {
    const at = (JSON.parse(fs.readFileSync(file, 'utf8')) as { at?: unknown }).at;
    return typeof at === 'string' ? at : undefined;
  } catch {
    // Unreadable: carried, and read as the oldest when two copies differ.
    return undefined;
  }
}

/**
 * The five parts of the release in `dir`, as index entries, by path.
 *
 * Regular files only. A symlink is refused rather than followed or skipped:
 * `fs.cpSync` — which is how the builder copies `scripts/` and `statics/` —
 * keeps a link as a link, pointing into a clone that is deleted after the
 * build, so it would arrive as nothing, or as whatever the path names on the
 * next machine.
 */
async function walkRelease(dir: string): Promise<IndexEntry[]> {
  const entries: IndexEntry[] = [];
  const take = async (rel: string, full: string): Promise<void> => {
    const problem = entryPathProblem(rel);
    if (problem) throw new Error(`${full} cannot travel: ${problem}`);
    const sum = await hashFile(full);
    const executable = (fs.statSync(full).mode & 0o100) !== 0;
    const at = partOf(rel) === 'attestations' ? attestationAt(full) : undefined;
    entries.push({ path: rel, ...sum, ...(executable ? { executable: true as const } : {}), ...(at ? { at } : {}) });
  };
  const visit = async (abs: string, rel: string): Promise<void> => {
    const children = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of children) {
      const childAbs = path.join(abs, child.name);
      const childRel = `${rel}/${child.name}`;
      if (child.isDirectory()) await visit(childAbs, childRel);
      else if (child.isFile()) await take(childRel, childAbs);
      else {
        throw new Error(
          `${childAbs} is ${child.isSymbolicLink() ? 'a symbolic link' : 'not a regular file'} — the store carries files, ` +
            'and this would arrive as nothing, or as whatever the path names on the next machine',
        );
      }
    }
  };

  const manifest = path.join(dir, 'manifest.json');
  if (!fs.lstatSync(manifest).isFile()) throw new Error(`${manifest} is not a regular file`);
  await take('manifest.json', manifest);
  for (const part of DIRECTORY_PARTS) {
    const top = path.join(dir, part);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(top);
    } catch {
      continue; // A release built before this part existed has none.
    }
    if (!st.isDirectory()) throw new Error(`${top} is not a directory`);
    await visit(top, part);
  }
  return entries.sort(byPath);
}

/**
 * The index as the store holds it — read as input from outside.
 *
 * Every path is checked before anything is written, every sum and size is
 * checked for shape, and the index must describe the release it was asked
 * for: an index copied from another release's prefix is refused here rather
 * than by a sum three hundred objects later.
 */
export function parseIndex(bytes: Buffer, id: string, location: string): StoreIndex {
  const where = `${location}: ${id}/${INDEX_NAME}`;
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw new Error(`${where} does not parse (${(err as Error).message}) — the store's record of this release is damaged`, {
      cause: err,
    });
  }
  const o = raw as { format?: unknown; release?: unknown; pushedAt?: unknown; pushedBy?: unknown; files?: unknown } | null;
  if (!o || typeof o !== 'object') throw new Error(`${where} is not an object`);
  if (o.format !== 1) throw new Error(`${where} is format ${String(o.format)}; this omnitron reads format 1`);
  if (o.release !== id) throw new Error(`${where} describes release '${String(o.release)}', not '${id}'`);
  if (!Array.isArray(o.files)) throw new Error(`${where} lists no files`);

  const seen = new Set<string>();
  const files: IndexEntry[] = [];
  for (const item of o.files as unknown[]) {
    const e = (item ?? {}) as { path?: unknown; sha256?: unknown; bytes?: unknown; executable?: unknown; at?: unknown };
    const problem = entryPathProblem(e.path);
    if (problem) throw new Error(`${where} names '${String(e.path)}': ${problem}. Nothing was written.`);
    const p = e.path as string;
    if (seen.has(p)) throw new Error(`${where} names ${p} twice`);
    seen.add(p);
    if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) throw new Error(`${where} gives ${p} no sha256`);
    if (typeof e.bytes !== 'number' || !Number.isSafeInteger(e.bytes) || e.bytes < 0) throw new Error(`${where} gives ${p} no size`);
    files.push({
      path: p,
      sha256: e.sha256,
      bytes: e.bytes,
      ...(e.executable === true ? { executable: true as const } : {}),
      ...(typeof e.at === 'string' ? { at: e.at } : {}),
    });
  }
  if (!seen.has('manifest.json')) throw new Error(`${where} has no manifest.json`);
  return {
    format: 1,
    release: id,
    pushedAt: typeof o.pushedAt === 'string' ? o.pushedAt : '',
    pushedBy: typeof o.pushedBy === 'string' ? o.pushedBy : '',
    files: files.sort(byPath),
  };
}

export interface PartTally {
  readonly files: number;
  readonly bytes: number;
}

function tally(entries: readonly IndexEntry[]): PartTally {
  return { files: entries.length, bytes: entries.reduce((sum, e) => sum + e.bytes, 0) };
}

function tallyParts(entries: readonly IndexEntry[]): Record<ReleasePart, PartTally> {
  const parts: ReleasePart[] = ['manifest', ...DIRECTORY_PARTS];
  return Object.fromEntries(parts.map((part) => [part, tally(entries.filter((e) => partOf(e.path) === part))])) as Record<
    ReleasePart,
    PartTally
  >;
}

/**
 * The files — an index's, or a disk's — against the manifest they carry.
 *
 * Each artifact by sum and size, both in full; the static bundle by count and
 * bytes, counted as the builder counts them (`countFiles`: regular files,
 * recursively). `loadRelease` compares the artifacts too, on disk, and says
 * twelve characters of each sum; this runs first so a refusal says all
 * sixty-four.
 */
function checkAgainstManifest(
  id: string,
  manifest: ReleaseManifest,
  entries: readonly IndexEntry[],
  where: string,
): { artifacts: number; statics: PartTally | null } {
  const byEntry = new Map(entries.map((e) => [e.path, e]));
  for (const a of manifest.artifacts) {
    const p = `artifacts/${a.app}-${a.version}.tar.gz`;
    const e = byEntry.get(p);
    if (!e) throw new Error(`Release ${id}: the manifest names ${a.app}@${a.version}, and ${where} has no ${p}`);
    if (e.sha256 !== a.sha256 || e.bytes !== a.bytes) {
      throw new Error(
        `Release ${id}: ${p} ${where} is ${e.bytes} bytes hashing to ${e.sha256}, ` +
          `and the manifest recorded ${a.bytes} bytes hashing to ${a.sha256 || '(nothing)'}`,
      );
    }
  }
  const statics = tally(entries.filter((e) => partOf(e.path) === 'statics'));
  if (manifest.statics) {
    if (statics.files !== manifest.statics.files || statics.bytes !== manifest.statics.bytes) {
      throw new Error(
        `Release ${id}: the static bundle ${where} is ${statics.files} files, ${statics.bytes} bytes, ` +
          `and the manifest recorded ${manifest.statics.files} files, ${manifest.statics.bytes} bytes`,
      );
    }
  } else if (statics.files > 0) {
    throw new Error(`Release ${id}: the manifest records no static bundle, and ${where} has ${statics.files} statics file(s)`);
  }
  return { artifacts: manifest.artifacts.length, statics: manifest.statics ? statics : null };
}

interface Difference {
  readonly path: string;
  readonly here: IndexEntry | null;
  readonly there: IndexEntry | null;
}

/** Everything but the attestations, file by file: what makes two copies one build. */
function compareBuilds(here: readonly IndexEntry[], there: readonly IndexEntry[]): Difference[] {
  const ours = new Map(here.filter((e) => !isAttestation(e)).map((e) => [e.path, e]));
  const theirs = new Map(there.filter((e) => !isAttestation(e)).map((e) => [e.path, e]));
  const out: Difference[] = [];
  for (const [p, e] of ours) {
    const t = theirs.get(p);
    if (!t) out.push({ path: p, here: e, there: null });
    else if (t.sha256 !== e.sha256 || t.bytes !== e.bytes) out.push({ path: p, here: e, there: t });
  }
  for (const [p, t] of theirs) if (!ours.has(p)) out.push({ path: p, here: null, there: t });
  return out.sort(byPath);
}

function differentBuild(id: string, differences: readonly Difference[], hereName: string, thereName: string): string {
  const lines = differences.slice(0, 5).map((d) =>
    !d.there
      ? `${d.path} is only in ${hereName}`
      : !d.here
        ? `${d.path} is only in ${thereName}`
        : `${d.path} hashes to ${d.here.sha256} in ${hereName} and to ${d.there.sha256} in ${thereName}`,
  );
  const more = differences.length > 5 ? `; and ${differences.length - 5} more` : '';
  return (
    `Release ${id}: ${hereName} and ${thereName} are two different builds under one id — ` +
    `${differences.length} file(s) differ: ${lines.join('; ')}${more}. A release is never replaced; nothing was changed.`
  );
}

/** Which of two copies of one stack's attestation measured later; an unreadable `at` is the older. */
function measuredLater(candidate: string | undefined, incumbent: string | undefined): boolean {
  const c = candidate ? Date.parse(candidate) : Number.NaN;
  const i = incumbent ? Date.parse(incumbent) : Number.NaN;
  if (Number.isNaN(c)) return false;
  if (Number.isNaN(i)) return true;
  return c > i;
}

export interface KeptAttestation {
  readonly path: string;
  /** When the copy that stays measured. */
  readonly kept: string | null;
  /** When the copy that was offered and not taken measured. */
  readonly offered: string | null;
}

/** Attestations `from` one side that the other should take: absent there, or measured later. */
function planAttestations(
  from: readonly IndexEntry[],
  into: readonly IndexEntry[],
): { copy: IndexEntry[]; kept: KeptAttestation[]; merged: IndexEntry[] } {
  const existing = new Map(into.map((e) => [e.path, e]));
  const copy: IndexEntry[] = [];
  const kept: KeptAttestation[] = [];
  for (const e of from) {
    const there = existing.get(e.path);
    if (!there) copy.push(e);
    else if (there.sha256 === e.sha256) continue;
    else if (measuredLater(e.at, there.at)) copy.push(e);
    else kept.push({ path: e.path, kept: there.at ?? null, offered: e.at ?? null });
  }
  const replaced = new Set(copy.map((e) => e.path));
  return { copy, kept, merged: [...into.filter((e) => !replaced.has(e.path)), ...copy] };
}

async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  let first: unknown;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const item = items[next++]!;
      try {
        await work(item);
      } catch (err) {
        if (!failed) {
          failed = true;
          first = err;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed) throw first;
}

/** A path from the index, placed under `dir` — and proved to stay there. */
function placeOf(dir: string, rel: string): string {
  const full = path.join(dir, ...rel.split('/'));
  if (!full.startsWith(dir + path.sep)) throw new Error(`${rel} would land outside ${dir}`);
  return full;
}

/**
 * One object, fetched and held to its index entry.
 *
 * Both numbers, both sums, in full: the size says «a link dropped partway»
 * as against «a different file», and a twelve-character prefix is not what
 * an operator can paste into `grep`.
 */
async function fetchVerified(store: ObjectStore, id: string, entry: IndexEntry, file: string, consequence: string): Promise<void> {
  let got: ObjectSum | null;
  try {
    got = await store.get(`${id}/${entry.path}`, file, entry.bytes);
  } catch (err) {
    throw new Error(`Release ${id}: ${(err as Error).message}. ${consequence}`, { cause: err });
  }
  const repair = `\`omnitron release push ${id} --repair\` on a master that holds the release writes it again.`;
  if (!got) {
    throw new Error(`Release ${id}: the index names ${entry.path}, and ${store.location} does not hold it. ${consequence} ${repair}`);
  }
  if (got.bytes !== entry.bytes || got.sha256 !== entry.sha256) {
    throw new Error(
      `Release ${id}: ${entry.path} in ${store.location} is ${got.bytes} bytes hashing to ${got.sha256}, ` +
        `and the index recorded ${entry.bytes} bytes hashing to ${entry.sha256} — it is not the object that was pushed. ` +
        `${consequence} ${repair}`,
    );
  }
  if (entry.executable) fs.chmodSync(file, 0o755);
}

// ============================================================================
// push and pull
// ============================================================================

export interface TransferOptions {
  /** Where releases live on this machine. Default `~/.omnitron/releases`. */
  readonly root?: string;
  /** Objects in flight at once. Default 8: 548 statics files one by one is a minute on a remote store. */
  readonly concurrency?: number;
  /**
   * Push only: write every object again even where the store's index already
   * agrees with this disk.
   *
   * A push compares this disk with the store's INDEX, not with its objects —
   * reading 60 MB back to learn that nothing changed would make every push a
   * pull. So a store whose object was damaged after the push answers «already
   * there» to a plain push, and the pull that found the damage had nobody to
   * send the operator to. This is the repair: the index was just proved to
   * describe the build on this disk, so rewriting the objects from it cannot
   * put a different build in their place. An attestation the store holds a
   * later copy of is still left alone.
   */
  readonly repair?: boolean;
  /** After each object moves: how far, of how much. */
  readonly onProgress?: (done: PartTally, total: PartTally) => void;
}

export interface TransferResult {
  readonly id: string;
  readonly location: string;
  /** What the release in the store is made of now, part by part. */
  readonly parts: Readonly<Record<ReleasePart, PartTally>>;
  /** What this run moved. Nothing, when both sides already agreed. */
  readonly moved: PartTally;
  /** sha256 of the index the store holds after this run: the number two masters compare. */
  readonly indexSha256: string;
  /** Attestations left as they were, because the copy already there measured later. */
  readonly keptNewer: readonly KeptAttestation[];
}

export interface PullResult extends TransferResult {
  /** The release's directory on this machine. */
  readonly root: string;
  /** It was here before this pull, so only attestations could move. */
  readonly alreadyHere: boolean;
  /** What the manifest and `loadRelease` confirmed. */
  readonly checked: { readonly artifacts: number; readonly statics: PartTally | null };
}

/**
 * Put a release in the store.
 *
 * `loadRelease` first — a release that no longer matches its own manifest on
 * this disk is not put anywhere else — and the static bundle against the
 * manifest's count, which `loadRelease` does not check. Then the objects,
 * each signed with its sum so the store refuses one that changed on the way,
 * and the index last.
 */
export async function pushRelease(id: string, store: ObjectStore, options: TransferOptions = {}): Promise<TransferResult> {
  if (!isReleaseId(id)) throw new Error(`'${id}' is not a release id`);
  const root = path.resolve(options.root ?? releasesRoot());
  const loaded = await loadRelease(id, root);
  const local = await walkRelease(loaded.root);
  checkAgainstManifest(id, loaded.manifest, local, 'on this disk');

  const indexKey = `${id}/${INDEX_NAME}`;
  const existing = await store.read(indexKey, INDEX_LIMIT);
  const remote = existing ? parseIndex(existing, id, store.location) : null;

  let send: IndexEntry[] = local;
  let files: IndexEntry[] = local;
  let keptNewer: KeptAttestation[] = [];
  if (remote) {
    const differences = compareBuilds(local, remote.files);
    if (differences.length > 0) throw new Error(differentBuild(id, differences, 'this machine', store.location));
    const plan = planAttestations(local.filter(isAttestation), remote.files.filter(isAttestation));
    const kept = new Set(plan.kept.map((k) => k.path));
    send = options.repair ? local.filter((e) => !kept.has(e.path)) : plan.copy;
    keptNewer = plan.kept;
    files = [...remote.files.filter((e) => !isAttestation(e)), ...plan.merged].sort(byPath);
    if (send.length === 0) {
      return { id, location: store.location, parts: tallyParts(remote.files), moved: tally([]), indexSha256: sha256Hex(existing!), keptNewer };
    }
  }

  const total = tally(send);
  let done = { files: 0, bytes: 0 };
  await eachLimited(send, options.concurrency ?? 8, async (entry) => {
    await store.put(`${id}/${entry.path}`, placeOf(loaded.root, entry.path), entry);
    done = { files: done.files + 1, bytes: done.bytes + entry.bytes };
    options.onProgress?.(done, total);
  });

  // Last, and only now: the index is what makes the release exist in the store.
  const index: StoreIndex = {
    format: 1,
    release: id,
    pushedAt: new Date().toISOString(),
    pushedBy: `${os.userInfo().username}@${os.hostname()}`,
    files,
  };
  const body = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  const indexSha256 = sha256Hex(body);
  await store.put(indexKey, body, { sha256: indexSha256, bytes: body.length });
  return { id, location: store.location, parts: tallyParts(files), moved: total, indexSha256, keptNewer };
}

/**
 * Take a release out of the store onto this machine.
 *
 * Into a directory beside the releases root, checked three ways, then renamed
 * into place: the release appears whole and checked, or not at all. When it
 * is already here, everything but the attestations must be the same build,
 * and only an attestation that measured later is taken.
 */
export async function pullRelease(id: string, store: ObjectStore, options: TransferOptions = {}): Promise<PullResult> {
  if (!isReleaseId(id)) throw new Error(`'${id}' is not a release id`);
  const root = path.resolve(options.root ?? releasesRoot());

  const bytes = await store.read(`${id}/${INDEX_NAME}`, INDEX_LIMIT);
  if (!bytes) {
    throw new Error(
      `${store.location} has no release '${id}': there is no ${id}/${INDEX_NAME}. A push writes it last, so objects ` +
        `without it are a push that did not finish — \`omnitron release push ${id}\` on the master that built it completes one.`,
    );
  }
  const indexSha256 = sha256Hex(bytes);
  const index = parseIndex(bytes, id, store.location);
  const target = path.join(root, id);

  if (fs.existsSync(target)) {
    if (!fs.existsSync(path.join(target, 'manifest.json'))) {
      throw new Error(
        `${target} is on this machine and holds no manifest.json — a build that did not finish. ` +
          'It was left as it is; remove it, and the pull can put the release there.',
      );
    }
    const local = await walkRelease(target);
    const differences = compareBuilds(local, index.files);
    if (differences.length > 0) throw new Error(differentBuild(id, differences, target, store.location));
    const plan = planAttestations(index.files.filter(isAttestation), local.filter(isAttestation));
    for (const entry of plan.copy) {
      const file = placeOf(target, entry.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Beside the file and renamed over it: `loadAttestations` reads only
      // `*.json`, so a half-written one is never read as evidence.
      const partial = `${file}.pull-${process.pid}`;
      try {
        await fetchVerified(store, id, entry, partial, `${file} was left as it was.`);
        fs.renameSync(partial, file);
      } finally {
        fs.rmSync(partial, { force: true });
      }
    }
    const loaded = await loadRelease(id, root);
    const checked = checkAgainstManifest(id, loaded.manifest, local, 'on this disk');
    return {
      id,
      location: store.location,
      parts: tallyParts(index.files),
      moved: tally(plan.copy),
      indexSha256,
      keptNewer: plan.kept,
      root: target,
      alreadyHere: true,
      checked,
    };
  }

  fs.mkdirSync(path.dirname(root), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(root), `.${path.basename(root)}.pull-`));
  const staged = path.join(staging, id);
  const consequence = `Nothing was written to ${root}.`;
  try {
    const total = tally(index.files);
    let done = { files: 0, bytes: 0 };
    await eachLimited(index.files, options.concurrency ?? 8, async (entry) => {
      const file = placeOf(staged, entry.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await fetchVerified(store, id, entry, file, consequence);
      done = { files: done.files + 1, bytes: done.bytes + entry.bytes };
      options.onProgress?.(done, total);
    });

    let manifest: ReleaseManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(staged, 'manifest.json'), 'utf8')) as ReleaseManifest;
    } catch (err) {
      throw new Error(`Release ${id}: the manifest in the store does not parse (${(err as Error).message}). ${consequence}`, {
        cause: err,
      });
    }
    let checked: { artifacts: number; statics: PartTally | null };
    try {
      checked = checkAgainstManifest(id, manifest, index.files, "in the store's index");
      // A bundle of no files has no objects, and `loadRelease` asks for the directory.
      if (manifest.statics) fs.mkdirSync(path.join(staged, 'statics'), { recursive: true });
      // The deployment's own check, on the copy, before anything is visible.
      await loadRelease(id, staging);
    } catch (err) {
      throw new Error(`${(err as Error).message}. ${consequence}`, { cause: err });
    }

    fs.mkdirSync(root, { recursive: true });
    try {
      fs.renameSync(staged, target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOTEMPTY' || code === 'EEXIST') {
        throw new Error(`${target} appeared while this pull ran — it was left as it is, and the copy was discarded`, { cause: err });
      }
      throw err;
    }
    return {
      id,
      location: store.location,
      parts: tallyParts(index.files),
      moved: total,
      indexSha256,
      keptNewer: [],
      root: target,
      alreadyHere: false,
      checked,
    };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
