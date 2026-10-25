# Host-owned public ingress

Omnitron's `OmnitronInfra` RPC service owns one public OpenResty container per Linux host, independently of application stacks and daemon restarts. The native CLI and the Webapp's typed `IOmnitronInfraService` use the same API. Stopping an app stack or running ordinary `infra down` does not select this container: it has dedicated `omnitron.host-ingress.*` labels and deliberately has no `omnitron.managed`, project or stack label.

## Host setup

The host needs Docker, Linux `flock` (util-linux), and the explicitly chosen OpenResty image already pulled by digest. Publication uses `--pull never`; an app release cannot silently upgrade the proxy image. State belongs to the daemon account at `~/.omnitron/host-ingress`, with private immutable certificate snapshots and configuration generations. Back up this directory with restrictive permissions; it contains private keys. Certificate source files remain in a separate administrator-owned directory.

Configure once with `omnitron --json infra ingress configure host.json`:

```json
{
  "image": "openresty/openresty@sha256:<actual-64-character-image-digest>",
  "httpPort": 80,
  "httpsPort": 443,
  "controlPort": 18280,
  "certificateRoot": "/etc/omnitron/ingress-certs",
  "proxyPolicy": {
    "mode": "cloudflare-only",
    "trustedCidrs": ["173.245.48.0/20", "2400:cb00::/32"]
  }
}
```

The two CIDRs above only illustrate the schema; supply the complete currently approved Cloudflare IPv4 and IPv6 list. No ranges are fetched or trusted implicitly. Cloudflare-only mode admits requests by the actual socket peer, while obtaining the client address only from configured trusted peers. Direct mode is `{ "mode": "direct", "trustedCidrs": [] }` and does not trust forwarding headers. Public unknown HTTP hosts are dropped; unknown TLS SNI is rejected. The control-generation listener binds only to `127.0.0.1`.

Configuration does not start a container or claim public ports. Host settings are immutable after configuration; image, ports, trust policy or certificate root changes require a separate planned host migration. This first version does not provide an in-place host-settings migration command. There is no automatic image adoption, container adoption, certificate issuance or DNS mutation.

## Application transaction

`omnitron --json infra ingress status` returns `{ "ok": true, "data": { ... } }`, including `generation`, `observedGeneration`, `applications` and `recoveryPending`. RPC methods return the inner object. Read the current generation and create an application manifest:

```json
{
  "expectedGeneration": null,
  "owner": { "project": "example-production", "stack": "web", "app": "public" },
  "reservedPorts": [4611, 4620, 5544, 6394],
  "routes": [{
    "domains": ["example.test"],
    "maxBodyBytes": 16777216,
    "tls": { "certificate": "example/origin.pem", "privateKey": "example/origin.key" },
    "locations": [
      { "path": "/netron", "deny": 404 },
      { "path": "/api/site/", "upstream": { "host": "127.0.0.1", "port": 4611 }, "stripPrefix": true },
      { "path": "/", "upstream": { "host": "127.0.0.1", "port": 4611 }, "stripPrefix": false }
    ]
  }]
}
```

Use `null` only for the first publication. Later requests must carry the exact current generation string. Each owner is the full `(project, stack, app)` tuple, and an apply replaces that owner's entire route/port declaration. Every declared TCP port is reserved, including database, cache and internal services; all HTTP upstream ports are also included automatically. Duplicate normalized domains and ports across owners are rejected. A hostname must be exact; the certificate's SAN may use a matching wildcard. IP hostnames, URL-shaped names, arbitrary Nginx directives and remote/DNS upstreams are rejected. Allowed upstreams are literal `127.0.0.1` and `::1` only.

Under the existing host deployment lease:

1. Read status and prepare a manifest using its generation.
2. Run `omnitron --json infra ingress check tenant.json` **before provisioning application infrastructure**. `checkHostIngress` validates ownership, all reserved ports, route schema, certificate SAN/validity and private-key match. It writes no snapshots, publishes no routes and reserves no ports. Its receipt explicitly reports `nativeConfigValidated: false`. This admission check does not replace the final CAS or `nginx -t`, and it cannot govern legacy deploy paths that bypass the host registry.
3. Start/update the application's private services and verify readiness using their application contract.
4. Run `omnitron --json infra ingress apply tenant.json`. `applyHostIngress` snapshots TLS, checks the complete configuration with native OpenResty, and publishes only after successful validation. A receipt contains `generation`, `previousGeneration`, `observedGeneration`, `changed` and `owner`. On generation conflict, reread status, retain the intended owner declaration, recheck ownership and retry with the new generation; do not replace the complete host registry. Other failures require their actual cause to be resolved.
5. Probe the public hostname with verified TLS and application-specific health criteria. The ingress acknowledgment proves the running configuration generation; it does not prove upstream application readiness or DNS/Cloudflare propagation.

`maxBodyBytes` defaults to 16 MiB and accepts safe integers from 1 through 128 MiB. Applications can enforce stricter limits. Proxy prefixes end in `/`; `stripPrefix: true` replaces that prefix with `/`. A deny entry matches its exact path and slash-delimited descendants. Overriding children of a deny are rejected. WebSocket upgrade and unbuffered upstream responses are supported, with 5-second connect and 60-second read timeouts. Access logs record method, normalized path and status, excluding query strings.

To remove one owner, pass `{ "owner": {...}, "expectedGeneration": "..." }` to `omnitron --json infra ingress remove removal.json` / `removeHostIngress`. The remaining owners remain in the next generation. Removing the final owner leaves an empty, rejecting host proxy. Decommissioning the host itself is an explicit administrator operation.

## Publication and recovery

Cross-process publication uses a Linux kernel lock whose holding subprocess exits when its parent pipe closes. There is no stale PID-file deletion. Generations and TLS objects are immutable and content-checked. A candidate is written and synced, validated with `nginx -t`, and then selected by an atomic symlink rename with directory fsync. The durable journal records the previous and candidate generations. A reload/start is successful only after a fresh request to the loopback control endpoint observes the candidate generation.

Validation failure leaves the old pointer and live configuration alone. Start/reload/acknowledgment failure restores and acknowledges the previous generation. An initial failed publication removes only the positively owned host container. If rollback cannot complete, the journal remains and the error says recovery is required. `omnitron --json infra ingress recover` / `recoverHostIngress` retries recovery. Apply/remove also recover a pending journal before CAS. A prepared journal rolls back; an acknowledged journal completes the committed generation. Status is read-only and exposes pending recovery. Recovery is operation-triggered, not a background watchdog; after a host/process crash, explicitly recover before continuing deployment.

The runtime refuses foreign or drifted containers instead of adopting them. Settings, manifest/config hashes and certificate object hashes are checked before reactivation. Same-owner identical desired content is idempotent but still requires CAS and a live generation acknowledgment. Certificate rotation produces a new snapshot and generation; old snapshots are retained for rollback. Automatic garbage collection is not part of this version.

The proxy runs with one worker, one CPU, 256 MiB memory, 64 PIDs, a 64 MiB temporary mount and rotated Docker logs. Shared proxy capacity remains a shared resource; this provides bounded consumption and configuration isolation, not total failure isolation. Disk/full-filesystem, Docker/host failure, external deletion and prolonged upstream outage remain operational failure modes. File/journal tests and native local tests cover specific faults rather than proving all crash or power-loss sequences.

## Host upgrades and first migration

An application deployment must use the installed framework; changing the host framework is a separate controlled transaction. A daemon upgrade can stop all supervised applications even while this independent ingress container remains running. Plan an application outage and use the host-upgrade inventory/rebind/restore contract; do not hide framework activation inside one tenant's release. Existing long-lived client connections and application-level recovery require their own validation.

For the initial move from an app-owned public proxy, inventory every tenant and listener, retain the old TLS/config/container rollback material, stage the new host settings and certificates, validate the tenant admission manifest, and coordinate the public-port handoff under the host lease. The old container must release ports 80/443 before the new host container can start. Do not stop unrelated stacks or let an app teardown own the new host proxy. This source change performs no production handoff by itself.

## Verification

Run the focused suite and existing infrastructure RPC regressions. The optional native test needs local Docker, a cached digest-pinned OpenResty image, cached `node:22.14.0-bookworm-slim`, the unused dedicated container name, and unused test ports 28080/28443/28280/28461/28471:

```sh
OMNITRON_INGRESS_DOCKER_TEST_IMAGE='openresty/openresty@sha256:<cached-image-digest>' \
  pnpm --filter @omnitron-dev/omnitron exec vitest run test/unit/host-ingress.test.ts
pnpm --filter @omnitron-dev/omnitron exec tsc --noEmit -p tsconfig.build.json
```

Native checks exercise two-tenant HTTPS routing, prefix rewriting, denied paths, unknown-host rejection, upload limits, removal while the second tenant remains live, and Linux kernel-lock exclusion/release after SIGKILL. Fault-injection tests cover failed validation, activation, acknowledgment, rollback, journal recovery, certificate corruption, CAS conflicts and ownership conflicts. Native tests use temporary high ports and remove their own container; they must not run on a host already serving production with that container name.
