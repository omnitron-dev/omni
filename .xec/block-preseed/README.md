# Online staging of public block segments

`pnpm exec xec block-preseed` exports ordinary Omnitron Pipelines. The installed Omnitron CLI at `111f3f64` can check, save, review and execute the exported JSON. Payload bytes flow over OpenSSH directly from the source Linux node to the receiver. The controller handles host identity checks, public offers and run receipts.

The source opens regular, single-link `blkNNNNN.dat` and `revNNNNN.dat` pairs immediately inside the configured `blocks` directory. It excludes each family's highest observed index, every index at or above `firstActive`, and pairs with a currently open write descriptor. Choose the lowest active index across all writers if the node has multiple active chainstates. Gaps are allowed for a pruned source. The offer fixes exact names, lengths and SHA-256 values. Source enumeration requires Linux host PID visibility. Both scans check the file identity and timestamps before and after reading. The transfer verifies one temporary segment at a time before sending its bytes.

The source offer and send processes lower their CPU priority to nice 19 before reading any segment. When Linux provides `ionice`, both also select best-effort I/O priority 7. A failure to set an available priority stops the step. The step's stderr reports the selected settings.

The management steps require root SSH registrations on both Linux nodes, Python 3.8+, and synchronized clocks. The source needs OpenSSH client tools and free working space for one segment (maximum 512 MiB) under `/var/lib/omnitron-block-preseed`. The receiver needs OpenSSH with Ed25519, `restrict` and `expiry-time`, the standard shadow-utils `useradd` and `userdel`, and public-key login from the declared source IPv4 address. Its SSH policy must admit the generated system account and honor `.ssh/authorized_keys` and its forced command. The controller executor needs `python3` and its normal `omnitron` CLI on PATH with permission to inspect both registered SSH host keys. Verify and pin both Ed25519 fingerprints independently before starting. [OpenSSH authorized keys](https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT)

On the receiver, choose an existing root-owned `stageParent` on the destination filesystem with sufficient space. Its ancestors must be physical, root-owned, traversable by the transfer account, and writable only by root. An example is `/srv/block-staging` mode 0755. The operation creates its own empty `block-preseed-<id>` underneath it. It creates a dedicated password-disabled system account, binds the key to the source IPv4 address, deadline and exact forced command, and constrains the receiver to the reviewed filenames and byte counts. The receiver returns only byte-sized acknowledgements. Keep one operation UUID for all retries.

## Prepare the source offer

Put the following fields in a private `spec.json`. The node IDs and fingerprints below are placeholders. `firstActive` is an exclusive bound. `rateKiB` is the maximum payload KiB/s and `ttlMinutes` is at most 1,440 minutes from issuance of the source key.

```json
{
  "id": "d24f5061-e7c7-4aa3-ad78-a9752ffe90ab",
  "sourceNode": "registered-source-id",
  "receiverNode": "registered-receiver-id",
  "sourceFingerprint": "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "receiverFingerprint": "SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "sourceIp": "192.0.2.10",
  "receiverIp": "192.0.2.20",
  "receiverPort": 22,
  "blocks": "/srv/chain/blocks",
  "firstActive": 25,
  "stageParent": "/srv/block-staging",
  "rateKiB": 8192,
  "ttlMinutes": 240
}
```

```sh
pnpm exec xec block-preseed offer spec.json > offer-pipeline.json
omnitron --json pipeline check offer-pipeline.json
omnitron --json pipeline save offer-pipeline.json > offer-definition.json
offer_id=$(jq -er '.data.id' offer-definition.json)
omnitron --json pipeline run "$offer_id" --prepare > offer-review.json
offer_run=$(jq -er '.data.id' offer-review.json)
offer_digest=$(jq -er '.data.review.digest' offer-review.json)
omnitron --json pipeline start "$offer_run" --expected-digest "$offer_digest"
omnitron --json pipeline status "$offer_run" --output > offer-status.json
```

Wait for `.data.status == "success"` before extracting the public offer. Inspect the count, bytes, deadline, manifest digest and intended endpoints.

```sh
jq -e '.data | select(.status == "success") | .steps[] | select(.name == "offer" and .status == "success") | .output | fromjson' offer-status.json > public-offer.json
pnpm exec xec block-preseed copy spec.json --offer public-offer.json > copy-pipeline.json
omnitron --json pipeline check copy-pipeline.json
omnitron --json pipeline save copy-pipeline.json > copy-definition.json
copy_id=$(jq -er '.data.id' copy-definition.json)
omnitron --json pipeline run "$copy_id" --prepare > copy-review.json
copy_run=$(jq -er '.data.id' copy-review.json)
copy_digest=$(jq -er '.data.review.digest' copy-review.json)
omnitron --json pipeline start "$copy_run" --expected-digest "$copy_digest"
omnitron --json pipeline status "$copy_run" --output
```

The receiver independently reads and hashes every staged segment after closing admission. Successful `seal` reports `sealed: true`, destination, manifest digest, file count and bytes. The stage becomes root-owned mode 0700. The operation removes the receiver account and the source private key. A service installation can separately review the stage, chain identity, height, and data format. Bitcoin Core 28 and later can obfuscate block files using per-directory XOR data. The transfer preserves the original bytes and excludes `xor.dat`, indexes, chainstate, wallet and configuration files. Check compatibility before using the stage. [Bitcoin Core block storage changes](https://bitcoincore.org/en/releases/28.0/#blockstorage)

## Interruptions and credential cleanup

Inspect the original run ID after a lost reply. Existing complete files must match the original manifest to resume. A new reviewed copy attempt can reuse them and reports `retainedFiles`. A failed or interrupted attempt can leave one private `.part`. The next authenticated transfer replaces that partial entry. A changed source, conflicting file or unexpected directory fails verification. A new source inventory requires a fresh operation UUID and empty stage.

```sh
pnpm exec xec block-preseed revoke spec.json > revoke-pipeline.json
omnitron --json pipeline check revoke-pipeline.json
omnitron --json pipeline save revoke-pipeline.json
```

Review and start this saved definition using the same `pipeline run --prepare`, `start --expected-digest` and `status` sequence above. Revocation disables authentication and active writes, removes the source private key, and retains the partial stage for retry. If an endpoint reports a busy session, inspect the original run and repeat revocation after it exits. OpenSSH enforces the absolute key expiry; the forced receiver enforces the same deadline on connected sessions. After expiry or explicit cleanup, run the offer phase again with the same spec to obtain a fresh key for the original manifest, then export a new copy definition.


## Accept a completed direct stream after a lost controller acknowledgement

Reconcile both operation locks through a short registered-node inspection. The donor must have the original durable `sent.json` matching the manifest, file count and bytes. The receiver must have its complete stage under the recorded inode and no remaining session. Export `pnpm exec xec block-preseed accept spec.json --offer offer.json`, then check, review and start the emitted Pipeline with the installed CLI. Its pin check precedes the existing receiver seal, which rehashes every file and removes the scoped SSH account. A successful seal authorizes the donor to forget the one-use key. This phase can also finish a fully received stage after credential expiry. If either physical session is still active, wait for completion. With two idle endpoints and an incomplete stream, use the resumable copy phase.

OpenSSH 9.1 and newer receive an explicit UTC expiry. Older receiving sshd versions use the fourteen-digit local representation they accept, checked against the same absolute epoch. The restricted program independently checks expiry at admission and during the session. [OpenSSH 9.1 changes](https://www.openssh.org/txt/release-9.1)
