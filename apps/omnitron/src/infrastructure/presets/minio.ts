/**
 * MinIO / S3-Compatible Storage Preset
 *
 * For dev/test: provisions MinIO container.
 * For prod: use external S3 (AWS S3, DigitalOcean Spaces, Wasabi)
 * via stack serviceOverrides with `external` config.
 */

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
    if (!buckets?.length) return;

    const accessKey = ctx.secrets['accessKey'] ?? 'minioadmin';
    const secretKey = ctx.secrets['secretKey'] ?? 'minioadmin';

    for (const bucket of buckets) {
      try {
        await ctx.execInContainer([
          'mc', 'alias', 'set', 'local',
          'http://localhost:9000', accessKey, secretKey,
        ]);
        await ctx.execInContainer(['mc', 'mb', '--ignore-existing', `local/${bucket}`]);
        await ctx.execInContainer(['mc', 'anonymous', 'set', 'public', `local/${bucket}`]);
        ctx.logger.info({ bucket }, 'Created MinIO bucket');
      } catch (err) {
        ctx.logger.warn({ bucket, error: (err as Error).message }, 'Failed to create bucket');
      }
    }
  },

  generateEnvTemplates(): Record<string, string> {
    return {
      S3_ENDPOINT: 'http://${host}:${port:api}',
      S3_ACCESS_KEY: '${secret:accessKey}',
      S3_SECRET_KEY: '${secret:secretKey}',
    };
  },
};
