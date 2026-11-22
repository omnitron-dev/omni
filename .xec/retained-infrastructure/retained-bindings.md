# Historical infrastructure binding approval

`omnitron retained-bindings` runs through the installed daemon's owner-only Unix Netron socket. The original node owns the generated PostgreSQL and MinIO fields. The master that resolved the selected release owns the Nominatim field. Establish both from the retained release and registered host identities. A current leader election supplies no historical custody evidence.

| Original owner | Container | Environment field | Fixed owner reference |
| --- | --- | --- | --- |
| Source | `postgres` | `POSTGRES_PASSWORD` | `infra:<project>:<stack>:postgres:password` |
| Source | `minio` | `MINIO_ROOT_PASSWORD` | `infra:<project>:<stack>:minio:secretKey` |
| Historical master | `nominatim` | `NOMINATIM_PASSWORD` | `<project>.<stack>.nominatim_password` |

## Enroll the actual owners

An older release such as `d466` has no retained binding service. Obtain explicit authority for an ordinary sealed backend update at each origin, retain the original source runtime under `runtime/releases/<original-digest>`, and verify both newly selected serving revisions through native status. Preserve the original owner home and vault. An adjacent service on an unchanged owner cannot provide this capability through the historical general secret RPC. Keep unresolved rows and retirement ineligible until the original custodians can participate. An opaque copy of an entire vault or live engine configuration exceeds this three-field authority.

Passive `backend install` and `backend upgrade --check` leave the incumbent selected. Retain and independently verify the original execution-owner **and** backend artifacts, management record, and a consistent private backup before selection. The current upgrade client requires recipient handoff-review protocol 1. An incumbent without that protocol requires a separately reviewed cold management transition. Budget for stopping the native service pair and requalifying the original applications and six physical identities. The original containers must still exist for comparison and source sealing. Verify both migration registries and the authority of the rollback writer before changing schemas. If the current release adds an incompatible migration, a separately built and qualified compatible release on the original registries or the documented cold migration and data-return procedure is required. Installing a passive artifact alone cannot perform a vault comparison. See the [host upgrade and native return procedure](../../apps/omnitron/HOST-UPGRADES.md).

Through each independently approved host registration, execute `omnitron retained-bindings identity` as the existing daemon-socket owner. Bind the two public signing and encryption identities to the respective registered node IDs and pinned management endpoints in the operation record. Both key pairs are generated inside each owner's private `retained-bindings/identity.json`. Preserve that file for the permitted session. An owner-key change requires fresh independent enrollment.

The owner can register exact audited Pipeline steps for these commands. Bind each step to one pinned host, one original owner, one reviewed ticket SHA and approved filenames. The operator invoking those steps needs permission for that definition, independently on each owner. The service enforces Unix transport and the local daemon owner principal. A network machine token, even on an enrolled peer, cannot grant or execute the operation. Use an authorized backend update to add the owner implementation before delegating a fixed Pipeline step. Never give the step a general secret verb or a vault file.

## Compare the approved release

Construct the following ticket with the two authenticated identity responses and the accepted release metadata. The six-service declaration can contain other public rows. Every private placeholder in the declaration must occur in exactly one of the three fields above. Bind the exact original container IDs and immutable images recorded in the declaration. The engine endpoint must be the canonical local `/run/.../docker.sock` owned by the source operator. The public manifest SHA comes from the admitted historical release. Hash the **raw bytes** of the public declaration separately.

```json
{
  "protocol": 1,
  "id": "<fresh UUID>",
  "project": "sample",
  "stack": "site",
  "release": "accepted-1",
  "manifestSha256": "<accepted release manifest SHA-256>",
  "declarationSha256": "<exact declaration SHA-256>",
  "master": { "nodeId": "<historical registered UUID>", "identity": { "signing": "<public Ed25519>", "encryption": "<public X25519>" } },
  "source": { "nodeId": "<original registered UUID>", "identity": { "signing": "<public Ed25519>", "encryption": "<public X25519>" } },
  "engineSocket": "/run/docker.sock",
  "purpose": "compare",
  "expiresAt": 0,
  "consumer": null
}
```

Set `expiresAt` to a future Unix timestamp in milliseconds within the next hour. Review the entire ticket on both ends. Its independent SHA-256 uses UTF-8 JSON with recursively sorted object keys, compact separators and no trailing newline. For the fixed ASCII ticket fields, `jq -cSj . ticket.json | shasum -a 256` computes this representation. Both owners check this hash as well as the raw declaration digest.

1. On each owner run `omnitron retained-bindings approve ticket.json --expect "$TICKET_SHA" --declaration declaration.json`. Retain the source's signed approval as `source-approved.json` and deliver it through the registered management route to the original master. This public attestation contains the exact ticket, purpose and expiry.
2. On the master run `omnitron retained-bindings apply "$ID" --expect "$TICKET_SHA" --source-approval source-approved.json --out packet.json`. The master verifies the source's signature before reading its single fixed reference. It computes the historical v1 fingerprint in memory for comparison. ECDH-ES/A256GCM seals this fingerprint to the pinned source key. Ed25519 signs the ticket digest and ciphertext. The CLI creates the new packet file with mode 0600 and prints its length and SHA-256.
3. Transfer that file directly between the two private owner areas with registered file transfer and verify its file digest. Run `omnitron retained-bindings apply "$ID" --expect "$TICKET_SHA" --capsule packet.json --out comparison.json` on the source. The source checks the master signature and its local approval before opening its two fixed references. It asks the local engine for exact full-ID, name, ownership and historical creation-label matches. The engine membership reader consumes only the empty/nonempty prefix of each filtered list.
4. The signed result contains the three row outcomes, the ticket digest and a commitment to the original scope. Each row must be `matched`. A `different` or `unavailable` row closes the path to rematerialization. The later native source seal independently verifies the entire declared allocation, public files and physical identities. Store the public comparison and its source registration together.

## Authorize a closed consumer separately

Make a fresh UUID, expiry and ticket for each purpose, `seal` and later `create-stopped`. Repeat independent approvals on both hosts for each use. Give each `approve` the successful `--comparison comparison.json`. Keep the identical release and both owner keys. Set `consumer` to the following fields.

| Field | Required commitment |
| --- | --- |
| `comparison` | SHA-256 of the canonical **signed** comparison object |
| `helperSha256` | `266fdc08a19f29d03d8d2f60ad2ede0d05175c65e54c83948222b86e1282a89e`, the published eight-module consumer manifest |
| `runtimeSha256` | Exact sealed original Linux owner runtime directory digest |
| `runtimeManifestSha256` | SHA-256 of its original `RUNTIME.json` bytes |
| `optionsSha256` | SHA-256 of the exact source-local public options file bytes |

Stage the eight public modules and `FILES.json` in the source owner's private `retained-bindings/bundles/<helperSha256>/` with both directory levels mode 0700. Produce them with the independently qualified `xec retained-infrastructure bundle` or deliver the original verified public kit. Register the historical Docker Unix socket and confirm the source owner can execute the system Docker CLI through `/usr/bin:/bin`.

Supply `--options options.json` only when approving on the source. Options contain the absolute `directory` set to `<ownerHome>/retained-bindings/returns/<declarationSha256>`, the canonical original Docker `volumeRoot`, and the approved `publicSupplement` path when required by the release. For `create-stopped`, also supply the accepted `seal` SHA and exact native full `nodeStop` UUID. Include the same volume root. A fresh source-signed approval and a newly addressed private packet are required for each purpose.

With that approval the master can seal its one original value to the approved source. The source invokes the separately verified historical Node and eight-module consumer, supplies the three values only on inherited pipe FD 3, discards child stderr and returns the public seal or passive container receipt. The program, operation, options, original release, engine and file set are fixed. The consumer rechecks original state and never starts a writer. The public comparison does not grant this authority. Keep encrypted packets only inside their registered transfer and owner areas, never in Pipeline output or command arguments. The master stores its materialization decision without caching the encrypted value.

`omnitron retained-bindings revoke "$ID" --expect "$TICKET_SHA"` cancels an unused local approval. Revoke on both custodians if withdrawing a bilateral grant. A previously signed approval remains an offline attestation until expiry, and a revoked source always refuses consumption. The source journals dispatch before acting and can return an already-confirmed result during the grant lifetime. If a consumer response is lost before confirmation, inspect its native receipt or stopped allocation before approving a new ticket. A master that has already issued a materialization packet will require fresh bilateral approval to issue another.
