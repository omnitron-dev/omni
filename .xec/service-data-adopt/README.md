# Restoring sealed private service data into rootless Docker volumes

`service-data-adopt` restores the private service volumes sealed by `service-data-preseed`. It accepts an identity-mapped donor and a registered receiver whose Docker daemon runs in a different user namespace. The destination keeps the reviewed named-volume names so an ordinary reviewed stack can later mount them. [Private service staging](../service-data-preseed/README.md)

Capture the donor UID/GID maps for every volume and the destination engine's PID, UID, UID map and GID map in a reviewed Pipeline while the original registrations still exist. The rootless socket must be the daemon user's physical `/run/user/UID/docker.sock`. The daemon's maps are checked again on the target. Preserve the complete successful observation obtained from `omnitron --json pipeline status RUN --output`. The source step is named `source-volume-namespace` and returns `maps` keyed by volume tag. The receiver step is named `target-engine-namespace` and returns `daemonPid`, `daemonUid` and `maps`. Each map contains `uid_map` and `gid_map` with Linux triples in inside-ID, host-ID, count order.

```sh
pnpm exec xec service-data-adopt binding spec.json --namespaces namespaces.json > binding.json
```

The receiver owner independently grants the exact binding digest in `/etc/omnitron/service-data-adoptions/UUID.json` with `{"schema":1,"binding":"<binding SHA-256>","expires":<future Unix seconds>}`. Keep the file 0600 and its directory and ancestors root-owned and protected from other writers. The original source must remain under its recorded full stack stop, the stage closed, and all target volumes unattached. New volume names must be free on first admission. The transfer's original data and the sealed staging copy are retained independently.

```sh
pnpm exec xec service-data-adopt restore spec.json --namespaces namespaces.json --bootstrap receiver-bootstrap.json \
  --cold cold-receipt.json --seal sealed-receipt.json > restore.pipeline.json
pnpm exec xec service-data-adopt verify spec.json --namespaces namespaces.json --bootstrap receiver-bootstrap.json \
  --cold cold-receipt.json --seal sealed-receipt.json > verify.pipeline.json
```

Check, save, prepare and start each definition with its own review digest. Supply the full successful receiver bootstrap Pipeline status. Both graphs use the normal full-stop gate and fetch the reviewed namespace and bootstrap runs from the controller. Every helper part must attest the same SHA-256, every output must belong to the registered receiver, and the final admission must identify the exact spec and stage. The receiver hashes the root-owned seed helper against that historical digest before validating the local seal. A later exporter can therefore restore data staged by an earlier version.

The target administrator runs the stock host rsync with the sealed staging tree as its read-only fake-super source. A separate receiver process opens the exact reserved volume by device/inode, enters the pinned Docker engine's user namespace, verifies the live maps and receives as container root. The kernel maps file owners and named POSIX ACL principals independently for users and groups. A container UID of zero maps to the daemon's host UID. A container GID of zero uses the daemon's host GID. Subsequent ranges use their respective subordinate mappings. [Docker UID/GID mapping](https://docs.docker.com/engine/security/rootless/uid-gid-mapping/) · [Linux setns](https://man7.org/linux/man-pages/man2/setns.2.html) · [GNU rsync](https://download.samba.org/pub/rsync/rsync.1)

For example, UID map `[[0,995,1],[1,100000,65536]]` and GID map `[[0,984,1],[1,100000,65536]]` store container root as host `995:984`. A named ACL for container user 77 and group 88 appears on the host as user 100076 and group 100087. The mappings apply equally to access and default ACLs. The receiving storage must accommodate the sealed stage and all six decoded volumes until the operator accepts the restore.

The restore journal reserves fresh volumes with an operation-specific label and pins each physical inode before receiving. Interrupted restores can reuse their own reserved volumes while the approval and stop remain valid. Verification repeats GNU rsync's checksum, ownership, ACL and xattr comparison with the same namespace, independently hashes the decoded content and link topology against the cold source, and records a digest of logical owners, access/default ACLs, masks and xattrs. It checks numeric owners and ACL principals against both maps. The pinned PostgreSQL images run only `pg_controldata` with read-only volumes, a read-only root filesystem, no network or capabilities. The gate checks both major versions, system identifiers, clean shutdown and checkpoint WAL, Nominatim markers, Redis persistence validators and the MinIO format marker. The original named volumes, wallets, registry and standalone credentials stay under their own admissions.

Review the resulting physical identities, tree digests and native evidence before attaching target writers. A stale stop, an already used volume name, a changed engine, an incomplete ID mapping, a writer or any mismatch holds the cutover. While the new volumes remain unattached, rollback uses the donor's preserved placement and data. Reconcile any writes accepted by the destination before changing direction.

Restoring a volume also requires its service credential. For PostgreSQL and MinIO, provision the matching binding in the destination node's vault under `infra:<project>:<stack>:postgres:password` or `infra:<project>:<stack>:minio:secretKey`. A stack with explicit service credentials uses those bindings. A restored volume with a missing generated credential stops provisioning before the service starts. Verify a database login and access to an existing object before admitting application traffic.

## Native validator requirements

Before the stop, export and review the image-only probe. It checks the receiver's registered SSH key and engine observation, inspects the local immutable PostgreSQL image and the created container, and runs `pg_controdata --version` under the engine's stock security profile. An image-declared data volume receives a private 4 KiB read-only tmpfs. The result records the version, pinned image and number of mounted data volumes.

```sh
pnpm exec xec service-data-adopt probe spec.json --namespaces namespaces.json > probe.pipeline.json
```

Docker installations which report a specific denial reading the kernel's AppArmor profile list while selecting `docker-default` can use the supplied `omnitron-service-data-verify-v2` profile. The receiver administrator can separately review its bytes, install it as root in `/etc/apparmor.d/omnitron-service-data-verify-v2`, and load it with enforcement. Set `validatorProfileSha256` in the local adoption grant to the reviewed policy's SHA-256 and export `verify` with `--validator-apparmor`. The endpoint requires the same compiled-in digest, protected on-disk bytes and a currently enforcing kernel profile. The profile admits the native PostgreSQL and Redis checkers, their libraries, read-only `/input` and the independent Redis scratch files in `/work`. The service containers retain their own policies. [Validator policy](validator.apparmor) · [Docker AppArmor](https://docs.docker.com/engine/security/apparmor/)

The target performs the same private AOF copy, host/cgroup memory checks and byte comparison as the fenced source. RDB and PostgreSQL always use read-only mounts. A failed or modified AOF holds the operation. [Redis scratch sizing and historical grants](../service-data-preseed/README.md)

## File acceptance with two physical PostgreSQL replicas

Use `--postgres-replicas` when the receiver obtains both PostgreSQL clusters through their own physical replication procedure. The original full physical spec, source and receiver bootstrap reviews, named-volume identities and namespace observation still apply. An accepted warm stage can be reused in place. The two endpoint leases must cover cold transfer and the seal audit. The receiver owner separately grants the SHA-256 emitted by the following binding. This binding reserves exactly `nominatim-flatnode`, `nominatim-merged`, `redis-data` and `minio-data`.

```sh
xec service-data-adopt binding spec.json --namespaces namespaces.json --postgres-replicas
xec service-data-cold cold spec.json --source-bootstrap source-bootstrap.json \
  --receiver-bootstrap receiver-bootstrap.json --grants grants.json --stop "$stop" --postgres-replicas
xec service-data-cold seal spec.json --source-bootstrap source-bootstrap.json \
  --receiver-bootstrap receiver-bootstrap.json --cold cold-files.json --stop "$stop" --postgres-replicas
xec service-data-adopt restore spec.json --namespaces namespaces.json --bootstrap receiver-bootstrap.json \
  --cold cold-files.json --seal sealed-files.json --postgres-replicas
xec service-data-adopt verify spec.json --namespaces namespaces.json --bootstrap receiver-bootstrap.json \
  --cold cold-files.json --seal sealed-files.json --postgres-replicas
```

Each phase after binding exports an ordinary manual Pipeline. Review and run each graph through Omnitron. Save the JSON output of the successful `cold` and `seal` endpoint steps as `cold-files.json` and `sealed-files.json`. Use the same exporter for restore and verify. Where the receiver requires the separately admitted enforcing validator profile, pass `--validator-apparmor` for verify and match its SHA in the local grant. The exact current full stack stop is checked before and after each graph. The donor must have no active stack container or writer for any selected tree. RDB-only Redis requires the fenced final SAVE bound to this stop and the original full spec. Multipart AOF still runs its native checker on an independent working copy.

Only the four selected trees enter rsync, source hashing, receiver comparison, volume reservation and decoded verification. The source records and compares inode, nanosecond ctime/mtime, owner, mode, link count and size around the native checksum passes to reuse its fenced SHA-256. The receiver closes the original transfer credential for the entire stage at seal. Warm copies of PGDATA, external WAL and tablespaces stay private. The receiver can already have those PostgreSQL volumes allocated and attached. The four selected volume names must be new, and must remain unattached through verification. A successful verify returns `fileScope: "postgres-replicas"` and four physical volume identities. An ordinary full adoption rejects this receipt. To choose full cold from the same original stage, select that route while transfer admission is still open. A sealed stage cannot be reopened by changing a CLI flag.

Record independent site-native acceptance for **each cluster** before admitting writers on the new site. It must identify the expected PostgreSQL major and `system_identifier`, the verified base-backup manifest SHA-256, the fenced source and final LSN, the receiver replay LSN and timeline before promotion, and continuing exclusion of writers on the original site. The application database and Nominatim require independent receipts. For Nominatim also reconcile the stopped import generation, its `import-finished` marker and the accepted flatnode and merged files. WAL replay alone cannot carry an ordinary PGDATA marker file updated after the base backup. The registered PostgreSQL witness verifies both native backups, the source shutdown WAL, actual standby replay and the private promotion history. Keep the original data and both writer fences until the site accepts all three results and chooses the active writer. [Physical PostgreSQL switchover](../postgres-switchover/README.md)

## Sizing the stop window

Warm seeding and a final online delta reduce the bytes written and sent after fencing. The cold rsync still checksums both source and stage and independently hashes the source. Sealing repeats the two-ended checksum comparison, rehashes the source and hashes the sealed stage. On a fully warmed volume these two phases ordinarily read its logical size about four times on the donor and three times on the receiver. Changes add further reads and writes.

Restore reads the sealed stage and copies the decoded bytes into the fresh, sparse-aware rootless volumes. The sender's checksum can add another full read. Verify checksums both the stage and the target and then independently hashes the target. Additional directory, metadata, ACL and native service checks also take time. Sequential SHA-256 includes the logical zeroes in sparse files. Actual disk I/O and elapsed time depend on allocated extents, cache, CPU, sustained throughput and the cold delta. Before downtime, check the two image identities, engine namespace, ACL support, tmpfs capacity, destination space, sustained read throughput, grants and the most recent warm result.

## Linux acceptance fixture

The kernel test runs with `python3 -B namespace_test.py RESULT_MOUNT` inside a disposable, networkless Linux guest named `service-data-fixture`. It exercises the real GNU rsync protocol bridge with access and default ACLs, distinct UID and GID mappings, a sparse file, a hard link and a PostgreSQL symlink.

The full-engine test uses a separate rootless Docker daemon in that guest. Its result mount carries the reviewed `seed-program.py`, a local `engine-report.json` containing `pid`, `uid` and both `maps`, and synthetic `cluster-fixtures/{pg17,pg14,redis}.tar.gz` archives. Each contains a clean native `db/`, `native-control` output and a `validator/` root filesystem with the original image's validator and libraries. The adjacent `receipts.json` records `arch`, `bytes` and `sha256` by archive name. Run `python3 -B engine_test.py prepare RESULT_MOUNT PRESEED_TEST_DIRECTORY` in the guest. Its five `fixture-*.json` inputs feed the ordinary Xec binding, restore and verify commands above. Save their outputs as `fixture-binding.json`, `native-fixture-restore.pipeline.json` and `native-fixture-verify.pipeline.json` on the result mount. Run `python3 -B engine_test.py check RESULT_MOUNT PRESEED_TEST_DIRECTORY` to execute both receiver steps, compare native source and restored metadata, and confirm that changing a decoded object causes verification to fail.

For a fixture needing the separately enforced policy, store its SHA-256 in `fixture-validator-profile.sha256` and export verify with the matching flag. Use the fixture's two bootstrap files and grants with `service-data-cold cold` and the stop ID from `fixture-cold.json` to produce `native-retained-cold.pipeline.json`. Run `python3 -B cold_test.py RESULT_MOUNT`. It checks that the emitted source command rejects the fixture receiver's host identity, then exercises the historical source's native cold validators against read-only exported trees. A separate rootful Docker fixture loads the exact previously prepared validator images from the rootless fixture and checks both PostgreSQL clusters, clean WAL, Nominatim, MinIO, Redis RDB and multipart AOF. It also exercises a corrupt AOF.

To qualify the four-tree path, start with the same synthetic full-engine fixture after its prepare step. The private guest needs an unused rootful Docker socket, the enforcing fixture validator profile, packaged `sshd` and two loopback-only addresses from the documentation range. Run `python3 -B replica_files_test.py RESULT_MOUNT PRESEED_TEST_DIRECTORY prepare`. It prepares both local endpoints and keeps two containers running on the excluded PGDATA volumes. Use its `files-spec.json`, `files-namespaces.json`, `files-grants.json`, `files-stop.json` and the `files-source-bootstrap.json` and `files-bootstrap.json` inputs with the five ordinary exports above. Save the binding as `files-binding.json` and each graph as `files-PHASE-pipeline.json`. Run the same fixture script with each of `cold`, `seal`, `restore`, then `verify` in order. It executes the exported endpoint commands and writes the required `files-cold.json` and `files-seal.json` for subsequent exports. Linux inotify watches the four excluded PGDATA/WAL/tablespace roots at each of the donor, stage and rootless destination. The verify test also modifies a selected receiver object and a selected donor file in the disposable guest and checks that both audits fail.

## Read the physical restore evidence from Omnitron

After a successful full `service-data-adopt verify` run, an administrator can inspect the copy through the controller using the run UUID and the registered project and stack.

```sh
omnitron --json pipeline physical-restore VERIFY_RUN_UUID PROJECT STACK
```

`OmnitronPipelines.inspectPhysicalRestore({verifyRunId, project, stack})` reads the executor's pinned definition, approval and exact outputs. It recognizes the full five-step adopt verifier and qualified seed and adoption workers. A saved definition may have been edited since the run. A truncated older verify output needs a fresh native verify on the same restoration. The four-tree replica workflow has its own PostgreSQL replay receipts.

During inspection the controller checks both SSH registrations and the original, unsuperseded full stack stop before and after the endpoint observations. The donor needs its original read-only exports. The receiver needs its unexpired local adoption grant, recorded rootless engine and unattached reserved volumes. Both endpoints read the complete stopped trees. Allow time for a full read at each site. Equal requests in flight on one controller share the observation. A subsequent call observes both sites again.

The response identifies the exact run, review, stop, SSH identities and observation interval. Each volume has its source and receiver device/inode, tree SHA-256, file and byte counts, receiver metadata SHA-256, and inode-generation fingerprints. It includes the matching PostgreSQL system identifiers and hashes of the native control files at both ends. The enrolled MinIO volume must use the single-drive XL format with one set containing that same drive. The format hash and complete tree checks cover retained version and delete-marker files present in that stopped volume. Externally tiered bodies and external key services require separate acceptance. The stable `proofDigest` binds these facts. [MinIO on-disk format](https://github.com/minio/minio/blob/master/cmd/format-erasure.go)

For application acceptance, start disposable copies, read the required SQL rows and migration ledger, and enumerate the expected S3 version IDs, prior bodies, metadata and delete markers with the site credentials. Keep the verified volumes unattached during this rehearsal. A decision to admit writers requires the site's separate source writer fence and approval.
