/**
 * A record the transport rewrote.
 *
 * Every result the execution engine returns has passed through its masker,
 * and the master read some of those results as DATA. A node's deploy-lease
 * answer carries its holder's record, `{"token":"<uuid>","holder":…}`; it came
 * back as `"token": [REDACTED]` on every read, the record did not parse, and
 * a refused deployment said «being deployed by a deployment whose lease file
 * could not be read» — never who. On 2026-09-23 the same masker cut the
 * first operator account's password out of its answer line on daos/test, and
 * an attestation whose probe printed `password=…` loses its line the same way.
 *
 * The data channel (`execution/data-channel.ts`) carries stdout hex-encoded
 * from the node. This court sends a payload carrying every trigger the
 * masker has through the real engine and requires it back byte for byte —
 * the property is today's rule set, and a rule that learns long hex strings
 * turns this red.
 */

import { describe, expect, it } from 'vitest';

import { fromDataChannel, throughDataChannel } from '../../src/execution/data-channel.js';
import { ExecutionService } from '../../src/execution/execution.service.js';
import { LeaseHeldError, parseAcquire } from '../../src/services/node-deploy-lease.js';
import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';
import { shellEscape } from '../../src/shared/shell-escape.js';

const quiet: any = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child: () => quiet };
const execution = new ExecutionService(quiet);

const RECORD = '{"token":"4f0c2a9e-0000-4000-8000-00000000c0de","holder":"omnitron@laptop pid 4242","stack":"daos/test","startedAt":"2026-09-23T18:04:13Z"}';
/** Every shape the masker rewrites today, and a run `od` would fold without `-v`. */
const PAYLOAD = [
  `HELD 12\t${RECORD}`,
  '{"password":"hunter2","secret":"s3","api_key":"k","client_secret":"c","apikey":"a"}',
  'password=hunter2 passwd: pw pwd=x token=t secret=s client_secret=cs',
  'DATABASE_URL=postgres://postgres:Zm9vYmFy@127.0.0.1:5432/main REDIS_PASSWORD=r3dis MY_API_KEY=abc',
  'Authorization: Bearer eyJhbGciOi.abc.def',
  'curl -u admin:letmein --password hunter2 --secret shh',
  'ghp_0123456789abcdefABCDEF AKIAABCDEFGHIJKLMNOP sk_live_0123456789abcd glpat-0123456789abcdefghij',
  'npm_0123456789abcdefghijklmnopqrstuvwxyz AIzaSyA0123456789abcdefghij xoxb-0123456789-abc',
  '-----BEGIN PRIVATE KEY-----',
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
  '-----END PRIVATE KEY-----',
  // A probe's separator: one byte, repeated, which `od` folds into `*` without `-v`.
  '='.repeat(64),
  "it's $HOME and `backticks`",
].join('\n');

const printPayload = `printf '%s' ${shellEscape(PAYLOAD)}`;

describe('the transport rewrites data it returns', () => {
  it('as measured: the payload does not come back as it was printed', async () => {
    const plain = await execution.exec(printPayload);
    expect(plain.stdout).not.toBe(PAYLOAD);
    expect(plain.stdout).toContain('[REDACTED]');
  });
});

describe('the data channel', () => {
  it('brings every byte back past the masker', async () => {
    const run = await execution.exec(throughDataChannel(printPayload));
    expect(run.exitCode).toBe(0);
    expect(fromDataChannel(run.stdout)).toEqual({ ok: true, text: PAYLOAD });
  });

  it('keeps the command\'s exit code and what it printed before it failed', async () => {
    const run = await execution.exec(throughDataChannel(`printf 'partial'; exit 3`));
    expect(run.exitCode).toBe(3);
    expect(fromDataChannel(run.stdout)).toEqual({ ok: true, text: 'partial' });
  });

  it('leaves stderr as words', async () => {
    const run = await execution.exec(throughDataChannel(`echo 'could not: why' >&2; printf ok`));
    expect(run.stderr).toBe('could not: why');
    expect(fromDataChannel(run.stdout)).toEqual({ ok: true, text: 'ok' });
  });

  it('says a channel that came back as anything but its encoding, and reads none of it', () => {
    expect(fromDataChannel('6869')).toEqual({ ok: true, text: 'hi' });
    expect(fromDataChannel('')).toEqual({ ok: true, text: '' });
    const rewritten = fromDataChannel('7b22746f6b656e223a [REDACTED]');
    expect(rewritten.ok).toBe(false);
    expect((rewritten as { because: string }).because).toMatch(/not hex/);
    expect(fromDataChannel('686')).toMatchObject({ ok: false, because: expect.stringMatching(/odd length/) });
  });
});

describe('a refused deployment names who holds the node', () => {
  const held = `printf '%s\\n' ${shellEscape(`HELD 12\t${RECORD}`)}`;

  it('could not, through the masked transport', async () => {
    const answer = parseAcquire('37.27.130.185:22', (await execution.exec(held)).stdout);
    expect(answer).toMatchObject({ kind: 'held', holder: null });
  });

  it('does, through the lease runner', async () => {
    // A node whose SSH is this machine's shell through the same engine: the
    // lease script's answer as the node prints it, masked or not as the
    // transport does.
    const deployer: any = new RemoteDeployer(quiet, {
      ssh: async (_target: unknown, command: string) => {
        const wrapped = command.startsWith('out=$(sh -c ');
        return execution.exec(wrapped ? throughDataChannel(held) : held);
      },
    } as never);

    const answer = parseAcquire('37.27.130.185:22', await deployer.leaseRunner({ host: '37.27.130.185' })('the lease script'));

    expect(answer).toMatchObject({ kind: 'held', idleSec: 12, holder: { holder: 'omnitron@laptop pid 4242', stack: 'daos/test' } });
    const refusal = new LeaseHeldError('37.27.130.185:22', (answer as { holder: never }).holder, 12, 300);
    expect(refusal.message).toMatch(/being deployed by omnitron@laptop pid 4242 \(deploying daos\/test, since 2026-09-23T18:04:13Z\)/);
  });
});
