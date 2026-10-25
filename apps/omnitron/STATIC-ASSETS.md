# Immutable assets across application releases

A tab retains its entry module and may request its lazy modules long after the application
changes releases. Retaining release directories alone does not preserve those URLs if the
reader only serves the current release's `assets` directory.

The existing `RemoteDeployer.carryPreviousBuildForward` has an explicit owner-scoped overload,
exported through `@omnitron-dev/omnitron/operations`:

```ts
const receipt = await deployer.carryPreviousBuildForward(target, {
  owner: { project: 'project', stack: 'production', app: 'api' },
  sources: [{ root: '/immutable/release/dist/web/assets', files: { 'entry-hash.js': sha256 } }],
});
```

`StaticAssetSource.files` maps every relative file in that source directory to its full SHA256.
The input must include complete directories, not a selection of their files. Source directories
and all parent components must be canonical, without symlinks. Only regular public asset files
are accepted. The application adapter selects its own admitted release sources and verifies its
release receipts; the generic publisher does not infer application ownership from an arbitrary
filesystem path.

`immutableAssetsRoot(owner)` derives the fixed directory
`/opt/omnitron/stack-static/assets/<project>/<stack>/<app>/public`. Owner components are validated.
The receipt contains `assetsRoot`, `manifestSha256`, `files`, `bytes`, `added`, and `reused`.
`files` and `bytes` describe the entire retained pool; `added` and `reused` describe distinct
requested assets in this operation. The manifest and incomplete-operation record stay outside
`public`. Readers must expose only their own public directory, never the parent storage tree.

All writers enter the existing native node lease and exclusive command execution fence, including
reentrant deployment calls. Publication copies bytes to private staging, verifies source digests,
checks every retained asset and rejects URL collisions before changing the public directory.
Staged files are fsynced and atomically renamed only after confirming the destination is absent
under that exclusive fence. No source inode is linked. Directory updates and the final manifest
are fsynced. Identical URLs must retain identical bytes; ordinary failure never overwrites them.
This serialization guarantee covers native publishers, not arbitrary privileged filesystem writers.

A durable pending manifest retains the original validated source descriptors privately. Even when
the next caller supplies a different release, the publisher first completes the original batch,
rechecking its source bytes and retained files. Changed or absent incomplete source bytes refuse
recovery. A fully published batch can be finalized without its source directories. Losing the
acknowledgement of a completed operation is safe to retry. The native lease's separate unresolved-execution
recovery still applies after a lost process/controller; this API does not bypass that barrier.
No automatic deletion or TTL is applied to the pool.

Call publication after immutable release staging and before quiescing or activating an application.
For the first migration, import current/fresh and retained previously admitted release asset
manifests. Serve `/assets/*` from the pool, while HTML and other public documents stay attached
to the selected release. Successful assets retain immutable caching; missing assets require
`Cache-Control: no-store` and a real 404, never an HTML SPA fallback. Existing CDN negative cache
entries may survive this header change until invalidated or expired and must be checked separately.
A rollback to a legacy reader that does not use the pool cannot promise asset continuity; retain
that limitation explicitly until the recovery release also understands the pool.

The older positional overload used by `uploadStaticBundle` retains its previous one-generation,
best-effort gateway behavior. It is not the guarantee described above. No new daemon API,
shared-ingress mount, service restart, or automatic host framework upgrade is introduced.

Tests execute the destination program against real temporary files, including three generations,
rollback, unchanged source inodes, collisions, incomplete manifests, symlink refusal, interrupted
publication and lost acknowledgements. A real HTTP ESM loader retains an old entry and executes
its lazy/shared graph after publication; the release-only reader produces HTTP404 first. The
native execution-fence tests separately exercise Linux exclusion and process failure behavior.
These tests complement application-reader tests and actual browser acceptance; they do not
substitute for either.
