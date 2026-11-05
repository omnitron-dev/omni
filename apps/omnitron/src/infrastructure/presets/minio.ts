/**
 * MinIO / S3-Compatible Storage Preset
 *
 * For dev/test: provisions MinIO container.
 * For prod: use external S3 (AWS S3, DigitalOcean Spaces, Wasabi)
 * via stack serviceOverrides with `external` config.
 */

import { describeError } from '@omnitron-dev/titan/diagnostics';
import type { IServicePreset, IPostProvisionContext } from './types.js';

export const minioPreset: IServicePreset = {
  name: 'minio',
  type: 'storage',
  /**
   * quay.io, and pinned.
   *
   * `minio/minio` on Docker Hub answers `pull access denied ... repository
   * does not exist or may require 'docker login'` — for `:latest` and for an
   * exact RELEASE tag alike. The image is still in the local cache of every
   * machine that pulled it before the change, which is why nothing noticed:
   * the development host runs it happily and a NEW node cannot get it at
   * all. Measured provisioning the test server, where MinIO was the one
   * service of three that did not come up.
   *
   * Pinned rather than `:latest`, because an unpinned tag is how this
   * arrived: a config that names no version cannot be reasoned about after
   * the registry changes under it, and "it worked yesterday" stops being
   * evidence of anything.
   */
  defaultImage: 'quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z',
  defaultPorts: { api: 9000, console: 9001 },
  defaultSecrets: { accessKey: 'minioadmin', secretKey: 'minioadmin' },

  defaultHealthCheck: {
    type: 'command',
    target: 'mc ready local',
    interval: '10s',
    timeout: '5s',
    retries: 5,
  },

  defaultDocker: {
    command: ['server', '/data', '--console-address', ':9001'],
    environment: {
      MINIO_ROOT_USER: '${secret:accessKey}',
      MINIO_ROOT_PASSWORD: '${secret:secretKey}',
    },
    volumes: {
      data: { target: '/data', source: '' },
    },
  },

  async postProvision(ctx: IPostProvisionContext): Promise<void> {
    const buckets = ctx.userConfig['buckets'] as string[] | undefined;
    if (buckets === undefined) return;

    const accessKey = ctx.secrets['accessKey'] ?? 'minioadmin';
    const secretKey = ctx.secrets['secretKey'] ?? 'minioadmin';

    if (!Array.isArray(buckets) || buckets.some(bucket => typeof bucket !== 'string' ||
        !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..') || /^[0-9.]+$/.test(bucket)))
      throw new Error('MinIO buckets must be valid S3 bucket names');
    if (buckets.length === 0) return;
    await ctx.execInContainer(['mc', 'alias', 'set', 'local', 'http://localhost:9000', accessKey, secretKey]);
    const failures: Error[] = [];
    for (const bucket of new Set(buckets)) {
      try {
        await ctx.execInContainer(['mc', 'mb', '--ignore-existing', `local/${bucket}`]);
        // Required on every provisioning, including buckets left public by older versions.
        await ctx.execInContainer(['mc', 'anonymous', 'set', 'none', `local/${bucket}`]);
        ctx.logger.info({ bucket, anonymous: 'none' }, 'MinIO bucket ready — no anonymous access');
      } catch (error) {
        failures.push(new Error(`Bucket '${bucket}' could not be prepared with anonymous access disabled: ${describeError(error)}`));
      }
    }
    if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '));
  },

  generateEnvTemplates(): Record<string, string> {
    return {
      S3_ENDPOINT: 'http://${host}:${port:api}',
      S3_ACCESS_KEY: '${secret:accessKey}',
      S3_SECRET_KEY: '${secret:secretKey}',
    };
  },
};
