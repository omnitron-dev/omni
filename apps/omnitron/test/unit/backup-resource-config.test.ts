import { describe, expect, it } from 'vitest';
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';

const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };
describe('backup resources use the provisioner configuration', () => {
  it('resolves buckets and credentials from a preset-only MinIO declaration', () => {
    const infra = new InfrastructureService(logger as never, { services: {
      minio: { preset: 'minio', ports: { api: 9350 }, secrets: { accessKey: 'preset-user', secretKey: 'preset-secret' }, config: { buckets: ['uploads', 'storage', 'uploads'] } },
    } });
    expect(infra.getMinioBuckets()).toEqual(['uploads', 'storage']);
    expect(infra.getConnectionInfo('minio')).toMatchObject({ endpoint: 'http://127.0.0.1:9350', accessKey: 'preset-user', secretKey: 'preset-secret' });
  });
  it('follows the normalized service when it overrides legacy values', () => {
    const infra = new InfrastructureService(logger as never, {
      minio: { ports: { api: 9100 }, accessKey: 'old-user', secretKey: 'old-secret', buckets: ['old-bucket'] },
      services: { minio: { preset: 'minio', ports: { api: 9350 }, secrets: { accessKey: 'new-user', secretKey: 'new-secret' }, config: { buckets: ['new-bucket'] } } },
    });
    expect(infra.getMinioBuckets()).toEqual(['new-bucket']);
    expect(infra.getConnectionInfo('minio')).toMatchObject({ endpoint: 'http://127.0.0.1:9350', accessKey: 'new-user', secretKey: 'new-secret' });
  });
});
