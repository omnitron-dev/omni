# @omnitron-dev/titan-storage

Object storage for Titan applications through one interface with S3 and local filesystem adapters.

## Capabilities

- Object reads and writes, ranges, metadata, listing and copying.
- Multipart uploads and bulk deletion.
- Only the selected backend is instantiated.

## Quick start

```sh
pnpm add @omnitron-dev/titan-storage
```

```ts
import { StorageModule } from '@omnitron-dev/titan-storage';

export const storage = StorageModule.forRoot({ backend: 'local' });
```

Add this dynamic module to the `imports` of an existing Titan application.

Provide Titan config and logger modules, then inject `STORAGE_ADAPTER`. Configure `storage.local.basePath` explicitly for durable data; the default is `./data/storage` relative to the application directory. The first storage operation initializes the local root.

For S3, select `backend: 's3'` and configure `storage.s3`. Applications own authorization, quotas, content validation and retention. Local multipart bookkeeping is process-local; use S3 when sessions must survive process restarts or span instances. Permission and I/O errors remain errors; only a missing object means absence.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
