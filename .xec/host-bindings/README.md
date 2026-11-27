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

The Pipeline executor needs a CLI with `node ssh-key --expect`. It can inspect a staged artifact with an earlier backend that supports registered Pipelines and `OmnitronTerminal.inspectHost`. An executor running the earlier CLI can continue a previously reviewed definition from its matching exporter. The newer `stack review-host-bindings` command requires the corresponding backend. Use the previously reviewed public bundle containing a full source `revision` and three `units` rows with `name`, `user`, `sha256` and `text`.

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

After an independently authorized local installer places the exact rendered configuration, it can record what it installed. Run the native command as root on that Linux recipient. Each profile selects the fixed path, service account and unit listed above.

```sh
omnitron --json host-config attest bitcoin
omnitron --json host-config attest monero-daemon
omnitron --json host-config attest monero-wallet-rpc
```

The installed file must begin with `# managed-by: omnitron` followed by a newline. It must be a regular single-link file of up to 128 KiB owned by root and the service's primary group with mode `0640`. All ancestor directories must be root-owned and protected against group or other writes. Give the node daemon search permission on those directories so it can check file identity. The service and `omnitron` need separate non-root accounts and dedicated primary groups with no membership in each other's group. Issuing and verifying evidence use Linux `/usr/bin/python3` and the system account database. The installer rejects extended POSIX ACLs on the configuration. Both operations check access protection on the evidence directory and record.

The installer reads the installed bytes from one descriptor and publishes a private keyed commitment bound to the profile, path and file identity. It stores the evidence in `/var/lib/omnitron-host-config-proofs`, a root-owned `0711` directory. The record is `0440` for root and the daemon's primary group. The JSON response contains the profile, path, protocol version and an opaque installation receipt. The command can be repeated after a lost acknowledgement.

Normal host inspection and provisioning compare the exact configuration rendered by the stack, including whitespace, to that record. The daemon checks the current device, inode, owner, group, mode, link count, size and change timestamps. It reports `verified-private` on a match and checks the receipt again before a planned action. A permission error, stale receipt, unresolved value, missing previously recorded file or mismatch yields `unreadable` and refuses reconciliation for that service. An authorized installer must re-attest a replaced or changed file. An ordinary unrecorded file established to be absent follows the existing create path. Coordinate installer rotations with deployments and keep passive preparation fenced from normal lifecycle actions.

The recipient needs a backend and local CLI containing this feature. Earlier recipients do not distinguish read denial from absence. The controller uses the existing provisioning protocol. A stack consisting entirely of host services can report ready once the node observes them settled. A queued or activating systemd job needs a subsequent observation. The public stage inspection remains available independently.

## Initial installation on a passive recipient

The controller administrator selects a saved `prepare-release` source approval and its registered recipient. Review its public service binding digest. Choose a fresh version-4 UUID for the installation ticket.

```sh
omnitron --json stack review-host-bindings PROJECT STACK --release RELEASE \
  --prepared PREPARED_SHA256 --node-id NODE_ID
```

The recipient administrator opens one short-lived authorization on the intended Linux machine. Run this native command as root with the reviewed digest, the registered node ID, the same ticket and a UTC deadline within the next ten minutes. The command waits for the matching operation and returns its public receipt.

```sh
omnitron --json host-config receive TICKET --review REVIEW_SHA256 --node-id NODE_ID --expires UTC_DEADLINE
```

While that authorization is open, the controller administrator runs the following command.

```sh
omnitron --json stack install-host-configs PROJECT STACK --release RELEASE --prepared PREPARED_SHA256 \
  --node-id NODE_ID --review REVIEW_SHA256 --ticket TICKET
```

The master rechecks the saved source and recipient through an authenticated, SSH-pinned mesh connection. Xec opens `/run/omnitron-host-config/TICKET.sock` on the same registered host. The initial implementation requires the registry's existing root SSH route and its Ed25519 host key at the root-controlled public path `/etc/ssh/ssh_host_ed25519_key.pub`. The socket directory belongs to root with mode `0700`. The recipient checks all three template digests, service UIDs and dedicated groups, inactive units and destination paths before the master reads the declared service vault entries. Each supported credential field requires a symbolic vault reference without a default. The supported Bitcoin credential is `username:32-hex-salt$64-hex-HMAC`. The supported Monero user and password components use 1–256 ASCII letters, digits or `_.~@+-/=`.

Check the existing effective SSH policy for the registered account, source address and port, including any matching `sshd_config` blocks and restrictions on the accepted key. The disposable Linux fixture uses `sshd -T -C` and exercises the actual channel. Its accepted configuration has `AllowTcpForwarding local`, `AllowStreamLocalForwarding local`, `DisableForwarding no`, `PermitOpen any`, public-key authentication and `MaxSessions 0`. Its accepted key is restricted to loopback and permits forwarding. A key with `restrict` alone, a key permitting only a TCP destination, or a daemon with `AllowTcpForwarding no` refuses the ticket socket. The command reports a forwarding refusal before it reads service values. These fixture settings describe the qualification. On a managed node the administrator checks the existing route and its exact socket authorization. The operation itself only requests the single Unix channel. [OpenSSH channel authorization](https://github.com/openssh/openssh-portable/blob/master/session.c)

On success, each canonical configuration is a single-link `0640` regular file owned by root and its service group, with an independent installer attestation. Initial evidence uses Linux `renameat2(RENAME_NOREPLACE)` and requires local Python 3 and libc support. Both ends return the same receipt for the three file identities. Configuration values travel in the protected channel. Linux writes a root-only recovery journal under `/var/lib/omnitron-host-config-install`. The service manager is queried for inactive state throughout initial installation. Startup and data acceptance retain their separate approvals.

After a lost acknowledgement, authorize the **same ticket and review** again and repeat the controller call. While the recipient remains passive, a complete unchanged installation returns the prior receipt without reading service vault entries. For a partial publication the installer checks its recorded staged inodes and compares their bytes before continuing. A changed or foreign file, expired grant, unavailable mesh credential, or host key mismatch stops delivery. The initially supported operation preserves occupied files and requires independent review for rotation or conflicting installations. Following a machine crash before the first recovery journal became durable, root may find an unpublished `.omnitron-config-*` staging file beside the target. Preserve it for local inspection. Only journaled file identities participate in automatic recovery.

Installation requires the controller API and recipient CLI that implement this operation. Earlier controllers can inspect the public stage and cannot issue a scoped passive private installation. Later routine deployments recognize the installed files using the recipient's private-config evidence.
