# Titan storage

A portable object-storage interface with S3 and local filesystem adapters.
Both backends support multipart uploads, ranges, metadata, bulk deletion,
copying and listing. Applications supply their own authorization, quotas,
sharing rules and metadata storage.

Import `StorageModule.forRoot({ backend: 's3' })` and inject `STORAGE_ADAPTER`.
Titan config supplies `storage.s3` (endpoint, bucket, credentials, region,
forcePathStyle and connection limits); the adapter also supports Omnitron's
`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` environment convention.
The local backend reads `storage.local.basePath`. Provide Titan config and logger
modules. Only the selected backend is instantiated; objects remain private until
an application explicitly grants access. Applications own authorization, metadata
transactions, content validation, quota policy and retention.

The existing local adapter's multipart bookkeeping is process-local; use S3 for
durable multipart sessions and deployments with multiple instances. Never expose
filesystem roots or arbitrary storage keys directly to untrusted callers.
