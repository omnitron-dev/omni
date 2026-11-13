# Native runtime fixtures

`managed-backend.mjs` exercises the ordinary managed backend and guardian transition,
recovery and rollback paths with disposable sealed runtimes. Its private application
must retain its PID and continue serving HTTP; owner RPC, migration history and the
complete log stream are checked independently. Unit ownership guards restrict cleanup
to the fixture's exact native service files and identities.

The ordinary invocation prepares and runs the scenario in one process. For a costly
runtime installation, the same fixture can prepare first and execute later:

```sh
node managed-backend.mjs "$OWNER_DIST" "$CANDIDATE_DIST" \
  --initial-backend "$BACKEND_DIST" --initial-guardian "$GUARDIAN_DIST" \
  --prepare-only

node managed-backend.mjs "$OWNER_DIST" "$CANDIDATE_DIST" \
  --initial-backend "$BACKEND_DIST" --initial-guardian "$GUARDIAN_DIST" \
  --prepared "$RECEIPT"
```

Run these through the repository's Xec orchestration with `TMPDIR` on the development
volume. Each input is `packages/0/dist` inside a physical disposable
`omnitron-handoff-*` runtime. Preparation prints the exact `preparation.json` path;
it installs every distinct role, including the candidate, before creating ports or
services. The receipt records root identity, runtime hashes/builds, Node/platform,
fixture/helper hashes and installation timings. It is preparation evidence, not a
successful transition or authorization to activate a live service.

Execution requires the same inputs, host and fixture bytes. It claims the receipt
once with `O_EXCL`, rejects existing service/process/socket or execution state, then
fully verifies the installed runtime digests and executable preflights. It runs the
same transition and availability assertions using those private copies. A failed or
interrupted execution remains consumed; do not remove its marker, reset its registry,
or use its directory as a fresh fixture. Failed directories are retained for diagnosis;
successful runs remove only their identity-checked root unless artifact retention is
explicitly enabled.

Split preparation is restricted to the ordinary scenario. The master, application-SDK,
owner-roundtrip and backend-only scenarios continue to use their one-shot invocation.
The HTTP/RPC, readiness and child preflight deadlines are unchanged. Preparation is
safe to run without native lifecycle authority; execution deliberately performs private
service transitions and crash recovery and requires that authority separately.

For two sealed runtimes that implement reviewed cold stack admission, run
`managed-backend.mjs <previous-dist> <candidate-dist> --local-sync-roundtrip`
with the checkout's Node and `--import tsx`. The private launchd/systemd fixture
starts an enabled working-tree stack through ordinary automatic boot in both
directions. Its reviewing domain client exits after startup and before acceptance.
The next client reads the incomplete receipt, recovers its digest, then checks
the same rollback receipt a second time. The fixture records owner lifetimes,
application generations, native artifact hashes and both durable claims.

`runtime-update.test.mjs` exercises the shared Omnitron state machine with real
private process generations, kernel exclusion and lost restoration replies.
`runtime-update-cli.test.mjs` exercises the public CLI, artifact verification,
typed status and exact candidate delegation without starting native services.
The managed roundtrip uses unique fixture service labels through its host
driver. The production host adapter addresses standard user services, so the
roundtrip does not cover that adapter through the public CLI on a shared account.
