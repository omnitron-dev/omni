# Verifying an Omnitron change

An engineer or an agent can propose a change. Someone reviewing it should be able to name the property it preserves, run an independent check, and locate the first observable disagreement. The same evidence should answer an operator who sees an unexpected outcome after deployment.

## Start with an observable contract

For a codec the contract includes bytes consumed and the position of the next frame. For a pipeline it includes the reviewed identity, durable audit intent, run status and effects visible to the application. For a migration it includes what previous readers can read after the first committed write. A successful process exit answers only one part of each question.

| Boundary | Independent expectation | Observe through the ordinary path |
| --- | --- | --- |
| MessagePack | Reference codec, format thresholds, FIFO order and accumulated frame lengths | Encode, deliver fragments, peek, consume, inspect the next frame |
| Agent-issued pipeline | Two request identities, review state, audit availability and expected external effect count | MCP call, Netron service, durable run and audit rows, Xec child output |
| Declarative pipeline | Authored field names, available graph vertices, acyclic dependencies | Check the local definition, submit through the service, compare saved revision and runtime receipt |

The two executable profiles report their actual bounds, counts and verdict. A single replay checks only its ordered trace. An interrupted fixture or an exhausted budget produces an inconclusive result. A difference records the first divergent prefix encountered. Profile data is synthetic and safe to log. [Commands and profiles](README.md)

### What issue #1 exposed

The original object-map test stopped at 65,535 pairs. That is the last count representable in a two-byte length. Array and large-payload tests exercised other encoding paths. Encoding a value and immediately decoding it with the same library also lets both sides agree on an incorrect convention. The current map suite checks legal wire representations independently of the encoder, checks exact stream consumption, and crosses the representation boundary in both directions. A separate decode benchmark consumes bytes prepared before the timed loop. [Issue #1](https://github.com/omnitron-dev/omni/issues/1) · [Format tests](../../packages/msgpack/test/map-framing.test.ts) · [Benchmark](../../packages/msgpack/bench/serializer.js)

Use that distinction during review. Write down what changes representation, owner, transaction or lifetime. Cover both sides, an independent reader, and what the next operation sees. For example, compare the durable effect and the reply after retrying a reviewed request. Averaging the timings of successful requests cannot detect a duplicated effect.

## From a generated graph to an operator receipt

1. Run `omnitron pipeline check definition.json --json` before registration. Keep the SHA-256 of the input bytes and the reported graph. The scope of this receipt is the local definition.
2. Save the definition and use its current revision to prepare a run. Retain the caller-generated run ID and the returned review digest before requesting execution. The file hash identifies the input text. The revision and digest identify runtime decisions.
3. At execution, the service checks authority and the bound request against its state. After a lost reply, query that run ID. Use reconciliation and the recorded recovery review before resuming interrupted work. An uncertain external effect stays uncertain until its owner provides evidence.
4. Compare a failure with a replay in a fresh fixture. Use synthetic observations in sharable receipts. Keep payloads, credentials and application output in the operator's own diagnostic boundary. [Pipeline lifecycle and commands](../../apps/omnitron/README.md#pipelines-pinned-to-releases)

## Extending assurance beyond the current profiles

The following domains have different proof obligations. A bounded test receipt can accompany a domain proof. Its scope must stay visible to the next consumer.

| Domain | Property to specify | Evidence needed to add support |
| --- | --- | --- |
| Agent permissions and recovery | Each effect belongs to an admitted intent and actor. A repeated request has one durable outcome. | Extend the existing pipeline profile to restarts and cancellation. Compare an independent state machine with the journal and a separately observed effect. |
| Zero-knowledge compilation | The source and optimized circuit admit the same public statement and valid witnesses under stated field and range assumptions. | Bind the circuit, public-input schema, compiler, verifier, assumptions and certificate to exact artifacts. Check the certificate independently. Measure prover cost separately. |
| Financial state transitions | Transfers, fees and issuance reconcile per asset across transactions, rounding and reversal. | Execute synthetic ledger operations and compare state and receipts with a small accounting model. Specify which balances an invariant covers and the assumptions about external contracts. |
| End-user synthesis | A generated transformation preserves the requested data, types, units, filters and grouping. | Evaluate a small declarative example against independent input/output fixtures. Present the resulting graph and preview for review before granting execution authority. |

Tabby applies synthesis and semantic verification to optimize circuit components. Tessel studies circuit layout. These are distinct from checking that an application's specification captures its intended statement. Contract verification likewise depends on explicitly stated invariants and assumptions. Vega-Lite illustrates how a declarative visualization specification can drive compilation. These are research directions for additional Omnitron checkers. [Tabby](https://2025.splashcon.org/details/OOPSLA/131/Tabby-A-Synthesis-Aided-Compiler-for-High-Performance-Zero-Knowledge-Proof-Circuits) · [Tessel](https://escholarship.org/uc/item/2cq383hw) · [Contract invariants](https://docs.certora.com/en/latest/docs/ref-manual/cvl/invariants.html) · [Vega-Lite](https://vis.csail.mit.edu/pubs/vega-lite/)

Run bounded profiles on affected source changes and keep exact replays for diagnosed defects. Execute expensive domain proofs on immutable artifacts. Before reusing a proof, a consumer needs the checked artifact, specification, checker version, environment assumptions and verdict. A change in any of these invalidates the correspondence. Runtime authorization and current target state still belong to the executing service.
