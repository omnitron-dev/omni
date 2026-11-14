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

To qualify the retained-configuration runtime update, use the final candidate's
fixture source and independently sealed role artifacts:

```sh
TMPDIR="$PRIVATE_AGI_TMP" OMNITRON_KEEP_TEST_ARTIFACTS=1 \
  node --import tsx apps/omnitron/test/runtime/managed-backend.mjs \
  "$OWNER_DIST" "$CANDIDATE_DIST" \
  --initial-backend "$BACKEND_DIST" --initial-guardian "$GUARDIAN_DIST" \
  --local-sync-roundtrip
```

The candidate must implement `runtimeRestartProtocol@1` and reviewed cold stack
admission. The previous owner and guardian must differ from the candidate. Set
`OWNER_DIST` and `GUARDIAN_DIST` to the actual previous owner artifact, and
`BACKEND_DIST` to the independently selected previous backend. Each remains a
physical disposable `omnitron-handoff-*` runtime, not the live installation.
Keep the private temporary parent short enough for the Unix control socket limit.

The fixture first performs a checked warm backend upgrade. It verifies that the
old owner, guardian and application generation survive, then captures the real
private `runtimeRestart` configuration. `plan.before` records those actual warmed
roles. The private launchd/systemd jobs then replace the owner and automatically
start the enabled working-tree stack from that retained intent. The reviewing
client exits after startup and before acceptance. Recovery starts the old owner
under the candidate controller, restores the old guardian through the canonical
durable guardian transaction, and verifies the same retained launch definitions.
The fixture loses the completed guardian reply and repeats recovery, checking that
the transaction, owner and application generation are reused.

After the cold receipt is `rolled-back`, a separate checked warm backend rollback
returns to `BACKEND_DIST` without changing the restored owner or application
generation. This final operation is explicitly outside the cold receipt. The
`local-sync-roundtrip.json` evidence records both stages, owner lifetimes, native
artifact hashes, retained configuration digest, application generations and durable
claims; it contains no retained environment values.

`runtime-update.test.mjs` exercises the shared Omnitron state machine with real
private process generations, kernel exclusion and lost restoration replies.
`runtime-update-cli.test.mjs` exercises the public CLI, artifact verification,
typed status and exact candidate delegation without starting native services.
The managed roundtrip uses `runRuntimeUpdate`, real native jobs and the shared
`restoreRuntimeRoles` helper, with unique fixture service labels through its host
driver. The production host adapter addresses standard user services, so the
roundtrip does not cover that adapter through the public CLI on a shared account.
The release qualification workflow currently runs `--owner-roundtrip`; it does
not implicitly run this retained-configuration scenario. Its native execution is
separate evidence from the journal and CLI delegation tests.
