# Shared infrastructure verification — 2026-10-24

This dated receipt records the original extraction checks. Current access policy
lives in `@omnitron-dev/access`; `titan-auth/access` remains a compatibility facade.
Application permission catalogs, object ownership, quotas and metadata remain
consumer responsibilities. Service identities are not assignable platform roles.

The storage extraction retained the Local/S3 interface and operations and added
S3 client teardown. Local multipart bookkeeping remains process-local. The
module initializes the selected backend.

Recorded validation on 2026-10-24:

- Titan Auth: 64 tests; typecheck and build passed.
- Immutable consumer-source comparison: 936 checks passed.
- Titan Storage: 35 local/batch tests and 30 S3 integration tests on a disposable
  MinIO bucket; typecheck and build passed.
- Consumer permission tests: 12 passed. Storage tests: 35 passed; auth-utils and
  storage typechecks passed. No running services were restarted.
- A separate disposable-database consumer suite covered authorization, image
  publication, CAS conflicts, native Netron HTTP, cleanup and session revocation.

The original distribution used checked-in package archives:

| Package | Archive SHA256 |
| --- | --- |
| titan-auth | `bb2ab1448aa1b3c177c286977643cb6d58d91903539ac783cf7ca157b2039577` |
| titan-storage | `84c83faac3d1642dbf6e66ff350ed49f17cb1cca4aa502935aea4111b8688136` |

The original UI packaging comparison measured a consumer shell at 1,596.10 kB
minified through Prism `/components` and 28.09 kB through `/ui`. The final build
and 153 unit/property/UI tests passed. This was an isolated bundle comparison,
not a browser responsiveness benchmark or a claim about current package sizes.
