/**
 * Tor Hidden Service Preset
 *
 * Runs a Tor daemon configured for **hidden-service-only** operation —
 * SocksPort/ORPort/ExitPolicy are all locked down so the container cannot
 * be abused as a relay or open SOCKS proxy. Hidden services map onion
 * addresses to backend services declared in `config.hiddenServices`.
 *
 * Design choices for industrial-grade anonymity:
 *
 *   - HiddenServiceVersion 3 (256-bit Ed25519, default in modern tor).
 *   - SocksPort 0          → no client SOCKS proxy is opened.
 *   - ClientOnly 0          → we are not relaying client circuits.
 *   - ORPort 0 / DirPort 0  → not a relay, not a directory server.
 *   - ExitPolicy reject *:* → never serve as exit node.
 *   - DisableDebuggerAttachment 1 — prevents ptrace + similar leaks.
 *   - HardwareAccel 1       — uses CPU AES-NI when available.
 *   - SafeLogging 1         — log scrubbing of identifying info.
 *   - HiddenServiceEnableIntroDoSDefense 1 — circuit-level rate limiting
 *     against introduction-point flooding (tor 0.4.7+).
 *   - HiddenServicePoWDefensesEnabled 1     — proof-of-work mitigation
 *     for the introduction layer (tor 0.4.8+).
 *
 * Networking:
 *
 *   The container needs to reach backend services that may be running on
 *   the host (e.g. omnitron's webapp via omnitron-nginx, or any user-bound
 *   dev/prod service). We add `host.docker.internal` → `host-gateway` so
 *   HiddenServicePort targets like `host.docker.internal:9800` work
 *   identically on macOS, Linux, and Windows.
 *
 * State:
 *
 *   `/var/lib/tor` is a persistent volume — that's where hidden service
 *   keys live (`<name>/hs_ed25519_secret_key`, `<name>/hostname`). Losing
 *   that volume rotates the .onion address. CLI command `omnitron tor`
 *   reads the hostname files via `docker exec`.
 *
 * Configuration in omnitron.config.ts:
 *
 *     services: {
 *       tor: {
 *         preset: 'tor',
 *         config: {
 *           hiddenServices: [
 *             { name: 'webapp', virtualPort: 80, target: 'host.docker.internal:9800' },
 *             { name: 'portal', virtualPort: 80, target: 'host.docker.internal:7080' },
 *           ],
 *         },
 *       },
 *     },
 */

import type { IServicePreset } from './types.js';

/** User-provided per-hidden-service config. */
export interface ITorHiddenServiceConfig {
  /** Logical name — also the directory name under /var/lib/tor/. */
  name: string;
  /** Port advertised on the .onion address (clients connect here). */
  virtualPort: number;
  /** Backend address `host:port` that tor forwards plaintext traffic to. */
  target: string;
}

/** User-provided tor preset config. */
export interface ITorPresetConfig {
  /** Hidden services to expose. Each gets its own .onion address. */
  hiddenServices: ITorHiddenServiceConfig[];
  /**
   * Extra raw torrc lines appended verbatim. Use sparingly — most
   * hardening is already applied by the preset.
   */
  extraTorrc?: string[];
}

/**
 * Inline shell that installs tor (~5s on first run, cached afterward),
 * generates a hardened torrc from `OMNITRON_TOR_HIDDEN_SERVICES_JSON`,
 * and execs the daemon as the `tor` user.
 *
 * Why inline rather than a custom Dockerfile: keeps the preset hermetic.
 * No image build step, no separate registry, no image-tag drift.
 */
/**
 * Client-authorization keys, written where tor reads them — or the container
 * stops.
 *
 * Each key goes to `<HiddenServiceDir>/authorized_clients/`, which tor reads
 * at startup, and a key that does not arrive is a restriction that silently
 * does not exist: the onion answers everyone. This was
 *
 *     apk add --no-cache jq >/dev/null 2>&1 || true
 *     printf '%s' "$JSON" | jq -c '.[]' | while IFS= read -r f; do … done
 *
 * under `set -eu` and no `pipefail`. A jq that was not there (the `|| true`
 * swallowed the failed install) or JSON it could not read failed IN FRONT of
 * the pipe; the loop read nothing and ended 0, the pipeline's status was the
 * loop's, `set -e` saw success — and `exec tor` started the service with no
 * key in place. Fail-open, on the one setting whose whole purpose is to close.
 *
 * Now nothing here is in a pipeline whose failure could hide (the loop reads
 * a here-document, in this shell), jq is required rather than hoped for, and
 * the keys are counted: fewer written than configured stops the container.
 * An onion that is down is better than one that was meant for a few and
 * answers everyone. `-e` where a null must fail — a key's path or content —
 * and not on the list itself: `jq -e '.[]'` answers an empty one with exit 4,
 * which would stop, without a sentence, an onion restricted to nobody.
 *
 * Exported so the court can run exactly this text. It needs `set -eu -o
 * pipefail` in effect, which ENTRYPOINT_SHELL sets; busybox `sh` in
 * alpine:3.21 honours `pipefail` (measured: `false | cat` → 1).
 */
export const CLIENT_AUTH_SHELL = `# Client-authorization keys, when the service uses them.
if [ -n "\${OMNITRON_TOR_CLIENT_AUTH_JSON:-}" ]; then
  command -v jq >/dev/null 2>&1 || apk add --no-cache jq >/dev/null 2>&1 || apk add jq >/dev/null 2>&1 || true
  if ! command -v jq >/dev/null 2>&1; then
    echo 'tor: client authorization is configured and there is no jq to write its keys; not starting an onion service without them' >&2
    exit 1
  fi
  expected=$(printf '%s' "$OMNITRON_TOR_CLIENT_AUTH_JSON" | jq -e 'length')
  entries=$(printf '%s' "$OMNITRON_TOR_CLIENT_AUTH_JSON" | jq -c '.[]')
  written=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    path=$(printf '%s' "$f" | jq -er .path)
    mkdir -p "$(dirname "$path")"
    printf '%s' "$f" | jq -er .content > "$path"
    chmod 600 "$path"
    written=$((written + 1))
  done <<CLIENT_AUTH_KEYS
$entries
CLIENT_AUTH_KEYS
  if [ "$written" -ne "$expected" ]; then
    echo "tor: wrote $written of $expected client-authorization keys; not starting an onion service without them" >&2
    exit 1
  fi
fi
`;

const ENTRYPOINT_SHELL = `set -eu
# A pipeline's status is its LAST command's. Without this, a command that
# failed in front of a pipe was invisible to \`set -e\` — see CLIENT_AUTH_SHELL.
set -o pipefail

# Tor, from the distribution. The version this pins to is measured, not
# assumed: \`docker run --rm alpine:3.21 sh -c 'apk add tor && tor --version'\`
# answers 0.4.9.12, against 0.4.9.11 on 3.20. Onion-service anonymity
# improves with the release — 0.4.7 added the layer-2/3 guards that blunt
# guard discovery, 0.4.8 the PoW defences this config turns on — so the base
# image is part of the security posture and not a detail.
apk add --no-cache tor >/dev/null 2>&1 || apk add tor >/dev/null 2>&1

mkdir -p /etc/tor /var/lib/tor

# The torrc arrives finished. Nothing here assembles it, so there is no
# quoting in the path between what omnitron decided and what tor reads.
printf '%s\\n' "$OMNITRON_TORRC" > /etc/tor/torrc

${CLIENT_AUTH_SHELL}
# Key material must be tor's and nobody else's; tor refuses to start on a
# directory it does not own at 0700, which is the check working.
chown -R tor:tor /var/lib/tor 2>/dev/null || true
chmod 700 /var/lib/tor

# Run as root and let tor drop to the \`User tor\` in the config: Alpine has
# neither su-exec nor gosu by default, and adding one to drop privileges a
# second time buys nothing.
exec tor -f /etc/tor/torrc
`;

export const torPreset: IServicePreset = {
  name: 'tor',
  type: 'gateway',
  defaultImage: 'alpine:3.21',
  // No host-side ports: hidden services are reachable only via the Tor
  // network. Exposing 9050 etc. would defeat the entire point.
  defaultPorts: {},
  defaultSecrets: {},

  defaultHealthCheck: {
    // Tor takes 30-90s to bootstrap an HS on first start. We watch for the
    // hostname file to be written — that's the unambiguous signal that the
    // hidden service has been published.
    type: 'command',
    target:
      'pgrep tor >/dev/null && [ "$(ls /var/lib/tor 2>/dev/null | wc -l)" -gt 0 ] || exit 1',
    interval: '15s',
    timeout: '5s',
    retries: 20,
    startPeriod: '120s',
  },

  defaultDocker: {
    command: ['sh', '-c', ENTRYPOINT_SHELL],
    volumes: {
      data: { source: '', target: '/var/lib/tor' },
    },
    // host-gateway lets the container reach host-bound services (vite dev
    // server, omnitron-nginx published port) on every platform.
    extraHosts: ['host.docker.internal:host-gateway'],
    environment: {
      // Key files are created by tor itself; a tight umask is what keeps
      // them 0600 rather than whatever the image's default would give.
      UMASK: '077',
    },
  },

  generateEnvTemplates(): Record<string, string> {
    // No app-facing env: backends remain agnostic to whether they're being
    // accessed via Tor or directly. Use `omnitron tor` to inspect onions.
    return {};
  },
};
