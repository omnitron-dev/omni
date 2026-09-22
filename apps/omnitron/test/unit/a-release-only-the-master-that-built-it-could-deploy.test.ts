/**
 * A release only the master that built it could deploy.
 *
 * `~/.omnitron/releases/<id>` was the only place a release existed, so the
 * master that built it was the only one that could deploy it. This court
 * holds the way across — `pushRelease` into an S3-compatible bucket,
 * `pullRelease` out of it onto a root that never saw the release — and holds
 * it to five things:
 *
 *   - a pulled release is the one that was pushed, all five parts of it, and
 *     `loadRelease` — the deployment's own check — takes the copy;
 *   - one byte changed in the store, in an artifact, a script or an
 *     attestation, is a refusal that names BOTH sums in full, and nothing is
 *     left in the root;
 *   - the index cannot be used to write outside the release, and an index
 *     rewritten together with an artifact still meets the manifest;
 *   - a release is never replaced by a different build under its id, while
 *     an attestation that measured later travels both ways;
 *   - the key comes from the vault and never reaches the wire.
 *
 * The store is a fake that is not kinder than S3: it verifies every
 * signature with its own reading of Signature Version 4 — decoding the path
 * it received and encoding it again, as S3 does — refuses a PUT whose body
 * does not hash to the sum it was signed with, refuses a chunked upload as
 * AWS does, and answers in S3's XML. The signer itself is held to AWS's
 * published worked examples.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  encodeRfc3986,
  entryPathProblem,
  isReleaseId,
  objectAddress,
  parseStoreConfig,
  pullRelease,
  pushRelease,
  resolveStore,
  S3ObjectStore,
  signV4,
} from '../../src/release/artifact-store.js';
import { loadRelease } from '../../src/release/load.js';
import type { ReleaseManifest } from '../../src/release/manifest.js';

const ID = 'daos-202609221654-8d2f51e0-225cde48';
const BUCKET = 'releases-court';
const PREFIX = 'court';

const sha256 = (data: string | Buffer): string => crypto.createHash('sha256').update(data).digest('hex');

// ============================================================================
// An S3 that is not kinder than S3
// ============================================================================

/** RFC 3986 by bytes — written apart from the module's, which leans on encodeURIComponent. */
function rfc3986(value: string): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const c = String.fromCharCode(byte);
    out += /[A-Za-z0-9\-._~]/.test(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

interface Received {
  readonly method: string;
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
}

class FakeS3 {
  readonly objects = new Map<string, Buffer>();
  readonly received: Received[] = [];
  url = '';
  private server: http.Server | null = null;

  constructor(
    private readonly buckets: ReadonlySet<string>,
    private readonly keys: ReadonlyMap<string, string>,
    private readonly region: string,
  ) {}

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err: Error) => {
        res.writeHead(500);
        res.end(err.message);
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  puts(): number {
    return this.received.filter((r) => r.method === 'PUT').length;
  }

  objectKey(rel: string): string {
    return `${BUCKET}/${PREFIX}/${ID}/${rel}`;
  }

  flipByte(rel: string, at: number): Buffer {
    const key = this.objectKey(rel);
    const body = Buffer.from(this.objects.get(key)!);
    body[at] = body[at]! ^ 0xff;
    this.objects.set(key, body);
    return body;
  }

  private xml(res: http.ServerResponse, status: number, code: string, message: string): void {
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${message}</Message></Error>`;
    res.writeHead(status, { 'content-type': 'application/xml', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.received.push({ method: req.method ?? '', url: req.url ?? '', headers: { ...req.headers } });
    // Drained before any answer, so a refusal reaches the client as a
    // refusal and not as a connection reset in the middle of its upload.
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const url = new URL(req.url ?? '/', 'http://fake');
    const raw = url.pathname.split('/').slice(1);
    let segments: string[];
    try {
      segments = raw.map((s) => decodeURIComponent(s));
    } catch {
      return this.xml(res, 400, 'InvalidURI', 'Could not parse the specified URI.');
    }
    const [bucket = '', ...keyParts] = segments;
    const key = keyParts.join('/');

    const auth =
      /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(
        req.headers.authorization ?? '',
      );
    if (!auth) return this.xml(res, 403, 'AccessDenied', 'Access Denied.');
    const [, keyId, day, region, signedHeaders, signature] = auth as unknown as [string, string, string, string, string, string];
    const secret = this.keys.get(keyId);
    if (!secret) return this.xml(res, 403, 'InvalidAccessKeyId', 'The Access Key Id you provided does not exist in our records.');
    if (region !== this.region) return this.xml(res, 400, 'AuthorizationHeaderMalformed', `the region '${region}' is wrong`);
    const amzDate = String(req.headers['x-amz-date'] ?? '');
    const at = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
    if (!at || !amzDate.startsWith(day)) return this.xml(res, 403, 'AccessDenied', 'X-Amz-Date does not match the credential scope');
    const when = Date.UTC(+at[1]!, +at[2]! - 1, +at[3]!, +at[4]!, +at[5]!, +at[6]!);
    if (Math.abs(Date.now() - when) > 15 * 60_000) {
      return this.xml(res, 403, 'RequestTimeTooSkewed', 'The difference between the request time and the current time is too large.');
    }
    const names = signedHeaders.split(';');
    if (!['host', 'x-amz-date', 'x-amz-content-sha256'].every((n) => names.includes(n))) {
      return this.xml(res, 403, 'AccessDenied', 'host, x-amz-date and x-amz-content-sha256 must be signed');
    }

    const canonicalUri = `/${segments.map(rfc3986).join('/')}`;
    const canonicalQuery = [...url.searchParams.entries()]
      .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
      .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const canonicalHeaders = names.map((n) => `${n}:${String(req.headers[n] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
    const payload = String(req.headers['x-amz-content-sha256'] ?? '');
    const canonicalRequest = [req.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payload].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, `${day}/${region}/s3/aws4_request`, sha256(canonicalRequest)].join('\n');
    let signingKey: Buffer = crypto.createHmac('sha256', `AWS4${secret}`).update(day).digest();
    for (const part of [region, 's3', 'aws4_request']) signingKey = crypto.createHmac('sha256', signingKey).update(part).digest();
    const expected = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    if (expected !== signature) {
      return this.xml(res, 403, 'SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided.');
    }

    if (!this.buckets.has(bucket)) return this.xml(res, 404, 'NoSuchBucket', 'The specified bucket does not exist');
    if (req.method === 'PUT') {
      if (req.headers['transfer-encoding']) {
        return this.xml(res, 501, 'NotImplemented', 'A header you provided implies functionality that is not implemented');
      }
      const declared = Number(req.headers['content-length']);
      if (!Number.isFinite(declared)) return this.xml(res, 411, 'MissingContentLength', 'You must provide the Content-Length HTTP header.');
      if (body.length !== declared) return this.xml(res, 400, 'IncompleteBody', 'You did not provide the number of bytes specified by the Content-Length HTTP header');
      if (sha256(body) !== payload) {
        return this.xml(res, 400, 'XAmzContentSHA256Mismatch', "The provided 'x-amz-content-sha256' header does not match what was computed.");
      }
      this.objects.set(`${bucket}/${key}`, body);
      res.writeHead(200, { etag: `"${crypto.createHash('md5').update(body).digest('hex')}"`, 'content-length': 0 });
      res.end();
      return;
    }
    if (req.method === 'GET') {
      const object = this.objects.get(`${bucket}/${key}`);
      if (!object) return this.xml(res, 404, 'NoSuchKey', 'The specified key does not exist.');
      res.writeHead(200, { 'content-length': object.length, 'content-type': 'application/octet-stream' });
      res.end(object);
      return;
    }
    return this.xml(res, 405, 'MethodNotAllowed', 'The specified method is not allowed against this resource.');
  }
}

// ============================================================================
// A release, and the places it is put
// ============================================================================

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-store-court-')));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

let rootCount = 0;
/** A fresh `<machine>/releases` path — not created, as on a master that has never had one. */
function machine(): string {
  rootCount += 1;
  return path.join(base, `machine-${rootCount}`, 'releases');
}

function attestation(at: string, note: string): string {
  return `${JSON.stringify(
    {
      stack: 'test',
      release: ID,
      gates: [{ name: 'revocation-live', status: 'passed', detail: note }],
      at,
      onNode: { claimed: true, hosts: ['10.0.0.1'], matched: true },
      storedAt: at,
    },
    null,
    2,
  )}\n`;
}

/**
 * Every part a release can have, and two it must not carry. The statics are
 * named to be awkward on the wire: a space, `+`, `@`, parentheses — which
 * `encodeURIComponent` leaves alone and SigV4 does not — Cyrillic, and a
 * dot-directory.
 */
function buildRelease(root: string): { dir: string; manifest: ReleaseManifest } {
  const dir = path.join(root, ID);
  const write = (rel: string, content: string | Buffer, mode = 0o644) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    fs.chmodSync(file, mode);
  };
  const artifacts = [
    { app: 'main', bytes: crypto.randomBytes(300_000) },
    { app: 'storage', bytes: crypto.randomBytes(70_000) },
  ];
  for (const a of artifacts) write(`artifacts/${a.app}-0.0.1.tar.gz`, a.bytes);

  const statics: Record<string, string | Buffer> = {
    'index.html': '<!doctype html><title>court</title>\n',
    'assets/index-B1x+2@(1).js': crypto.randomBytes(20_000),
    'assets/fonts/Inter Var.woff2': crypto.randomBytes(5_000),
    'ru/страница.html': '<p>страница</p>\n',
    '.well-known/security.txt': 'Contact: court\n',
  };
  let staticBytes = 0;
  for (const [rel, content] of Object.entries(statics)) {
    write(`statics/${rel}`, content);
    staticBytes += Buffer.byteLength(content);
  }

  write('scripts/attest.mjs', '#!/usr/bin/env node\nconsole.log("{}");\n', 0o755);
  write('scripts/gates.mjs', 'export {};\n');
  write('scripts/lib/probe.mjs', 'export const probe = 1;\n');
  write('attestations/test.json', attestation('2026-09-22T18:00:00.000Z', 'first'));
  write('logs/clone.log', 'the builder talking to itself\n');
  write('gate-logs/unit.log', 'a gate talking to itself\n');

  const manifest: ReleaseManifest = {
    id: ID,
    project: { repo: 'gitlab', commit: 'a'.repeat(40), onRemote: true },
    omni: { repo: 'github', commit: 'b'.repeat(40), onRemote: true },
    artifacts: artifacts.map((a) => ({ app: a.app, version: '0.0.1', sha256: sha256(a.bytes), bytes: a.bytes.length })),
    statics: { stack: 'test', dir: 'apps/portal/dist', files: Object.keys(statics).length, bytes: staticBytes },
    gates: [{ name: 'build', status: 'passed' }],
    builtWith: { omnitron: '0.2.0', packages: [] },
    builtAt: '2026-09-22T16:54:00.000Z',
    builtBy: 'court',
  };
  write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifest };
}

/** The five parts under a release directory: path → sum and executable bit. */
function partsOf(dir: string): Map<string, { sum: string; exec: boolean }> {
  const out = new Map<string, { sum: string; exec: boolean }>();
  const walk = (abs: string, rel: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(childAbs, childRel);
      else out.set(childRel, { sum: sha256(fs.readFileSync(childAbs)), exec: (fs.statSync(childAbs).mode & 0o100) !== 0 });
    }
  };
  for (const part of ['artifacts', 'statics', 'scripts', 'attestations']) {
    if (fs.existsSync(path.join(dir, part))) walk(path.join(dir, part), part);
  }
  out.set('manifest.json', { sum: sha256(fs.readFileSync(path.join(dir, 'manifest.json'))), exec: false });
  return out;
}

/** Nothing of a pull is left beside the root: no half-fetched copy, no staging directory. */
function besideRoot(root: string): string[] {
  const parent = path.dirname(root);
  return fs.existsSync(parent) ? fs.readdirSync(parent).filter((n) => n !== path.basename(root)) : [];
}

// ============================================================================
// The key, the vault, the store
// ============================================================================

const accessKeyId = `court-${crypto.randomBytes(6).toString('hex')}`;
const secretAccessKey = crypto.randomBytes(30).toString('base64url');
const vault = new Map<string, string>([
  ['court.access_key', accessKeyId],
  ['court.secret_key', secretAccessKey],
]);
const fake = new FakeS3(new Set([BUCKET]), new Map([[accessKeyId, secretAccessKey]]), 'us-east-1');
const opened: S3ObjectStore[] = [];

beforeAll(() => fake.start());
afterAll(() => fake.stop());
beforeEach(() => {
  fake.objects.clear();
  fake.received.length = 0;
});
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
});

function configFor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    endpoint: fake.url,
    bucket: BUCKET,
    region: 'us-east-1',
    forcePathStyle: true,
    prefix: PREFIX,
    accessKey: { secret: 'court.access_key' },
    secretKey: { secret: 'court.secret_key' },
    ...overrides,
  };
}

/** The store as the command opens one: config parsed, key read from a vault. */
async function openStore(secrets: ReadonlyMap<string, string> = vault): Promise<S3ObjectStore> {
  const config = parseStoreConfig(configFor(), 'the court');
  const store = new S3ObjectStore(await resolveStore(config, async (key) => secrets.get(key) ?? null), { idleTimeoutMs: 10_000 });
  opened.push(store);
  return store;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('it did not refuse');
}

// ============================================================================
// The court
// ============================================================================

describe("Signature Version 4, held to AWS's own worked examples", () => {
  // The example pair from AWS's «Signature Calculations for the Authorization
  // Header» — published documentation values, not a credential.
  const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
  const now = new Date('2013-05-24T00:00:00Z');
  const host = 'examplebucket.s3.amazonaws.com';
  const empty = sha256('');

  it('GET Object, with a range', () => {
    const signed = signV4({ method: 'GET', canonicalUri: '/test.txt', headers: { host, range: 'bytes=0-9' }, payloadSha256: empty, region: 'us-east-1', credentials, now });
    expect(signed.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(signed.headers['authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('PUT Object, whose name holds a $ and whose body is signed by its sum', () => {
    const payload = sha256('Welcome to Amazon S3.');
    expect(payload).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
    const signed = signV4({
      method: 'PUT',
      canonicalUri: `/${encodeRfc3986('test$file.text')}`,
      headers: { host, date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      payloadSha256: payload,
      region: 'us-east-1',
      credentials,
      now,
    });
    expect(signed.signature).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('GET Bucket Lifecycle — a query key with no value', () => {
    const signed = signV4({ method: 'GET', canonicalUri: '/', query: { lifecycle: '' }, headers: { host }, payloadSha256: empty, region: 'us-east-1', credentials, now });
    expect(signed.signature).toBe('fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
  });

  it('GET Bucket, listing — two query keys, in order', () => {
    const signed = signV4({ method: 'GET', canonicalUri: '/', query: { prefix: 'J', 'max-keys': '2' }, headers: { host }, payloadSha256: empty, region: 'us-east-1', credentials, now });
    expect(signed.signature).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });
});

describe('one master pushes, another pulls', () => {
  it('pulls into a root that never saw the release: every part arrives, and loadRelease takes the copy', async () => {
    const builder = machine();
    const { dir } = buildRelease(builder);
    const store = await openStore();

    const pushed = await pushRelease(ID, store, { root: builder });
    const sent = partsOf(dir);
    expect(pushed.moved.files).toBe(sent.size);
    expect(pushed.parts).toMatchObject({
      manifest: { files: 1 },
      artifacts: { files: 2 },
      statics: { files: 5 },
      scripts: { files: 3 },
      attestations: { files: 1 },
    });
    // The store holds the five parts and the index — and not the builder's logs.
    const held = [...fake.objects.keys()].map((k) => k.slice(`${BUCKET}/${PREFIX}/${ID}/`.length)).sort();
    expect(held).toEqual([...sent.keys(), 'index.json'].sort());
    expect(sha256(fake.objects.get(fake.objectKey('index.json'))!)).toBe(pushed.indexSha256);

    const receiver = machine();
    const pulled = await pullRelease(ID, store, { root: receiver });
    expect(pulled.alreadyHere).toBe(false);
    expect(pulled.indexSha256).toBe(pushed.indexSha256);
    expect(pulled.checked).toEqual({ artifacts: 2, statics: { files: 5, bytes: expect.any(Number) } });

    const loaded = await loadRelease(ID, receiver);
    expect(loaded.files.map((f) => f.app)).toEqual(['main', 'storage']);
    expect(partsOf(path.join(receiver, ID))).toEqual(sent);
    expect(partsOf(path.join(receiver, ID)).get('scripts/attest.mjs')?.exec).toBe(true);
    expect(fs.existsSync(path.join(receiver, ID, 'logs'))).toBe(false);
    expect(besideRoot(receiver)).toEqual([]);
  });

  it('a second push of the same release writes nothing', async () => {
    const builder = machine();
    buildRelease(builder);
    const store = await openStore();
    const first = await pushRelease(ID, store, { root: builder });
    const puts = fake.puts();

    const again = await pushRelease(ID, store, { root: builder });
    expect(again.moved.files).toBe(0);
    expect(again.indexSha256).toBe(first.indexSha256);
    expect(fake.puts()).toBe(puts);
  });
});

describe('a store that no longer holds what was pushed', () => {
  async function pushed(): Promise<{ store: S3ObjectStore; dir: string }> {
    const builder = machine();
    const { dir } = buildRelease(builder);
    const store = await openStore();
    await pushRelease(ID, store, { root: builder });
    return { store, dir };
  }

  for (const rel of ['artifacts/main-0.0.1.tar.gz', 'scripts/attest.mjs', 'attestations/test.json']) {
    it(`refuses one changed byte in ${rel.split('/')[0]}/, naming both sums, and leaves nothing behind`, async () => {
      const { store, dir } = await pushed();
      const recorded = sha256(fs.readFileSync(path.join(dir, rel)));
      const changed = sha256(fake.flipByte(rel, 7));
      expect(changed).not.toBe(recorded);

      const receiver = machine();
      const message = await refusal(pullRelease(ID, store, { root: receiver }));
      expect(message).toContain(rel);
      expect(message).toContain(recorded);
      expect(message).toContain(changed);
      expect(fs.existsSync(path.join(receiver, ID))).toBe(false);
      expect(besideRoot(receiver)).toEqual([]);
    });
  }

  it('a plain push answers from the index, so it cannot see the damage — the refusal sends the operator to --repair, which writes it back', async () => {
    const { store, dir } = await pushed();
    const rel = 'scripts/attest.mjs';
    fake.flipByte(rel, 3);
    expect((await pushRelease(ID, store, { root: path.dirname(dir) })).moved.files).toBe(0);
    const message = await refusal(pullRelease(ID, store, { root: machine() }));
    expect(message).toContain(`\`omnitron release push ${ID} --repair\``);

    const repaired = await pushRelease(ID, store, { root: path.dirname(dir), repair: true });
    expect(repaired.moved.files).toBe(partsOf(dir).size);
    expect(sha256(fake.objects.get(fake.objectKey(rel))!)).toBe(sha256(fs.readFileSync(path.join(dir, rel))));
    const receiver = machine();
    await pullRelease(ID, store, { root: receiver });
    expect(partsOf(path.join(receiver, ID))).toEqual(partsOf(dir));
  });

  it('refuses an object shorter than the index recorded, naming both sizes', async () => {
    const { store, dir } = await pushed();
    const rel = 'artifacts/storage-0.0.1.tar.gz';
    const key = fake.objectKey(rel);
    fake.objects.set(key, fake.objects.get(key)!.subarray(0, 1000));
    const message = await refusal(pullRelease(ID, store, { root: machine() }));
    expect(message).toContain(`is 1000 bytes hashing to ${sha256(fake.objects.get(key)!)}`);
    expect(message).toContain(`recorded ${fs.statSync(path.join(dir, rel)).size} bytes`);
  });

  it('an artifact rewritten together with its index entry still meets the manifest', async () => {
    const { store, dir } = await pushed();
    const rel = 'artifacts/main-0.0.1.tar.gz';
    const original = fs.readFileSync(path.join(dir, rel));
    const forged = crypto.randomBytes(original.length);
    fake.objects.set(fake.objectKey(rel), forged);
    const index = JSON.parse(fake.objects.get(fake.objectKey('index.json'))!.toString('utf8')) as { files: Array<{ path: string; sha256: string }> };
    index.files.find((f) => f.path === rel)!.sha256 = sha256(forged);
    fake.objects.set(fake.objectKey('index.json'), Buffer.from(JSON.stringify(index)));

    const receiver = machine();
    const message = await refusal(pullRelease(ID, store, { root: receiver }));
    expect(message).toContain(sha256(forged));
    expect(message).toContain(sha256(original));
    expect(message).toMatch(/manifest recorded/);
    expect(fs.existsSync(path.join(receiver, ID))).toBe(false);
  });

  it('a statics file gone from the store and from its index is caught by the count the manifest recorded', async () => {
    const { store } = await pushed();
    const rel = 'statics/index.html';
    fake.objects.delete(fake.objectKey(rel));
    const index = JSON.parse(fake.objects.get(fake.objectKey('index.json'))!.toString('utf8')) as { files: Array<{ path: string }> };
    index.files = index.files.filter((f) => f.path !== rel);
    fake.objects.set(fake.objectKey('index.json'), Buffer.from(JSON.stringify(index)));

    const message = await refusal(pullRelease(ID, store, { root: machine() }));
    expect(message).toMatch(/static bundle in the store's index is 4 files, \d+ bytes, and the manifest recorded 5 files/);
  });

  it('a push that did not finish — objects, and no index — is refused as such', async () => {
    const { store } = await pushed();
    fake.objects.delete(fake.objectKey('index.json'));
    const receiver = machine();
    const message = await refusal(pullRelease(ID, store, { root: receiver }));
    expect(message).toMatch(/no release .* push that did not finish/);
    expect(fs.existsSync(path.dirname(receiver))).toBe(false);
  });

  for (const escape of ['../../escaped.txt', '/tmp/escaped.txt', 'statics/../../escaped.txt', 'artifacts/nested/x.tar.gz', 'logs/clone.log', 'attestations/notes.txt']) {
    it(`refuses an index that names '${escape}', before anything is written`, async () => {
      const { store } = await pushed();
      const index = JSON.parse(fake.objects.get(fake.objectKey('index.json'))!.toString('utf8')) as { files: Array<Record<string, unknown>> };
      index.files.push({ path: escape, sha256: sha256('x'), bytes: 1 });
      fake.objects.set(fake.objectKey('index.json'), Buffer.from(JSON.stringify(index)));
      const gets = fake.received.length;

      const receiver = machine();
      const message = await refusal(pullRelease(ID, store, { root: receiver }));
      expect(message).toContain(`names '${escape}'`);
      // One GET — the index — and nothing after it.
      expect(fake.received.length).toBe(gets + 1);
      expect(fs.existsSync(path.dirname(receiver))).toBe(false);
      expect(fs.existsSync(path.join(base, 'escaped.txt'))).toBe(false);
    });
  }
});

describe('what is already there', () => {
  it('does not push a release that no longer matches its own manifest, and the store receives nothing', async () => {
    const builder = machine();
    const { dir } = buildRelease(builder);
    const file = path.join(dir, 'artifacts/main-0.0.1.tar.gz');
    const bytes = fs.readFileSync(file);
    bytes[0] = bytes[0]! ^ 0xff;
    fs.writeFileSync(file, bytes);

    const store = await openStore();
    const message = await refusal(pushRelease(ID, store, { root: builder }));
    expect(message).toMatch(/main's tarball hashes to/);
    expect(fake.puts()).toBe(0);
  });

  it('refuses a different build under the same id, naming the file and both sums, and leaves the store as it was', async () => {
    const first = machine();
    buildRelease(first);
    const store = await openStore();
    const pushed = await pushRelease(ID, store, { root: first });

    const second = machine();
    const { dir } = buildRelease(second);
    const message = await refusal(pushRelease(ID, store, { root: second }));
    const ours = sha256(fs.readFileSync(path.join(dir, 'artifacts/main-0.0.1.tar.gz')));
    const theirs = sha256(fake.objects.get(fake.objectKey('artifacts/main-0.0.1.tar.gz'))!);
    expect(message).toContain(`artifacts/main-0.0.1.tar.gz hashes to ${ours} in this machine and to ${theirs} in`);
    expect(message).toMatch(/two different builds under one id/);
    expect(sha256(fake.objects.get(fake.objectKey('index.json'))!)).toBe(pushed.indexSha256);
  });

  it('an attestation that measured later travels both ways; an older one does not replace it', async () => {
    const builder = machine();
    const { dir } = buildRelease(builder);
    const stale = machine();
    fs.cpSync(builder, stale, { recursive: true });
    const store = await openStore();
    await pushRelease(ID, store, { root: builder });
    const receiver = machine();
    await pullRelease(ID, store, { root: receiver });

    // Test was attested again, later, on the master that built it.
    const later = attestation('2026-09-23T09:00:00.000Z', 'second');
    fs.writeFileSync(path.join(dir, 'attestations/test.json'), later);
    const puts = fake.puts();
    const pushed = await pushRelease(ID, store, { root: builder });
    expect(pushed.moved.files).toBe(1);
    expect(fake.puts()).toBe(puts + 2); // the attestation, then the index
    expect(fake.objects.get(fake.objectKey('attestations/test.json'))!.toString('utf8')).toBe(later);

    // A master that already has the release takes the later one, and only it.
    const refreshed = await pullRelease(ID, store, { root: receiver });
    expect(refreshed.alreadyHere).toBe(true);
    expect(refreshed.moved.files).toBe(1);
    expect(fs.readFileSync(path.join(receiver, ID, 'attestations/test.json'), 'utf8')).toBe(later);
    expect(fs.readdirSync(path.join(receiver, ID, 'attestations'))).toEqual(['test.json']);

    // A master holding the earlier one pushes: the store keeps the later, and says so.
    const kept = await pushRelease(ID, store, { root: stale });
    expect(kept.moved.files).toBe(0);
    expect(kept.keptNewer).toEqual([{ path: 'attestations/test.json', kept: '2026-09-23T09:00:00.000Z', offered: '2026-09-22T18:00:00.000Z' }]);
    expect(fake.objects.get(fake.objectKey('attestations/test.json'))!.toString('utf8')).toBe(later);

    // Nor does a repair from that master: it rewrites the build, not the measurement.
    const repaired = await pushRelease(ID, store, { root: stale, repair: true });
    expect(repaired.keptNewer).toHaveLength(1);
    expect(fake.objects.get(fake.objectKey('attestations/test.json'))!.toString('utf8')).toBe(later);
  });

  it('refuses to pull over a different build under the id, and leaves the local one alone', async () => {
    const builder = machine();
    buildRelease(builder);
    const store = await openStore();
    await pushRelease(ID, store, { root: builder });

    const other = machine();
    const { dir } = buildRelease(other);
    const before = partsOf(dir);
    const message = await refusal(pullRelease(ID, store, { root: other }));
    expect(message).toMatch(/two different builds under one id/);
    expect(message).toContain(before.get('artifacts/main-0.0.1.tar.gz')!.sum);
    expect(partsOf(dir)).toEqual(before);
  });
});

describe('whose key opens the store', () => {
  it('refuses a literal credential in the config, and a default that would be one', () => {
    expect(() => parseStoreConfig(configFor({ secretKey: 'not-in-a-vault' }), 'the court')).toThrow(/literal credential/);
    expect(() => parseStoreConfig(configFor({ accessKey: { secret: 'court.access_key', default: 'x' } }), 'the court')).toThrow(/'default'/);
  });

  it('refuses a key the vault does not hold, by name, before a single request', async () => {
    const config = parseStoreConfig(configFor(), 'the court');
    const partial = new Map([['court.access_key', accessKeyId]]);
    const message = await refusal(resolveStore(config, async (key) => partial.get(key) ?? null));
    expect(message).toContain("'court.secret_key'");
    expect(message).not.toContain("'court.access_key'");
    expect(fake.received).toHaveLength(0);
  });

  it('never puts the secret on the wire, and a refused signature names the vault keys and not the value', async () => {
    const builder = machine();
    buildRelease(builder);
    await pushRelease(ID, await openStore(), { root: builder });
    const wire = JSON.stringify(fake.received);
    expect(fake.received.length).toBeGreaterThan(10);
    expect(wire).not.toContain(secretAccessKey);
    expect(wire).toContain(accessKeyId); // the id travels; that is what it is for

    const wrong = crypto.randomBytes(30).toString('base64url');
    const store = await openStore(new Map([['court.access_key', accessKeyId], ['court.secret_key', wrong]]));
    const message = await refusal(pushRelease(ID, store, { root: builder }));
    expect(message).toMatch(/SignatureDoesNotMatch/);
    expect(message).toContain("'court.access_key' and 'court.secret_key'");
    expect(message).not.toContain(wrong);
  });

  it('takes https and loopback http, and refuses http elsewhere, credentials in the address, and fields it does not read', () => {
    expect(parseStoreConfig(configFor({ endpoint: 'https://s3.example.com' }), 'the court').endpoint).toBe('https://s3.example.com');
    expect(parseStoreConfig(configFor({ endpoint: 'http://localhost:9000' }), 'the court').endpoint).toBe('http://localhost:9000');
    expect(() => parseStoreConfig(configFor({ endpoint: 'http://192.168.100.2:9000' }), 'the court')).toThrow(/plain http to 192\.168\.100\.2/);
    expect(() => parseStoreConfig(configFor({ endpoint: 'https://user:pass@s3.example.com' }), 'the court')).toThrow(/credentials in the address/);
    expect(() => parseStoreConfig(configFor({ forcePathStlye: false }), 'the court')).toThrow(/'forcePathStlye', which it does not read/);
    expect(() => parseStoreConfig(undefined, 'the court')).toThrow(/No artifact store is configured/);
  });

  it('refuses exactly the release ids loadRelease refuses', async () => {
    const empty = path.join(base, 'no-releases');
    const ids = [ID, 'a', 'A.b_c-d', '../x', '..', 'a..b', '.hidden', '-x', 'x/y', '', 'x y', 'ünï'];
    for (const id of ids) {
      const loadRefuses = await loadRelease(id, empty).then(
        () => false,
        (err: Error) => /is not a release id/.test(err.message),
      );
      expect({ id, accepted: isReleaseId(id) }).toEqual({ id, accepted: !loadRefuses });
    }
  });

  it('addresses one key the same way in both styles, encoded as SigV4 encodes it', () => {
    const store = { endpoint: new URL('https://s3.example.com'), bucket: 'releases', prefix: 'fleet', forcePathStyle: true };
    const key = `${ID}/statics/assets/index-B1x+2@(1) ё.js`;
    const encoded = `${ID}/statics/assets/index-B1x%2B2%40%281%29%20%D1%91.js`;
    expect(objectAddress(store, key)).toEqual({ https: true, hostname: 's3.example.com', port: '', host: 's3.example.com', path: `/releases/fleet/${encoded}` });
    expect(objectAddress({ ...store, forcePathStyle: false }, key)).toEqual({
      https: true,
      hostname: 'releases.s3.example.com',
      port: '',
      host: 'releases.s3.example.com',
      path: `/fleet/${encoded}`,
    });
    expect(entryPathProblem('statics/a b/(c).js')).toBeNull();
  });
});
