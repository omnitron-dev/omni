# Back up the four Linux controller SQLite stores to a registered peer

`pnpm exec xec controller-snapshot` exports manual Omnitron Pipeline definitions. The registered Linux management identities install a content-addressed helper in bounded steps. Each graph checks both independently pinned SSH identities. File bytes move directly between the nodes through stock GNU rsync and one restricted SSH account. The operator receives public offers, aggregate counts, timings and SHA-256 receipts. The installed backend can stay at its current release throughout capture.

## Scope and approvals

This action supports the four standard stores beneath the source service user's physical `.omnitron` home. It captures `data/daemon-state.db`, `data/slave.db`, `runtime/state.db` and `execution/state.db`. Each has three optional adjacent files (`-wal`, `-shm` and `-journal`). The source checks regular-file identity, ownership, hard links and parent directories. It reads the native `execution/managed-owner.json` receipt and systemd's published unit state. Other application data and the separate secret store stay outside this export. The receiver holds opaque private database contents and requires corresponding administrative authorization.

A capture specification contains the following fields. Choose sizes using fresh measurements and the space required by other consumers.

| Fields | Meaning |
| --- | --- |
| `id` | New operation UUID v4 |
| `sourceNode`, `receiverNode` | Two different registered node IDs |
| `sourceIp`, `receiverIp`, `receiverPort` | Direct SSH endpoints. Source IP is also the allowed client address |
| `sourceFingerprint`, `receiverFingerprint` | The two independently trusted Ed25519 host fingerprints in `SHA256:…` form |
| `stageParent` | Existing receiver directory below `/srv` or `/var/lib`. Its ancestors must be root-owned and protected against writes by other users. Its search permissions must let the dedicated account reach its operation directory |
| `sourceUid`, `ownerReceipt` | Registered system service UID and the absolute path of `.omnitron/execution/managed-owner.json` in that user's home |
| `ttlMinutes`, `rateKiB`, `maxBytes` | Maximum admission duration, rsync bandwidth limit in KiB/s, and maximum aggregate apparent size of the sixteen fixed slots |
| `sourceReserveBytes`, `receiverReserveBytes` | Minimum free bytes to preserve on the corresponding filesystems |

The management endpoints need Linux, Python 3.8+ with SQLite 3.33+, systemd on cgroup v2, OpenSSH with Ed25519 signature support, GNU rsync with `--fsync`, packaged `rrsync`, and ordinary Linux account management tools. Both controller roles must use the registered `omnitron-owner.service` and `omnitron-daemon.service` system units. This action uses a new grant for each capture and a fresh grant for any restoration.

1. On the source, independently approve the exact spec digest and an expiration in Unix seconds. The exporter produces the local JSON record with `pnpm exec xec controller-snapshot consent spec.json --side source --expires EPOCH`. An authorized local administrator installs the record as `/etc/omnitron/controller-snapshot-grants/<id>.json`, root-owned, mode 0600, inside a root-protected directory.
2. Export `pnpm exec xec controller-snapshot offer spec.json`. Check and submit the graph through the registered controller. The source verifies the four existing main files, free space, both live service PIDs, systemd invocation identities, host boot and native owner receipt. Save the returned public offer unchanged.
3. An independent receiver administrator reviews the same spec and the source's exact public operation key. Generate its record with `pnpm exec xec controller-snapshot consent spec.json --side receiver --expires EPOCH --offer offer.json`. Install it on that receiver at the same local filename and permissions. Select deadlines that cover preparation, final transfer and retries. The earlier local deadline or SSH lease expiry stops transfer. Revoke with the registered `revoke` graph when ending an operation early.

## Warm, cold and accept

Export each graph with `pnpm exec xec controller-snapshot PHASE spec.json --offer offer.json`. Inspect the exact JSON using `omnitron --json pipeline check GRAPH.json` before the normal save, prepare and confirmed run.

* **warm** sends the four main files while the source runs. This is a resumable rsync basis on the private receiver. It holds no long-running SQLite read transaction on the source. Repeat with the same id and live offer after an interrupted run.
* **cold** requires a separate, operator-approved clean stop of both original controller units. Check that systemd reports `ActiveState=inactive`, `SubState=dead` and `MainPID=0` for each unit. The source also verifies the original owner's clean-stop receipt, checks that both original PIDs have exited and both original cgroups are empty or gone, and rejects kernel locks on the fixed file identities. It transfers every present slot with a forced delta comparison, hashes each source file, and rechecks the complete inventory and the same stop before signing the manifest. Root-owned service configuration and the general home are outside the transfer.
* The receiver disables the SSH credential before sealing, verifies the source signature, independently compares the inventory and SHA-256 of every byte, then copies one SQLite family at a time into separate scratch storage. SQLite recovers its WAL or journal and runs `PRAGMA integrity_check` and a full native checkpoint there. The raw sealed copy retains the original SHM as well. A successful receipt contains `sealed: true`, the manifest SHA-256, four integrity checks, the native checkpointed WAL frame count on the private copy, file counts and bytes. The stage is root-only, the account is removed, and the source deletes the operation key.
* **accept** repeats seal and source-key cleanup after a lost acknowledgement using the original public offer. An expired data lease permits verification of already received, signed bytes. An expired lease with an incomplete cold transfer and no usable signature has no accepted snapshot. Keep the source owner stopped until the original seal is positively accepted. If capture must start under another owner incarnation, obtain a fresh id and both grants.

The source receipts store the owner incarnation, final stop and signed inventory. The receiver retains its root-only raw stage and seal. Preserve these small administrative records with the archive. Explicit `revoke` closes an incomplete receiver grant and drops the source key. Further data movement requires independent authorization.

## Return to the same stopped owner

Create a fresh spec with a different `id`, the original endpoints and native owner, and an additional `restore` object containing the original capture `id` and its sealed manifest `sha256`. A new source consent, public offer and independent receiver consent are required. The offer verifies the exact original stop and receiver/source bindings. Any later managed-owner boot or rewritten clean receipt requires separate reconciliation to preserve newer evidence and records.

Export `restore` with that spec and the new offer. The receiver verifies the original sealed archive and creates a separately permissioned, read-only export for the new limited account. The original source pulls the fixed slots. Before writing it acquires durable systemd conditions on *both stopped units*. It uses the original allocation in place on ext4, copies changed slots, removes obsolete fixed sidecars, restores owner, group, mode and modification time, fsyncs all files and directories, and rehashes the complete restored family. The verified result reports `servicesHeld: true`. Losing the original disk or its database allocation can require another authorized target with sufficient capacity. An interrupted restore keeps the service holds. Re-run with the same approved operation and original owner fence. A changed boot or an uncertain owner requires explicit recovery with the source fenced.

Export a separate `release` graph with the restore spec and no offer. It rereads all hashes and removes only this operation's verified conditions. It records `servicesStarted: false`. If the source consent has expired, the source administrator can renew its exact restore authorization for release. The normal service start, compatible runtime selection and application verification remain explicit operator steps. A physical baseline predating new controller history must never be replayed as a version rollback after a new owner has run.

## Space and window estimate

Warm and cold capture write only small receipts and an operation key on the source. Preserve the source floor and allow separately for database/WAL growth and passive runtime installation. On the receiver, allow two times the admitted archive size for rsync's basis and temporary file, plus its free-space floor. Once the archive is present the independent SQLite test can need a further two times the largest family. A fresh reverse export may temporarily require another full copy on the receiver. Clean up retained archives only under the site's retention policy.

Before admitting a return, run `/usr/bin/findmnt --noheadings --output FSTYPE --target /path/to/.omnitron` in the mount namespace used by the source management service, using the original service home. It must report the filesystem containing that directory. Restore checks this before placing the service holds or writing data.

Restore preflight accounts for missing blocks or growth at filesystem allocation granularity on ext4. On other filesystems it budgets the full size of each changed file. It retains an additional 16 MiB plus two seconds of configured transfer rate for write headroom. Space checks cannot reserve capacity against unrelated applications writing concurrently.

Measure source/receiver sequential read speeds, available transfer throughput and competing WAL retention before agreeing a downtime bound. For a cold archive of size `S` and changed bytes `D`, budget source rsync reading `S`, transferring `D`, another source read of `S` for SHA-256, and the receiver's independent SHA-256, scratch copy and full SQLite integrity checks. A requested emergency reverse transfer and service recovery have their own budget. Warm can remove most network traffic from the window. It cannot establish a final transaction watermark for the four running writers.
