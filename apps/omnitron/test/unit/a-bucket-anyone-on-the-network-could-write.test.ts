/**
 * A bucket anyone on the network could write.
 *
 * The MinIO preset ended every bucket's provisioning with
 * `mc anonymous set public` — anonymous read AND write to anything that could
 * reach :9000, which is every container on the stack's network, past the
 * storage service's moderation, metadata scrubbing and safe delivery.
 * Nothing needs it: the storage service signs its requests, the gateway has
 * no route to MinIO, the port is published on loopback. Found reading the
 * platform for ad creatives, 2026-09-23.
 *
 * Now `none`, on every provisioning, so a bucket made public by an earlier
 * version is closed; and a failure to close it is an error, not a warning
 * folded into «Failed to create bucket».
 */

import { describe, expect, it, vi } from 'vitest';

import { minioPreset } from '../../src/infrastructure/presets/minio.js';

function provisioning(fail: (argv: string[]) => boolean = () => false) {
  const ran: string[][] = [];
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx: any = {
    userConfig: { buckets: ['storage'] },
    secrets: { accessKey: 'a', secretKey: 's' },
    logger,
    execInContainer: async (argv: string[]) => {
      ran.push(argv);
      if (fail(argv)) throw new Error('mc: <ERROR> Unable to set anonymous');
      return '';
    },
  };
  return { ctx, ran, logger };
}

describe('a MinIO bucket', () => {
  it('is left with no anonymous access, and never made public', async () => {
    const p = provisioning();
    await minioPreset.postProvision!(p.ctx);

    expect(p.ran).toContainEqual(['mc', 'anonymous', 'set', 'none', 'local/storage']);
    expect(p.ran.some((argv) => argv.includes('public'))).toBe(false);
    expect(p.logger.error).not.toHaveBeenCalled();
  });

  it('says it at error level when the policy could not be closed', async () => {
    const p = provisioning((argv) => argv[1] === 'anonymous');
    await minioPreset.postProvision!(p.ctx);

    expect(p.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'storage' }),
      expect.stringMatching(/Could not close anonymous access/),
    );
  });

  it('does not set a policy on a bucket it could not create', async () => {
    const p = provisioning((argv) => argv[1] === 'mb');
    await minioPreset.postProvision!(p.ctx);

    expect(p.ran.some((argv) => argv[1] === 'anonymous')).toBe(false);
    expect(p.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'storage' }), 'Failed to create bucket');
  });
});
