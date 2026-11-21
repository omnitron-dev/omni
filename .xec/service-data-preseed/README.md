# Staging private service volumes between registered Linux nodes

`pnpm exec xec service-data-preseed` exports regular Omnitron Pipelines for a PostgreSQL 17 cluster, Nominatim PostgreSQL 14 and its flatnode and merged inputs, Redis persistence, and a single-volume MinIO installation. Each endpoint administrator grants one operation locally. Source bytes travel directly over pinned OpenSSH to an unprivileged, write-only `rrsync` account. The controller handles grant fingerprints, tree digests and Pipeline receipts.

`project` packaging delivers application inputs. `backup` writes a local database dump or bucket archive. `files copy` relays 256 KiB frames through its master and limits a transfer to 100 GiB and 10,000 entries. `block-preseed` admits closed public block/undo pairs. Private service staging has a separate grant and stage.

## Declare the volume set

Use one UUIDv4 for the whole migration. Carry the endpoint fields from the [block preseed registration](../block-preseed/README.md), replacing `blocks` and `firstActive` with `project`, `stack`, `clusters` and `volumes`. The two PostgreSQL system identifiers in `clusters.postgres` and `clusters.nominatim` are decimal strings. Each volume row has the following fields.

| Field | Value |
| --- | --- |
| `tag` | One of the data roles below |
| `container`, `image` | Full native container ID and its local `sha256:` image ID |
| `volume`, `target` | Docker named volume and its exact container mount |
| `device`, `inode` | Decimal strings from the physical volume root on the source |

| Required tag | Container mount |
| --- | --- |
| `postgres-data` | `/var/lib/postgresql/data` |
| `nominatim-data` | `/var/lib/postgresql/14/main` |
| `nominatim-flatnode` | `/nominatim/flatnode` |
| `nominatim-merged` | `/merged` |
| `redis-data` | `/data` |
| `minio-data` | `/data` |

Add a `postgres-tblspc-OID` or `nominatim-tblspc-OID` row for each external tablespace and a `postgres-wal` or `nominatim-wal` row for a relocated WAL. The link must point to the named volume's exact absolute mount in that container. Nested mounts, other writable mounts and installations spanning additional MinIO drives are refused. The initial grant resolves the native container IDs, image IDs, Omnitron ownership labels, local volume driver, mountpoints and physical inode identities. The named volumes and their bindings must survive the reviewed stack stop.

## Independently provision the two grants

Requirements are Linux host PID/mount visibility, synchronized clocks, Python 3.8+, GNU rsync with ACLs, xattrs, `--fsync` and `--modify-window=-1`, and the distribution's `/usr/bin/rrsync` supporting `-wo -munge -no-lock`. The receiver filesystem must support the numeric metadata stored by rsync's fake-super mode, hard links and sparse files. Budget room for the final dataset and rsync temporary files, including its largest changed file. The source stores a few small operation records and its one-use SSH key. [Restricted rsync](https://download.samba.org/pub/rsync/rrsync.1)

Each endpoint owner independently installs a root-owned mode 0600 consent at `/etc/omnitron/service-data-grants/UUID.json`. Its directory and ancestors must be root-owned and protected against writes by others. The source record has exactly `{"schema":1,"side":"source","spec":"<canonical-spec-sha256>","expires":<epoch-seconds>}`. Compute the digest from the whole spec using sorted keys at every level, compact JSON, UTF-8, and no trailing newline. The receiver record uses `"side":"receiver"` and adds `"key":"ssh-ed25519 …"` from the source bootstrap receipt. Keep the receiver stage parent root-owned, traversable by its new group, and outside all existing workload mounts.

```sh
pnpm exec xec service-data-preseed bootstrap-source spec.json > bootstrap-source.pipeline.json
pnpm exec xec service-data-preseed bootstrap-receiver spec.json > bootstrap-receiver.pipeline.json
```

Review and run the source graph first. It verifies every Docker binding before it makes the read-only aliases, creates the source-only private Ed25519 identity and returns the public key and source receipt. After the receiver owner independently accepts that key, its graph reserves a fresh stage, creates a dedicated password-disabled UID, and installs the source-IP/expiry/forced-command key. Use the two terminal JSON receipts directly for `--grants`. Public helper code travels through bounded, hashed management steps. Each execution verifies the root-owned content-addressed helper by digest. Graphs cap shell text at 22 KiB, leaving 2 KiB for the SSH adapter within a 24 KiB budget. Reuse the same code revision for grants, retries and sealing.

When the operation needs a new lease, independently update both local consents for this spec and review the two bootstrap graphs again. Use the current source public key when the receiver owner renews. Grants are bound to the exact key and deadline in the transfer review. Renewal preserves the physical stage and completed files. A sealed or revoked operation is closed.

Endpoint owners that already provision host grants manually can use this equivalent contract.

1. The source administrator creates an operation-specific Ed25519 key. Its private half stays at `/var/lib/omnitron-service-data/UUID/identity`, root-owned mode 0600. Export only the public key for the two grants.
2. On the receiver, the administrator reserves a **new empty** `STAGE_PARENT/service-data-UUID`, records its device and inode, and creates the dedicated password-disabled system account. Use `osd` followed by the first 20 unhyphenated UUID characters, its own primary group, no supplementary groups, shell `/bin/sh`, and home `/var/lib/omnitron-service-data/UUID/home`. Its only login method must be this operation's forced key. Use a root-owned stage with mode 0750 and the dedicated group. Create precisely one initially empty 0700 directory per tag under it, each owned by the transfer account. Keep the stage outside every installed volume or service mount.
3. Render the public contract and helper. The owner fixes one absolute expiry within `ttlMinutes`, in Unix seconds. Both grants should use the same deadline.

```sh
pnpm exec xec service-data-preseed grant-contract spec.json --public-key operation.pub \
  --expires "$EXPIRY" --stage-device "$STAGE_DEVICE" --stage-inode "$STAGE_INODE" > contract.json
pnpm exec xec service-data-preseed receiver-helper > receiver.py
```

4. Independently on both nodes, place the exact `spec.json` and an empty `session.lock` in the contract's `state` directory. All ancestors must be physical directories owned by root and protected from other writers. On the source use 0700/0600. On the receiver use root and the dedicated group, 0750 on operation directories and 0640 on files. Install the appropriate `source.json` or `receiver.json` from the corresponding object in the public contract. Backend state directories, wallets, host credentials and Tor identity directories are outside the named-volume grant.
5. On the source, publish a read-only bind of each individually approved physical volume at its `exports[].readOnlyMount`. Use Linux bind and read-only bind remount for each alias. The grant verifies the mount flag, device and inode against both the signed-off declaration and Docker's named volume before reads. This requires no source data copy.
6. Install the printed receiver helper at `state/receiver.py` and check `receiverHelperSha256`. Install the exact single line `authorizedKey` in `state/home/.ssh/authorized_keys`. Keep that file, `.ssh` and the home directory root-owned and group-readable/traversable for sshd. The forced command accepts only an rsync push to a declared tag and runs the packaged `rrsync` with write-only access and munged links in that one directory. Active sessions check expiry and revocation. Configure host SSH authentication to permit only that key on the transfer account.

## Run the reviewed Pipelines

Export, check, save and prepare each definition with the standard CLI. Start the returned run ID using its own review digest and wait for the terminal status. The installed CLI's `pipeline status RUN --output` contains each step's JSON output. [Pipeline review commands](../block-preseed/README.md#prepare-the-source-offer)

```sh
pnpm exec xec service-data-preseed source-grant spec.json > source-grant.pipeline.json
pnpm exec xec service-data-preseed receiver-grant spec.json > receiver-grant.pipeline.json
jq -n --slurpfile source source-receipt.json --slurpfile receiver receiver-receipt.json \
  '{source:$source[0],receiver:$receiver[0]}' > grants.json
pnpm exec xec service-data-preseed seed spec.json --grants grants.json > seed.pipeline.json
```

The two admission receipts must name the same spec and key fingerprint. `seed` may run while the source is serving. It transfers with low source priority and `rateKiB`, reuses completed files, and keeps partials only on the receiver. Its receipt is `provisional`. The warm pass excludes each PostgreSQL data directory's active WAL, postmaster PID and temporary statistics. For relocated WAL, the warm pass also skips the separate WAL tree. The MinIO scope covers its physical configured volume and `.minio.sys`. Serving access and object versions require the reviewed matching deployment, encryption configuration and any external KMS on restoration.

After the normal full `stack stop` has retired the source writers, use the exact controller `stopOperation.id`. Preserve the old named volumes, OCI images, project configuration, secrets and routing for rollback. The receiving roles must still be offline.

```sh
pnpm exec xec service-data-preseed cold spec.json --grants grants.json --stop "$STOP" > cold.pipeline.json
pnpm exec xec service-data-preseed seal spec.json --stop "$STOP" --receipt cold-receipt.json > seal.pipeline.json
pnpm exec xec service-data-preseed status spec.json > status.pipeline.json
```

`cold` verifies the current full stop, the absence of writable container mounts, both system IDs and clean shutdowns with each pinned image's `pg_controldata`, the Nominatim import marker/flatnode and durable Redis persistence with its image's read-only validators. It reconciles the complete service set, including final WAL, tablespaces, removed files, hard links and sparse flatnode data. It hashes the fenced source and reports per-tree file counts, logical bytes and SHA-256 evidence. The images used for validation must already exist locally. The containers run read-only, with no network or Linux capabilities. [PostgreSQL 17 filesystem backups](https://www.postgresql.org/docs/17/backup-file.html) · [PostgreSQL 14 filesystem backups](https://www.postgresql.org/docs/14/backup-file.html) · [Nominatim flatnode configuration](https://nominatim.org/release-docs/4.4/customize/Settings/) · [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)

`seal` observes every target inode, repeats native rsync's checksum and metadata comparison, rechecks the source cold receipt, closes destination admission, and independently reads back every staged tree. Owner, permission, ACL and xattr changes during the comparison invalidate the target inode snapshot. The receiver writes its durable seal only after a match. Both cold Pipelines require the original full stop before and after the endpoint steps. A changed stop or a failed final gate requires a new review. If Redis runs with RDB alone, its owner must complete the final SAVE under the application-writer fence and attest that particular dump in the root-owned source operation file `redis-final.json` with exactly `schema: 1`, the spec digest, the controller stop ID in `stop`, and the dump's SHA-256 in `sha256`. AOF uses the admitted effective persistence mode and its native validator.

On interruption, inspect the original run and the receiver's `status`. Repeating `seed` or `cold` with the same valid grants reuses staged files. To abandon the operation, export and review `revoke spec.json`; it closes both grants and retains the stage and all source volumes. The endpoint owners then remove the one-use SSH credentials and read-only export mounts. If verification closed a suspect stage, inspect it in place and independently admit its repair or a fresh stage. Before admitting any target writer, rollback consists of keeping the receiver offline and recovering the original placement on its preserved volumes under the normal project review. Once the receiver accepts writes, returning to the source requires a separately reconciled data direction.

The stage is a private rsync backup with fake-super metadata and munged PostgreSQL links. For restoration, keep all workload writers and routes off and create separate, empty named volumes. Record the source and target container UID/GID maps, the numeric process user and the filesystem's support for ACLs, xattrs, ownership and sparse files. When the maps match, decode the stage with a fake-super sender and a real-ownership receiver. A separate local receiver process works with GNU rsync 3.2.7 and 3.4.2. The local transport passes the remote command to the receiver in the reviewed namespace. Use an offline helper with access only to the sealed read-only stage and the new volume.

```sh
rsync -aHAXS --numeric-ids --fake-super --munge-links \
  -e /path/to/reviewed-local-namespace-transport STAGE/TAG/ target:FRESH_VOLUME/
```

For matching host mappings the decoder can operate at host level. For an identity-mapped donor, the saved numbers are already container IDs: a dedicated real-ownership rsync receiver running inside the rootless target user namespace can apply those numbers through its kernel mappings. For a nonidentity donor mapped differently from the receiver, first translate every donor host ID back to its container ID. Include named users and groups in access and default POSIX ACLs, preserve ACL masks, and check every ID is representable by the receiving map. Run a disposable ownership and ACL round trip against the exact target filesystem and namespace before restoring the workload. Reject incomplete ranges, unrepresentable xattrs, or altered capability/ACL values. A differing-map conversion requires its own qualification. Restore the exact tablespace/WAL mount mapping, compare the decoded data and metadata from the target namespace, and validate the pinned PostgreSQL/PostGIS, Redis and MinIO releases against this private layout before admitting application writers. Exercise database identity, extensions and row counts, Nominatim search/update state, Redis TTLs and S3 object versions. Activation and standalone credentials use independent reviews.
