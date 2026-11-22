# Passive host binding inspection

Omnitron can check prepared Bitcoin Core, Monero daemon and Monero wallet RPC systemd units while all three services are inactive. The check covers the canonical unit and config paths, the three separate non-login service accounts and a root-controlled public unit stage. The receipt records the basis for the inspection. It grants no authority to install configurations, start services or use wallet data.

## Review an admitted release

Run the native admin command on the controller with a registered release and a node explicitly pinned in that stack.

```sh
omnitron --json stack review-host-bindings <project> <stack> --release <release> --node-id <node-id> > review.json
pnpm exec xec host-bindings inspect review.json --expect-review <digest> \
  --stage /srv/<area>/host-units-<commit-prefix> --expires <UTC-deadline> > inspect.json
omnitron --json pipeline check inspect.json
```

Use the normal Pipeline save, prepare, digest review and start sequence for the exported graph. The UTC deadline must fall within the next hour. The controller compares the observed and approved SSH fingerprint with the recorded recipient. The Linux step checks the host's public Ed25519 key again and accepts only the three expected unit names in the prepared stage.

The controller reads the application declarations admitted with the exact release, applies the registered stack's mainnet variant and checks each service user and canonical path. It represents every required credential symbolically. The review digest binds the project, stack, release manifest, source commit, registered recipient, SSH pin, unit hashes, template hashes, public chain paths and credential reference mapping. Reports omit the template bodies and vault reference names. The only supported credential directives are the Bitcoin Core `rpcauth` field, Monero's `rpc-login` pair, and the wallet RPC process's additional `daemon-login` pair.

## Inspect a public bundle on an earlier controller

An installed controller that supports the registered Pipeline and `node ssh-key` commands can run the public artifact inspection. The newer `stack review-host-bindings` command requires the corresponding backend. Use the previously reviewed public bundle containing a full source `revision` and three `units` rows with `name`, `user`, `sha256` and `text`.

```sh
pnpm exec xec host-bindings inspect-staged public-units.json --expect-artifact <bundle-sha256> \
  --node-id <node-id> --fingerprint <approved-SSH-fingerprint> \
  --stage /srv/<area>/host-units-<commit-prefix> --expires <UTC-deadline> > inspect.json
omnitron --json pipeline check inspect.json
```

This receipt records `basis=staged-public-units`. It verifies the supplied public artifact and the target host. Application template admission requires the registered-release review above. Both graphs contain hashes and fixed inspection code. Neither graph carries config or unit bodies.

## Interpreting a receipt

`freshDestination=true` requires all three staged hashes to match, separate service UIDs and primary groups without supplementary memberships, inactive systemd units with no PID, fragment, drop-ins or enablement, and absent canonical unit and config paths. An occupied target returns its public filesystem metadata and a failed inspection. A missing stage, untrusted ancestor, symbolic link in the staged path, changed pin, expired graph or unavailable systemd evidence also fails. Service configs are only examined with `stat`. The inspector does not open the service data directories.

| Service | Systemd account | Canonical configuration | Public chain directory |
| --- | --- | --- | --- |
| bitcoind.service | bitcoin | /etc/bitcoin/bitcoin.conf | /var/lib/bitcoind |
| monerod.service | monero | /etc/monero/monerod.conf | /var/lib/monero/.bitmonero |
| monero-wallet-rpc.service | monero-wallet | /etc/monero/monero-wallet-rpc.conf | Outside the public-chain inspection |

## Data placement before a start

The stack's effective `bareMetal.dataDir` selects the serving path. A declared `serviceOverrides.<service>.bareMetal.adopt.from` can supply an existing tree to the normal reconciler on the same filesystem. That reconciliation can also enable and start a unit. Keep it fenced during passive preparation. With the adoption field absent, the ordinary planner may create an empty data directory.

For Bitcoin, require the cold transfer's successful chainstate, block-index, XOR, checkpoint and canonical publication receipts. For Monero, use the independent candidate produced by `lmdb-preseed` and the serving binary's clean offline qualification. Compare the candidate's **post-qualification file identity** from `daemon-checked.json` before placement. A daemon may grow or rewrite its copy while opening it. The sealed source SHA-256 describes the original snapshot. An intervening copy needs an independent digest of the qualified file and the destination. Record the new canonical identity after an approved rename or ownership change with the service still inactive. Release the startup fence only after the separate data and configuration acceptances succeed.

## Private configuration and repeat deployment

The passive operation ends at the public receipt. Config installation under root-owned, service-group-readable permissions and persistent recognition of an accepted private config require a separate implementation and transition. An inaccessible existing config cannot be accepted from its presence, size or public stage receipt.

A future native preparation needs an authenticated controller administrator, a fresh checked release and project allocation, and an independently authorized operation on the exact recipient. The existing pinned mesh service can bind the exchange to its authenticated SSH tunnel. Receiver authority must cover the scope, deadline, service schemas and operation once. The master must derive each reference from the admitted declaration and return only status. The privileged action must use the administrator's local reviewed templates and check the scoped file identities again. Durable recognition must prove the installed bytes and ownership to the ordinary reconciler without granting the daemon read access to other service users' configurations.
