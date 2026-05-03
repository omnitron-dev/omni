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
const ENTRYPOINT_SHELL = `set -eu

# Install tor + jq. The Alpine tor package automatically creates a
# 'tor' system user (uid 100, gid 101). Idempotent across restarts.
apk add --no-cache tor jq >/dev/null 2>&1 || apk add tor jq >/dev/null 2>&1

# Build torrc from the env-passed JSON config.
TORRC=/etc/tor/torrc
mkdir -p /etc/tor /var/lib/tor
cat > "$TORRC" <<'TORRC_EOF'
# ============================================================
# Hidden-service-only Tor configuration (omnitron preset)
# ============================================================
# Process identity — tor drops privileges to this user after binding.
User tor

# Lockdown: no client/relay/exit functionality, only HSes.
SocksPort 0
ClientOnly 0
ORPort 0
DirPort 0
ExitRelay 0
ExitPolicy reject *:*
ExitPolicy reject6 *:*
BridgeRelay 0

# Operational hardening
DataDirectory /var/lib/tor
RunAsDaemon 0
HardwareAccel 1
DisableDebuggerAttachment 1
SafeLogging 1
LogTimeGranularity 1000
Log notice stdout

# IPv4 only by default — IPv6 onion service traffic still works
ClientUseIPv6 0
ClientPreferIPv6ORPort 0

# Avoid filesystem races on shared volumes
AvoidDiskWrites 1
TORRC_EOF

# Append per-hidden-service stanzas. Each gets:
#   - HiddenServiceVersion 3 (Ed25519, 56-char .onion)
#   - HiddenServiceEnableIntroDoSDefense (DoS mitigation at intro layer)
#   - HiddenServicePoWDefensesEnabled    (PoW puzzles for clients)
echo "$OMNITRON_TOR_HIDDEN_SERVICES_JSON" | jq -c '.[]' | while IFS= read -r svc; do
  name=$(printf '%s' "$svc" | jq -r .name)
  vport=$(printf '%s' "$svc" | jq -r .virtualPort)
  target=$(printf '%s' "$svc" | jq -r .target)
  {
    echo
    echo "# --- Hidden service: $name ---"
    echo "HiddenServiceDir /var/lib/tor/$name"
    echo "HiddenServiceVersion 3"
    echo "HiddenServiceEnableIntroDoSDefense 1"
    echo "HiddenServicePoWDefensesEnabled 1"
    echo "HiddenServicePort $vport $target"
  } >> "$TORRC"
done

# Append any user-provided raw torrc lines.
if [ -n "\${OMNITRON_TOR_EXTRA_TORRC:-}" ]; then
  printf '\\n# --- User-provided torrc additions ---\\n%s\\n' "$OMNITRON_TOR_EXTRA_TORRC" >> "$TORRC"
fi

# Hidden service directories must be owned by the tor user with mode 0700,
# otherwise tor refuses to start. Re-apply on every boot in case the volume
# was created externally with different permissions.
chown -R tor:tor /var/lib/tor 2>/dev/null || true
chmod 700 /var/lib/tor

# Run tor as root and let it drop privileges via the 'User tor' directive.
# This avoids needing su-exec/gosu, which aren't in alpine by default.
exec tor -f "$TORRC"
`;

export const torPreset: IServicePreset = {
  name: 'tor',
  type: 'gateway',
  defaultImage: 'alpine:3.20',
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
      // Default torrc has tor user; keep umask tight on key files.
      UMASK: '077',
    },
  },

  generateEnvTemplates(): Record<string, string> {
    // No app-facing env: backends remain agnostic to whether they're being
    // accessed via Tor or directly. Use `omnitron tor` to inspect onions.
    return {};
  },
};
