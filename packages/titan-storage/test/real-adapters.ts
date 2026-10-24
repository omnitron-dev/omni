/**
 * The application's own storage adapters, built for an integration test.
 *
 * The adapter specs used to define `class TestS3Adapter` / `class
 * TestLocalAdapter implements StorageAdapter` in the test file and exercise
 * those — 151 tests against a real MinIO and a real filesystem, and not one
 * line of `src/storage/backend/`. A copy that passes proves the copy. These
 * build the real adapters the way the DI container does: config, a logger,
 * then `onInit()`.
 */
import { S3Adapter } from '../src/s3.adapter.js';
import { LocalAdapter } from '../src/local.adapter.js';

const silent = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silent; } };
const configWith = (key: string, value: unknown) => ({ get: (k: string) => (k === key ? value : undefined) });

export async function realS3Adapter(
  endpoint: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
): Promise<S3Adapter> {
  const s3 = { endpoint, accessKeyId, secretAccessKey, bucket, forcePathStyle: true, region: 'us-east-1' };
  const adapter = new S3Adapter(configWith('storage.s3', s3) as never, { logger: silent } as never);
  await adapter.onInit();
  return adapter;
}

export async function realLocalAdapter(basePath: string): Promise<LocalAdapter> {
  const adapter = new LocalAdapter(configWith('storage.local', { basePath }) as never, { logger: silent } as never);
  await adapter.onInit();
  return adapter;
}
