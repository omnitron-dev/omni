# Shared SAMPLE/Consumer infrastructure verification

Canonical source: Titan. Extraction baseline in SAMPLE:
`cc7cb7fa10e339835c3cbd8a3d4580ecd84820aa`.

The Local/S3 adapter interfaces and operations are preserved. SAMPLE compatibility
imports forward to this package; its storage service, quotas, sharing, grants,
metadata and original tests remain in SAMPLE. The only adapter lifecycle addition
is destruction of the S3 client. StorageModule instantiates only the selected
backend. Local multipart bookkeeping is process-local; S3 is used by Consumer.

The same extraction moves the browser-safe role hierarchy and permission engine
into `@omnitron-dev/titan-auth/access`. SAMPLE frontend/backend and Consumer use that
implementation. Application permission catalogs and authority decisions remain
at their respective boundaries. No S2S role becomes an assignable platform role.

Validation on 2026-10-24:

- Titan Auth: 64 tests; typecheck and build passed.
- Compatibility against immutable SAMPLE source: 936 comparisons passed using
  `node packages/titan-auth/scripts/check-access-compatibility.mjs SAMPLE_PATH BASELINE`.
- Titan Storage: 35 original local/batch tests plus 30 real S3 adapter integration
  tests on a disposable MinIO bucket; typecheck/build passed. This verifies
  operations, not claims of unlimited scale or durability during hardware failure.
- SAMPLE unchanged permission tests: 12 passed. Original storage tests: 35 passed;
  auth-utils and storage typechecks passed. No SAMPLE services were restarted.
- Consumer's separate disposable-database integration suite verifies authorization,
  image publication, CAS conflicts, native Netron HTTP, durable cleanup and
  session revocation against actual PostgreSQL/MinIO, without a mail worker.

Portable distribution before the next package publication uses checked-in
archives in each consumer. No new absolute dependency link is required:

| Package | Archive SHA256 |
| --- | --- |
| titan-auth | `bb2ab1448aa1b3c177c286977643cb6d58d91903539ac783cf7ca157b2039577` |
| titan-storage | `84c83faac3d1642dbf6e66ff350ed49f17cb1cca4aa502935aea4111b8688136` |

Separate UI packaging check: Scrollbar is exported from Prism's lightweight
`/ui` surface. Importing `/components` had eagerly included MapLibre and Tiptap
in Consumer's shell (1596.10 kB minified); the same shell is 28.09 kB through `/ui`.
No functionality, threshold or test was removed. This is a bundle-size check,
not a browser responsiveness benchmark. Prism build and the final Consumer build
and 153 unit/property/UI tests pass. SAMPLE uses its existing Prism dev link.
