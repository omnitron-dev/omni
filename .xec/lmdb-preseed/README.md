# Private online Monero LMDB preseed

`pnpm exec xec lmdb-preseed` exports manual Omnitron Pipelines for two registered Linux nodes. The controller carries the checked helper, node pins, chain checkpoints and receipts. The database flows directly over SSH from the running source to a new private stage on the receiver.

The source uses the LMDB fork from the signed Monero `v0.18.5.1` release. Its `MDB_RDONLY` environment joins the live reader table. `mdb_env_copyfd2` with `MDB_CP_COMPACT` writes a single consistent transaction to a pipe and omits the free-page list. Live named tables include the transaction pool, which can hold unrelayed transactions. Use this operation only for an authorized private transfer of that entire database. Wallet files, daemon configuration, onion keys, logs and other files in the data directory are outside the source selection. No daemon starts or relays staged data. [Monero copy utility](https://github.com/monero-project/monero/blob/v0.18.5.1/external/db_drivers/liblmdb/mdb_copy.c) [Monero LMDB tables](https://github.com/monero-project/monero/blob/v0.18.5.1/src/blockchain_db/lmdb/db_lmdb.cpp)

## Build the helper

Use a local checkout containing the signed upstream tag, Zig 0.15.2, Git, GnuPG and an empty output filename. The builder verifies the exact tag object `fe7ebfe689234a885ab2f478b0303ce930810e3b`, commit `4f92268d7c16741cfb41e5bbe2aa46cc260a9ea5` and signing fingerprint `8777AB8F778EE89487A2F8E7F4ACA0183641E010`. It compiles the verified Git blobs and records the ELF SHA-256, architecture and glibc target. Use the same 64-bit Linux architecture on both nodes. The x86_64 helper was exercised on glibc 2.35 and the compiler target is glibc 2.28.

```sh
pnpm exec xec lmdb-preseed build-helper /work/monero /work/snapshot-x86_64 \
  --machine x86_64 > /work/build-receipt.json
```

Both registered management connections need root access, Python 3.8+, OpenSSH 8.2+ with Ed25519 and `ssh-keygen -Y`, and synchronized clocks. The receiver needs `useradd`, `userdel` and public-key login for a dedicated non-root system user. The source needs `data.mdb` and `lock.mdb` in a physical `lmdb` directory. The target needs an existing root-owned, traversable, non-writable-by-others stage parent on a filesystem with at least `maxBytes` available. Set `maxBytes` to a reviewed upper bound for the compact copy, including expected chain growth. The receiver rejects admission below this space bound. [OpenSSH authorized keys](https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT)

## Review and run

Create a private `spec.json` with a fresh UUID and the pins already trusted by the registry. Replace the example values with the reviewed endpoints, checkpoint floor, receiver capacity and `sha256` from the build receipt.

```json
{
  "id": "705f8e4c-d502-4c07-9327-c394760555af",
  "sourceNode": "registered-source-id",
  "receiverNode": "registered-receiver-id",
  "sourceFingerprint": "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "receiverFingerprint": "SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "sourceIp": "192.0.2.10",
  "receiverIp": "192.0.2.20",
  "receiverPort": 22,
  "stageParent": "/srv/private-staging",
  "lmdb": "/srv/chain/lmdb",
  "payload": "monero-lmdb-compact-v1",
  "nettype": "mainnet",
  "machine": "x86_64",
  "minimumHeight": 1000,
  "maxBytes": 137438953472,
  "rateKiB": 24576,
  "ttlMinutes": 360,
  "helperSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

```sh
pnpm exec xec lmdb-preseed offer spec.json --helper /work/snapshot-x86_64 > offer-pipeline.json
omnitron --json pipeline check offer-pipeline.json
omnitron --json pipeline save offer-pipeline.json > saved.json
omnitron --json pipeline run "$(jq -er '.data.id' saved.json)" --prepare > review.json
run_id=$(jq -er '.data.id' review.json)
digest=$(jq -er '.data.review.digest' review.json)
omnitron --json pipeline start "$run_id" --expected-digest "$digest"
omnitron --json pipeline status "$run_id" --output > status.json
```

Wait for the run to succeed. The offer records the source height, genesis, tip and mainnet block-one checkpoint. Its `manifest` covers those observations and the source free-space policy. The receiver SHA-256 of the actual database appears later in `seal.sha256`.

```sh
jq -e '.data | select(.status == "success") | .steps[] | select(.name == "offer" and .status == "success") | .output | fromjson' status.json > source-offer.json
pnpm exec xec lmdb-preseed copy spec.json --helper /work/snapshot-x86_64 --offer source-offer.json > copy-pipeline.json
```

Check, save, prepare, start and inspect this definition using the same installed CLI sequence. `copy` grants one expiring Ed25519 key, bound to the source IPv4 and an exact forced write-only command under a fresh non-root account. SSH verifies the receiver's pinned host key. The source checks the device, inode, genesis and approved tip on the open data file before producing bytes. The daemon can keep committing as the copy runs. The producer hashes the bounded stream and signs the byte count and SHA-256 only after the compact operation succeeds.

The source applies nice 19 and, where available, `ionice -c 2 -n 7`. The rate ceiling is 24 MiB/s. A copy holds an LMDB read transaction and can prevent the writer from reusing freed pages. An independent five-second check watches available space on both source filesystems, including when the network is blocked. Below 8 GiB it terminates the operation's producer and SSH process, which releases the read transaction. The same child processes terminate on lease expiry or loss of the owning process. No temporary database file is allocated on the source. [LMDB snapshot and reader semantics](https://github.com/monero-project/monero/blob/v0.18.5.1/external/db_drivers/liblmdb/lmdb.h)

`seal` closes admissions, takes exclusive ownership, verifies the grant and signature, and independently reads and hashes the staged file. Its offline read of the compact LMDB checks mainnet's block-one checkpoint, the source genesis, minimum height and the block hash at the original source tip's height. A growing chain can produce a later valid snapshot. The successful stage contains only `data.mdb` owned by root at mode 0400 in a mode-0700 directory. The receipt includes the stage path, transaction height, source checkpoint, byte count and SHA-256. The operation removes the receiver account and the source private key. Installation, ownership for the eventual service and any service transition require a separate operation. [Mainnet checkpoint](https://github.com/monero-project/monero/blob/v0.18.5.1/src/checkpoints/checkpoints.cpp)

## Prepare the daemon data directory

After `seal` succeeds, save its JSON output as `receiver-seal.json`. Use the original specification and offer to prepare a separate data directory on the receiver.

```sh
pnpm exec xec lmdb-preseed prepare-data spec.json --offer source-offer.json \
  --seal receiver-seal.json --reserve-bytes 10737418240 > prepare-data-pipeline.json
```

Submit the definition through the same Pipeline lifecycle. The receiver checks its original disk and seal receipts, reserves the named candidate, and copies only `data.mdb`. A copy-on-write clone is used where supported. Capacity checks allow for a full copy and the requested free-space reserve. Before publishing the directory, the receiver reads back its SHA-256 and checks that it has a separate inode. A retried run can finish a prepared rename and returns the original receipt for an intact candidate.

The receipt's `dataDir` contains `lmdb/data.mdb` in the layout expected by `monerod`. Before connecting it to peers, verify the release that will serve it.

```sh
pnpm exec xec lmdb-preseed check-daemon spec.json --release monerod-release.json > check-daemon-pipeline.json
```

Supply the installed `binary` under `/opt/omnitron/binaries/monero/<version>/`, its verified `sha256`, and the service account's `user`, numeric `uid` and `gid`. The receiver binds the independent database file into a transient systemd service. The daemon runs as the declared non-login account with a private loopback network. Its lockfile, peer state and logs live in a temporary directory. The check reads the mainnet genesis, original checkpoint and snapshot tip through the daemon's own RPC and waits for a clean shutdown. The receipt records the daemon SHA-256, height and headers. Repeating the check on the same verified file returns that receipt. [Monero daemon options](https://docs.getmonero.org/interacting/monerod-reference/) · [Node RPC](https://docs.getmonero.org/rpc-library/monerod-rpc/)

Use the verified `dataDir` as the stack's `bareMetal.adopt.from` on the same filesystem. The original sealed snapshot remains available for recovery.

## Interruptions, credentials and retries

Inspect the existing run after an unknown outcome. Each checked helper chunk is content-addressed and at most 6 KiB before base64. A repeated chunk verifies the stored bytes. The final installer independently verifies the complete ELF and publishes it atomically under `/var/lib/omnitron-lmdb-tools/<sha256>`, mode 0500. An existing exact ELF satisfies a later install after an uncertain acknowledgement. A mismatched file stops the operation. The exported shell steps each fit within 24 KiB.

If the receiver has a complete signed stream but its final acknowledgement was lost or the lease expired, export `accept` with the **original** offer. It verifies the retained proof and payload against the receiver's original root-owned grant, then runs `forget`. It can finish after credential revocation and performs no source database read.

```sh
pnpm exec xec lmdb-preseed accept spec.json --helper /work/snapshot-x86_64 --offer source-offer.json > accept-pipeline.json
pnpm exec xec lmdb-preseed revoke spec.json > revoke-pipeline.json
```

Use the reviewed CLI lifecycle above for either definition. `revoke` disables new SSH sessions and active writes, removes the source private key and retains the private stage. A busy session can require a repeated revocation after it exits. For an incomplete stream, repeat `offer` with the same spec after cleanup, then export `copy` with its new public key. The receiver discards the previous partial before the next transaction begins. A complete candidate is preserved for `accept`. A changed underlying database, reviewed specification or new snapshot after successful acceptance requires a fresh UUID and new stage.

## Qualification

```sh
node --import tsx --test .xec/lmdb-preseed/export.test.js .xec/block-preseed/export.test.js
python3 -B .xec/lmdb-preseed/stream_test.py
python3 -B .xec/lmdb-preseed/offline_probe_test.py
python3 -B .xec/block-preseed/endpoint_test.py
```

Run `python3 -B .xec/lmdb-preseed/materialize_test.py` as root inside a disposable Linux test container with a writable private `/root`. It checks the independent copy, exact replay, recovery after an interrupted rename, and refusals for an occupied destination, a mismatched receipt and insufficient space.

`stand_test.py --help` describes the additional two-node fixture. It requires two disposable Linux containers with `sshd` on the same internal Docker network, tagged `org.omnitron.preseed-qa`. Compile `mvcc-fixture.c` with `mdb.c` and `midl.c` from the verified release for the fixture architecture. The test exercises the exported operations with the installed CLI's definition checker, a concurrent LMDB writer, an interrupted stream, a fresh key, acceptance after revocation and exact receipt replay. `native-ssh-test.mjs` additionally runs the offer's remote commands through the installed Omnitron `ExecutionService` and Xec SSH adapter against a pinned fixture host.
