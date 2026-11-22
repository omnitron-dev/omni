# Recover a retired infrastructure allocation

An older node can remove every container named in its completed full stack stop while retaining the named volumes. Its recovery journal may contain an empty desired set. Releasing the stack's retirement marker resumes monitoring for the remaining declarations. It cannot reconstruct a declaration that the owner discarded. The source-return publisher verifies the original creation records before removal and can subsequently create stopped replacements on the same engine.

## Prepare the source declaration

Use the accepted project release and its original infrastructure resolver to produce one JSON object with `protocol: 1`, `project`, `stack`, `release`, `manifestSha256`, and `services`. Independently verify its complete SHA-256. Each service supplies the original full Docker container ID in `originalId`, the independently observed immutable image ID in `imageId`, and the release's native `ResolvedContainer` in `spec`. Preserve the original image reference and lexical mount paths. Schema-one hashes cover desired environment, commands, entrypoint, ports, mounts, health checks, network and restart policy. The publisher checks native mounts, resource controls, port exposure and security settings separately.

Represent each private environment field with `{"binding":"registered-reference"}`. An authorized provider for those exact references supplies a pipe or socket already open on the source. Its JSON envelope has `protocol`, `project`, `stack`, `declarationSha256`, and a `bindings` object. The header must match the independently selected file. The provider owns retrieval, scope admission and any authorized cross-host delivery. The publisher never opens a vault, reads container commands or environment, or requests different credentials after a refusal.

The three-field PostgreSQL, MinIO and Nominatim profile has a native two-owner provider. See [Historical binding approval](retained-bindings.md) for enrollment, match receipts and separate source-consumer authorization.

For a service with a native config digest, include `publicRoot` and `publicFiles` on its service row. Each public file has its absolute native path, SHA-256 and numeric permission mode from the admitted release. The verifier compares the complete list beneath each declared configuration mount and recomputes the historical config digest. Named-volume contents stay inside their services. An independently qualified, public-only startup archive can be bound by a top-level `supplement` containing `role`, `bytes`, `sha256` and an absolute `/usr/local/libexec/` entrypoint. Qualify the archive's complete file manifest, its entrypoint and the original image together before selecting it. The acknowledged replacement receives a fingerprint for the revised startup declaration.

## Verify and seal before retirement

```sh
xec retained-infrastructure review declaration.json --expect "$DECLARATION_SHA" \
  --runtime "$ORIGINAL_RUNTIME" --runtime-manifest "$ORIGINAL_MANIFEST_SHA" --bindings-fd 3

xec retained-infrastructure seal declaration.json --expect "$DECLARATION_SHA" \
  --runtime "$ORIGINAL_RUNTIME" --runtime-manifest "$ORIGINAL_MANIFEST_SHA" --bindings-fd 3 \
  --directory "$PRIVATE_SOURCE_STATE" --volume-root "$DOCKER_VOLUME_ROOT"
```

The runtime selection is the installed digest directory under the original owner's `runtime/releases`. The helper verifies its full frozen tree before executing the historical fingerprint implementation. The first command returns `matched`, `different`, or `binding-required` per service. Omit the private descriptor for an initial public comparison. **Every service must match before a seal can authorize physical retirement.** A missing provider or mismatched row leaves the allocation ineligible. Preserve the original bindings through the return window. The seal records the original fingerprints and physical identities in a private source-local file, without private values.

For example, a two-service review can record the following synthetic result. All identifiers and the unresolved reference belong to this example.

```json
{
  "protocol": 1,
  "project": "sample",
  "stack": "site",
  "release": "accepted-1",
  "manifestSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "declarationSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "services": { "cache": "matched", "store": "binding-required" },
  "eligible": false
}
```

Keep the actual immutable release, per-service results, run IDs, and digests of the registered observations in the private operation record. An incomplete review leaves the original allocation serving.

Select an existing operator-owned directory with mode 0700. The seal binds the engine's original local volumes to their directory identities, the declared bind roots and public files, the unchanged image tags and network IDs, and the native resource and security settings. Set `DOCKER_VOLUME_ROOT` to the same original engine's physical local volume directory. Add `--public-supplement <archive>` to both source operations when the declaration binds an archive. The supported Linux profile covers native local volumes, unprivileged containers and loopback TCP publication. An unsupported native control or missing physical root refuses the operation.

## Recreate after the source stop

First obtain the controller's confirmed full stack stop, its node operation ID, the independent receiver writer fence and the original placement admission. The cutover coordinator must establish that a return to the original data is still allowed. A source-local stop describes one source and cannot establish the receiver's write history. Keep the node under the writer fence while allocating the original restart policies, including across an engine restart.

```sh
xec retained-infrastructure create-stopped declaration.json --expect "$DECLARATION_SHA" \
  --runtime "$ORIGINAL_RUNTIME" --runtime-manifest "$ORIGINAL_MANIFEST_SHA" --bindings-fd 3 \
  --directory "$PRIVATE_SOURCE_STATE" --seal "$SEAL_SHA" --node-stop "$NODE_STOP"
```

The helper reopens the original owner's `data/daemon-state.db` read-only. The completed operation must include its reviewed app allocation, matching stopped apps, and every removed original ID and name. One source-local seal can own a node operation. The publisher issues Docker create with pulls disabled, the original names and recorded resources, and mounted existing volumes with initial image copying disabled. Private values travel to Docker through a pipe. It verifies each newly allocated ID and the stopped state, and can resume the same operation after a lost create reply. A different allocation or a running container refuses the operation.

The resulting receipt lists the new IDs and a running count of zero. Activation is a separately admitted normal source operation after the receiver's write fence. Check the service-specific database or storage identities and the session, signing and ingress conditions that govern this stack before releasing traffic. Registration selection, application processes and infrastructure have distinct native readbacks.

## Deliver to a legacy node

`xec retained-infrastructure bundle <new-directory>` writes a small public Node helper and its file manifest. Retain the manifest SHA-256 independently. Deliver those files and the public declaration through the registered Omnitron file transfer. Verify the manifest digest and every file entry on the original source before execution. The helper runs with the selected Linux Node and the existing owner, without a daemon installation.

```text
node source.mjs MODE DECLARATION DECLARATION_SHA ORIGINAL_RUNTIME RUNTIME_MANIFEST_SHA OPTIONS_JSON [BINDINGS_FD]
```

The options file contains paths and public operation selections. Use an empty object for review, `directory` and `volumeRoot` for seal, and `directory`, `seal` and `nodeStop` for create-stopped. A selected supplemental archive also requires `publicSupplement`. Keep its independently admitted bytes on the original host. Capture each operation's JSON output in the registered Pipeline receipt.

## Start one verified source container

`xec retained-infrastructure start-one request.json --expect "$REQUEST_SHA"` exports a manual Omnitron Pipeline for one service named in the receipt from `create-stopped`. Save, prepare, review and start it through the registered controller. Complete each service's application readiness checks before advancing to the next role. Use a fresh, separately reviewed request for each role. Existing installations of the eight-file passive helper can remain pinned to their accepted manifest.

The public request contains the following selections. `activation.test.js` includes complete neutral examples for both return branches.

| Fields | Required evidence |
| --- | --- |
| `protocol`, `project`, `stack`, `sourceNode`, `sourceFingerprint`, `receiverNode`, `receiverFingerprint` | Protocol 1, the original stack, and the two distinct registered nodes and trusted SSH host keys. The controller checks both pins and the current single source placement. |
| `nodeStop`, `declarationSha256`, `created`, `order`, `role`, `expires` | The source node's full stop operation, the canonical declaration digest and complete role-to-ID map from passive creation, the approved activation order, its one selected role, and Unix time in seconds at most 15 minutes ahead. Preserve the order for the whole return. |
| `owner` | `uid`, absolute `home`, installed `runtime` digest, `nodeSha256`, local `socket`, original public `helper` directory and `helperManifest` digest, original private `directory`, `declarationFile`, `declarationFileSha256`, and `seal` digest. Use `/run/docker.sock` for a root-owned engine or `/run/user/UID/docker.sock` for that owner's rootless engine. The registered endpoint must execute as the same owner. |
| `passive`, `custody`, `handback.record` | Each reference includes the native `run`, `pipeline`, original review digest `review`, definition `revision`, exact `step`, `sourceHash`, and SHA-256 of its complete UTF-8 stdout in `outputSha256`. Select three distinct successful runs with public-only outputs. Retain these references independently of the declaration. |
| `handback.mode`, `handback.params` | Use `unchanged` for a confirmed return before the placement selection, or `restored` for a completed return to the original registration. Supply the original public `expires`, `baseline`, `stopId`, `placementReview`, and `returnDataReview` parameters. The unchanged branch also requires its `release` and `prepared` digest. |

The passive run's selected source step must carry the complete receipt with `running: 0`. On the unchanged return branch the selected controller step is `recheck-original-allocation`, and the source step is `release-original-holds`. On the restored branch the controller step is `commit-native-return`, and the source step is `release-signer-holds`. Both require `recheck-recipient-closed` on the receiver, a matching operation ID, an inactive recipient, zero portal consumers, and restored source rules with zero processes or publishers started. The controller re-prepares the **same successful run** under the original actor and compares its existing parameter commitment. Supply only previously admitted public parameters.

The data owner supplies the separate, fresh custody run. Its designated controller step attests protocol 1, `project`, `stack`, `sourceNode`, `receiverNode`, `nodeStop`, the same `returnDataReview`, and the authorized `roles` and `expires`. `beforeFirstNewWriter`, `receiverWriterFenced`, `exclusiveSigners`, and `exclusivePublisher` must all be true. Its completion and authorization must fall within the 15-minute window. The data owner establishes these facts through the site's application, database and ownership checks and holds those fences until the return is complete. Record only these public conclusions. With missing custody, an unbound old reference, changed placement or an unfinished return, the source start is ineligible.

On the original host the endpoint rechecks the completed node stop, selected source seal, original eight helper files, physical volume and bind identities, and the complete set of passive container IDs. Filtered Docker inventory runs inside the original owner’s administrative boundary with an empty private client configuration and the selected local Unix socket. Docker can return its ordinary container summaries to that local CLI. Only the full ID column reaches the publisher, and CLI stderr is discarded. The endpoint requests the selected container's public ID and name through Docker stats, and only the numeric `PID` column through Docker top. It issues exactly one detached `POST /containers/FULL_ID/start` and confirms the same ID, running state, and PID set. The endpoint never requests a container configuration, general inspection, logs or attachment. The public receipt contains the selected ID and source operation.

A source-local SQLite write lock serializes activations. The endpoint flushes its intent to a separate private journal before dispatch. A lost response may be reconciled by observing the same running ID. An exited container, a foreign running member, a changed seal, or an issued intent with no confirmed process leaves the action unconfirmed. Preserve the journal and have the operator reconcile that specific dispatch. The publisher does not automatically restart a service after a crash. After a controller post-check failure, re-read both the site admission and the source result before the next role.
