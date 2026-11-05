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

  it('refuses readiness when the policy could not be closed', async () => {
    const p = provisioning((argv) => argv[1] === 'anonymous');
    await expect(minioPreset.postProvision!(p.ctx)).rejects.toThrow("Bucket 'storage'");
    expect(p.logger.info).not.toHaveBeenCalled();
  });

  it('does not set a policy on a bucket it could not create', async () => {
    const p = provisioning((argv) => argv[1] === 'mb');
    await expect(minioPreset.postProvision!(p.ctx)).rejects.toThrow("Bucket 'storage'");

    expect(p.ran.some((argv) => argv[1] === 'anonymous')).toBe(false);
    expect(p.logger.info).not.toHaveBeenCalled();
  });
  it.each([['../outside'], ['x'], ['a/b'], ['192.168.1.1'], 'storage'].map(buckets => ({ buckets })))('refuses invalid bucket declarations $buckets before any command', async ({ buckets }) => {
    const p = provisioning(); p.ctx.userConfig.buckets = buckets;
    await expect(minioPreset.postProvision!(p.ctx)).rejects.toThrow('bucket names');
    expect(p.ran).toEqual([]);
  });
  it('still closes other buckets while reporting every failed declaration', async () => {
    const p = provisioning(argv => argv.includes('local/failed'));
    p.ctx.userConfig.buckets = ['failed', 'storage', 'storage'];
    await expect(minioPreset.postProvision!(p.ctx)).rejects.toThrow("Bucket 'failed'");
    expect(p.ran.filter(argv => argv[1] === 'alias')).toHaveLength(1);
    expect(p.ran.filter(argv => argv[1] === 'anonymous')).toEqual([['mc', 'anonymous', 'set', 'none', 'local/storage']]);
  });
});
