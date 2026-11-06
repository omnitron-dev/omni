# Read-only release artifact inspection

`inspectReleaseArtifact` is exported by the existing public
`@omnitron-dev/omnitron/release-archive` entry point. It checks an artifact in a
release store and returns integrity evidence and optionally selected bytes.
It does not install, launch, import or evaluate the application, require an
execution owner, or create an installed-release receipt.

```ts
import { inspectReleaseArtifact } from '@omnitron-dev/omnitron/release-archive';

// Supplied by the caller's separately trusted release selection, not read from this store.
const trustedManifestSha256 = '...expected full SHA-256...';
const inspection = await inspectReleaseArtifact('release-id', 'api', {
  releasesRoot: '/physical/path/to/releases',
  files: [
    { path: 'dist/native/service' },
    { path: 'dist/native/asset.json', includeContents: true },
    { path: 'static/index.html' },
    { path: 'dist/migrations.js', includeContents: true },
  ],
});
if (inspection.manifestSha256 !== trustedManifestSha256) {
  throw new Error('Inspected manifest differs from the trusted release selection');
}
// Only now accept the integrity evidence or interpret explicitly requested bytes.
```

Omitting `releasesRoot` uses the normal Omnitron release store. A caller must compare the returned manifest digest with its independently
trusted expected pin before accepting the result. Computing that pin from the
same untrusted store would not establish trust. The application
name is the selected release's consumer alias. Imported artifacts retain the
original producer manifest, its exact digest, original application name and
ordered origin chain in `inspection.producer`.

The launch is always verified and appears first in `inspection.files`, once.
Other members follow request order. Any physical regular member can be checked,
including native binaries, JSON and HTML. Symlink files and symlink parent
aliases are refused for requested members. Dependency links remain subject to
the existing frozen closure verifier.

Each file returns its package-relative `path`, SHA-256 and byte size. Contents
are absent by default: hashing is streamed. `includeContents: true` returns an
exact `Buffer`, bounded to 4 MiB per file and 16 MiB across the request. At most
64 distinct additional member requests are accepted. Requests are copied before
asynchronous work so later caller mutation cannot change the checked selection.
These bytes remain untrusted application input; this API does not interpret
migration declarations or authorize the caller to execute them.

The verification path is shared with deployment:

1. `loadRelease` checks the exact manifest bytes, all archive hashes and sizes,
   and `validateReleaseOrigins` checks embedded producer evidence.
2. The selected archive is copied into a fresh private temporary directory.
   Its copied SHA-256 and size must match the admitted artifact.
3. `extractFrozenArchive` applies the existing member, link and size limits.
4. `verifyFrozenApplication` verifies the launch, closure and complete payload
   against the **producer manifest's target**, never the inspector host. The
   closure's declared Node options must pass the existing resource-option policy.
5. Selected regular files are read or hashed; the closure is reverified before
   returning. The temporary directory is removed in `finally` on success/failure.

A static-only artifact may instead carry an artifact-level `closureSha256`; the
same payload verifier checks it without inventing or evaluating a launch. Its
result contains only explicitly requested files. Executable artifacts retain
launch-first inspection and adapter checks. An artifact without either closure
binding, a supported closure protocol or a complete recorded target is refused. There is no installed-tree, developer
checkout, current-host or legacy-archive fallback. Bootstrap adapter resolution
uses the shared verifier and does not evaluate the adapter or application.

This is integrity inspection, not deployment admission: it does not judge gate
outcomes, infrastructure readiness, migration safety, provenance trustworthiness
beyond the recorded hashes, or compatibility with an execution owner. Matching
metadata is not proof of application behavior. Source files and the release store
are not changed; only private temporary copies are written.

Resource limits of the existing verifier still apply: up to 200,000 members,
256 MiB per file and 2 GiB per extracted tree, and the tree-walk deadline. The
shared tree verifier currently reads individual files into memory; the new
streaming file evidence does not remove that existing cost. `loadRelease` checks
all archives in the selected release before inspection of the selected app. A
missing or corrupt unrelated archive therefore also refuses this inspection.

Focused validation covers the public export, foreign and imported targets,
exact manifest/closure/file evidence, no application evaluation, symlink/path
refusals, altered archives/payload/closure, legacy refusal, opt-in bounds,
request mutation and cleanup. These unit fixtures are not a production release
admission or a deployment test.
