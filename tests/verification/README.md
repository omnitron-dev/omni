# Bounded model verification

The full workspace CI job retains both profiles' JSON receipts in the `verification-receipts` artifact. Each receipt identifies the checked commit, Node runtime, bounds and verdict. To retain receipts locally, set `OMNITRON_TEST_EVIDENCE_DIR` to a private directory. Concurrent runs write separate files. Include only public or synthetic observations in a model.

Run a profile from the repository root with Xec. The same test runs in its owning package's Vitest suite.

The platform assurance design sets out the evidence required for agent actions, circuit equivalence, contract state and typed transformations. [Assurance design](ASSURANCE.md)

```sh
pnpm exec xec verify-model pipeline
pnpm exec xec verify-model pipeline --replay '["alpha.prepare","beta.run","alpha.start","alpha.start"]'
pnpm exec xec verify-model pipeline --depth 2 --max-traces 40
pnpm exec xec verify-model msgpack
```

The JSON receipt records the scope, verdict, completed traces, attempted actions, observed states and elapsed time. A bounded match covers every model-enabled path up to the stated depth, including shorter terminal paths. Each fresh fixture is observed before its first action and after every action. Counts include prefixes executed in multiple fixtures. Replay checks the exact action names in the supplied order. A mismatch includes both public observations and the divergent prefix. An exhausted trace budget or failed fixture reports `inconclusive`. Both outcomes produce a nonzero command exit. A runner timeout or interruption leaves the affected run unverified.

## Reviewed pipeline execution

The two fixture definitions each append their own name to a private file. The model allows either command to request preparation or execution, and allows a start after that command has a receipt. Delivery can repeat. The mandatory audit store can become unavailable and recover between requests.

The implementation accepts a JSON-RPC `tools/call` on the MCP bridge, invokes the registered management tool, then reaches the pipeline service through the ordinary DaemonClient and Titan/Netron Unix transport. Production admission, auditing and Xec execute against fixture-owned SQLite, a private socket and local child processes. The oracle compares the returned review binding, the run history visible to a client, the persisted audit rows and the file append order. A repeated successful request adds an audit intent while the original command still has one run and one effect. A request refused for missing audit storage adds neither.

The default model has two stable command identities and serial delivery to quiescence. Concurrent starts, receiver crashes, PostgreSQL locking, remote launch receipts and other principals have separate integration tests. Neither the result nor its elapsed time characterizes those cases.

## Adding a profile

Import `verifyFiniteTraces` and `readTraceBounds` from `@omnitron-dev/testing/helpers`. Keep four pure functions with the owning test. `initial` defines the independent starting state, `enabled` enumerates legal action names, `step` defines their reference semantics and `project` selects the public observation. A separate fixture factory supplies `act`, `observe` and `close`. Only the action name crosses into the implementation. Choose replayable names and observations small enough to inspect in a mismatch receipt.

Declare the profile's default bounds beside its test. Pass `OMNITRON_MODEL_OPTIONS` through `readTraceBounds`, print the report with the profile name and require `matched` for a passing test. Register the owning package and test in the Xec command. Keep solver proofs, circuit cost measurements and domain-specific validity conditions with the backend that can actually establish them.
