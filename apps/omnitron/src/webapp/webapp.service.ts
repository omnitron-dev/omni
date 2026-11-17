/**
 * Webapp Service — Manages the Omnitron Console webapp lifecycle
 *
 * Responsibilities:
 * 1. Build webapp (vite build)
 * 2. Generate nginx config for static serving + API gateway
 * 3. Start/stop omnitron-nginx container
 * 4. Serve webapp on port 9800 with API proxy to daemon HTTP on 9801
 *
 * Architecture:
 *   Browser → :9800 (nginx) → static files (webapp dist/)
 *                             → /api/* → :9801 (daemon Netron HTTP)
 *                             → /ws → :9802 (daemon Netron WebSocket transport)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LONG_REQUEST_TIMEOUT } from '../shared/dto/services.js';
import { OMNITRON_HOME } from '../config/defaults.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import {
  createContainer,
  removeContainer,
  getContainerState,
  stopContainer,
  waitForHealthy,
  ensureImage,
  containerSpecHash,
} from '../infrastructure/container-runtime.js';
import { resolveOmnitronNginx } from '../infrastructure/service-resolver.js';
import { consoleContainerName, assertConsoleOwnership, consoleEndpoint, assertConsoleBuild, inspectInstalledConsole, assertConsoleOperatorAllowed, withConsoleOperator, saveConsoleBootPolicy } from './console-container.js';
import { readSavedDaemonConfig, withInstancePolicy } from '../config/saved.js';
import { readBuildStamp } from '../shared/build-stamp.js';
import { readColdBatch, type ColdBatch } from '../project/cold-stack-start.js';
import type { RuntimeUpdateReference } from '../shared/dto/runtime-update.js';

const exec = promisify(execFile);

// =============================================================================
// Nginx Config Template
// =============================================================================

/**
 * The console's security headers.
 *
 * Repeated verbatim in every location block that sets any header of its own:
 * nginx's `add_header` does not merge with an outer scope — declaring one
 * header inside a location DROPS every header inherited from `server`. That
 * rule silently stripped Referrer-Policy and Permissions-Policy from
 * index.html the first time this config was deployed.
 */
const SECURITY_HEADERS = [
  'add_header X-Content-Type-Options "nosniff" always;',
  'add_header Referrer-Policy "no-referrer" always;',
  'add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;',
  // style-src allows 'unsafe-inline' because Emotion (MUI's engine) injects
  // component styles as inline <style> at runtime; script-src does not, which
  // is the half that matters for injection.
  `add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;`,
];

/** Render the header set at a given indentation. */
function securityHeaders(indent: string): string {
  return SECURITY_HEADERS.map((h) => `${indent}${h}`).join('\n');
}

// The Console is the trusted forwarding hop. Replace caller-supplied addresses
// on every proxied route, including the WebSocket upgrade.
const CLIENT_ADDRESS_HEADERS = `proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Real-IP $remote_addr;`;

export function generateNginxConfig(apiHost: string, apiPort: number, wsPort: number): string {
  return `
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    sendfile        on;
    tcp_nopush      on;
    tcp_nodelay     on;
    keepalive_timeout 65;
    client_max_body_size 100m;

    # Only successful immutable responses may be retained. Caching a missing
    # lazy chunk pins a browser to its 404 even after a complete build is served.
    # Re-evaluate after a filter changes 200 to an error (e.g. an invalid range).
    map $status $omnitron_hashed_asset_cache {
        volatile;
        default "no-store";
        200 "public, max-age=31536000, immutable";
        206 "public, max-age=31536000, immutable";
        304 "public, max-age=31536000, immutable";
    }
    map $status $omnitron_asset_cache {
        volatile;
        default "no-store";
        200 "public, max-age=3600, must-revalidate";
        206 "public, max-age=3600, must-revalidate";
        304 "public, max-age=3600, must-revalidate";
    }

    # Gzip compression for static assets
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # Don't advertise the nginx version on every response / error page.
    server_tokens off;

    server {
        listen 80;
        server_name _;

        # Webapp static files
        root /usr/share/nginx/html;
        index index.html;

        # --- Security headers -------------------------------------------------
        # The console is an infrastructure control plane: it can start and stop
        # processes, read logs and hold an operator session. It had no security
        # headers at all, so a single injected script or a framing page was
        # enough to drive it.
        #
        # The 'always' flag is required — without it nginx omits the header on
        # error responses, which is exactly where an injection would surface.
${securityHeaders('        ')}

        # API Gateway — proxy to daemon Netron HTTP
        location /netron/ {
            proxy_pass http://${apiHost}:${apiPort}/netron/;
            proxy_set_header Host $host;
            ${CLIENT_ADDRESS_HEADERS}
            proxy_set_header X-Forwarded-Proto $scheme;
            # Deliver the daemon's final receipt before a gateway deadline can replace it with a 504.
            proxy_read_timeout ${LONG_REQUEST_TIMEOUT + 5_000}ms;
            proxy_send_timeout 120s;
        }

        # Health endpoint (under /api/ prefix to avoid SPA route conflicts)
        location /api/health {
            proxy_pass http://${apiHost}:${apiPort}/health;
            ${CLIENT_ADDRESS_HEADERS}
        }

        # Metrics endpoint (under /api/ prefix to avoid SPA route conflicts)
        location /api/metrics {
            proxy_pass http://${apiHost}:${apiPort}/metrics;
            ${CLIENT_ADDRESS_HEADERS}
        }

        # WebSocket support — the daemon's Netron WS transport listens on a
        # separate port (httpPort + 2 = 9802) and serves at the root path, so
        # the trailing slash rewrites "/ws" → "/" on the upstream.
        location /ws {
            proxy_pass http://${apiHost}:${wsPort}/;
            ${CLIENT_ADDRESS_HEADERS}
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            # Forward the FULL Host incl. port ($http_host, not $host which
            # strips it). The daemon's WS same-host origin guard compares the
            # Origin header's host ("localhost:9800") against request Host; with
            # the port stripped it sees "localhost" and rejects every upgrade,
            # leaving the console stuck on HTTP polling.
            proxy_set_header Host $http_host;
            proxy_set_header Origin $http_origin;
            proxy_read_timeout 3600s;
        }

        # Vite emits content-hashed asset filenames — "alerts-CEojylud.js":
        # a DASH, then a base64url hash. (An earlier pattern here expected a
        # dot and lowercase hex, matched nothing, and quietly demoted every
        # asset to the 1-hour bucket below.) A changed file gets a new name,
        # so these are immutable. Must precede the SPA fallback location.
        location ~* "-[A-Za-z0-9_-]{8,}\\.(js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico|map)$" {
            add_header Cache-Control $omnitron_hashed_asset_cache always;
${securityHeaders('            ')}
            try_files $uri =404;
        }

        # Unhashed assets still get a short cache with revalidation.
        location ~* "\\.(js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico)$" {
            add_header Cache-Control $omnitron_asset_cache always;
${securityHeaders('            ')}
            try_files $uri =404;
        }

        # index.html must never be cached: it carries the hashed asset names,
        # so a stale copy pins the whole app to a previous deploy.
        location = /index.html {
            add_header Cache-Control "no-cache, must-revalidate" always;
${securityHeaders('            ')}
        }

        location = /console-version.json {
            add_header Cache-Control "no-store" always;
${securityHeaders('            ')}
            try_files $uri =404;
        }

        # SPA fallback — all non-file routes serve index.html
        location / {
            try_files $uri $uri/ /index.html;
        }
    }
}
`.trim();
}

// =============================================================================
// Service
// =============================================================================

export class WebappService {
  private readonly configDir: string;

  constructor(
    private readonly logger: ILogger,
    private readonly publication?: { port: number; bindHost: () => Promise<string> },
    private readonly webappDir = fileURLToPath(new URL('../../webapp/', import.meta.url)),
  ) {
    // Generated configuration belongs to the instance. Writing into the
    // package would invalidate a sealed backend artifact on its first boot.
    this.configDir = path.join(OMNITRON_HOME, 'webapp', 'nginx');
  }

  /**
   * Build the webapp using vite.
   */
  async build(): Promise<{ distPath: string; duration: number }> {
    const start = Date.now();
    this.logger.info('Building Omnitron Console webapp...');

    const builder = path.join(this.webappDir, '../scripts/build-console.mjs');
    if (!fs.existsSync(builder) || !fs.existsSync(path.join(this.webappDir, 'src'))) {
      throw new Error('Console source is not installed. Build from the Omnitron source checkout and deploy its prebuilt webapp/dist.');
    }

    try {
      // The same staged, typechecked publication as `pnpm build`. Never run
      // Vite against the directory nginx is serving: it empties outDir first.
      await exec(process.execPath, [builder], {
        cwd: this.webappDir,
        timeout: 600_000,
      });
    } catch (err: any) {
      throw new Error(`Webapp build failed: ${err.stderr?.slice(0, 300) ?? err.message}`, { cause: err });
    }

    const distPath = path.join(this.webappDir, 'dist');
    if (!fs.existsSync(distPath)) {
      throw new Error(`Build succeeded but dist/ not found at ${distPath}`);
    }

    const duration = Date.now() - start;
    this.logger.info({ distPath, duration }, 'Webapp built successfully');
    return { distPath, duration };
  }

  async start(options: { force?: boolean; temporary?: boolean } = {}) {
    await assertConsoleOperatorAllowed(OMNITRON_HOME);
    const prepared = await this.prepare(null);
    return withConsoleOperator(() => this.startLocked(Boolean(options.force), prepared, !options.temporary));
  }

  /** Cold startup owns the reviewed Console, including a distinct retained Console during restoration. */
  async startOnBoot(startup: ColdBatch | null): Promise<void> {
    const prepared = (startup ? startup.console !== null : readSavedDaemonConfig()?.webapp)
      ? await this.prepare(startup?.console ?? null) : null;
    await withInstancePolicy(OMNITRON_HOME, async () => {
      const batch = await readColdBatch(OMNITRON_HOME);
      if (batch?.digest !== startup?.digest || batch?.direction !== startup?.direction ||
          batch && !['starting', 'verifying', 'restoring'].includes(batch.phase))
        throw Error('Console startup no longer belongs to the reviewed local update');
      const enabled = Boolean(readSavedDaemonConfig()?.webapp);
      if (batch && Boolean(batch.console) !== enabled) throw Error('Saved Console policy differs from the reviewed local update');
      if (enabled && prepared) await this.startLocked(false, prepared, false);
    });
  }

  private async prepare(release: RuntimeUpdateReference | null) {
    if (!this.publication) throw Error('Console start requires the serving daemon publication policy');
    const localDist = path.join(this.webappDir, 'dist');
    // Native startup has verified its own release. A different Console needs its own seal.
    const { dist, inspection } = release ? await inspectInstalledConsole(OMNITRON_HOME, release, localDist) : { dist: localDist, inspection: undefined };
    const prior = await getContainerState(consoleContainerName(), { orThrow: true, fullId: true });
    if (prior) assertConsoleOwnership(prior);
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      if (release) throw Error('Reviewed Console index.html is missing');
      await this.build();
    }
    const image = resolveOmnitronNginx().image;
    await ensureImage(image);
    return { dist, release, image, inspection };
  }

  private async startLocked(force: boolean, prepared: Awaited<ReturnType<WebappService['prepare']>>, persist: boolean) {
    const { dist, release, image, inspection } = prepared;
    const { port } = this.publication!;
    const bindHost = await this.publication!.bindHost();
    const nginxConfig = generateNginxConfig('host.docker.internal', port + 1, port + 2);
    const configPath = path.join(this.configDir, 'nginx.conf');
    const appliedConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;
    const spec = resolveOmnitronNginx({ port, internalApiPort: port + 1, webappDistPath: dist, bindHost, image });
    spec.volumes.push({ source: configPath, target: '/etc/nginx/nginx.conf', readonly: true });
    const hash = containerSpecHash(spec);
    const inspect = () => getContainerState(spec.name, { orThrow: true, fullId: true });
    const prior = await inspect();
    const priorId = prior && assertConsoleOwnership(prior);
    await inspection?.assertUnchanged();
    if (!fs.statSync(path.join(dist, 'index.html')).isFile()) throw Error('Console index.html is not a regular file');
    const stamp = readBuildStamp(dist);
    if (!stamp || release && (stamp.commit !== release.commit || stamp.dirty)) throw Error('Console build differs from the selected release');

    const confirm = async (expectedId: string) => {
      const serving = await inspect();
      if (!serving) throw Error('Console creation has no native receipt');
      const id = assertConsoleOwnership(serving);
      const bindings = serving.portBindings?.['80/tcp'];
      if (id !== expectedId || serving.status !== 'running' || serving.specHash !== hash ||
          serving.image !== spec.image || !bindings?.length || bindings.some(value => value.port !== port || value.address !== bindHost) ||
          !spec.volumes.every(volume => serving.mounts?.some(mount => mount.target === volume.target && mount.source === volume.source && mount.readOnly === true)))
        throw Error('The native Console differs from the requested container specification');
      if (serving.health !== 'healthy' && !await waitForHealthy(id, 30_000)) throw Error('Console health was not confirmed within 30 seconds');
      await assertConsoleBuild(serving, stamp);
      return { running: true, healthy: true, ...consoleEndpoint(serving) };
    };

    if (!force && prior?.status === 'running' && prior.specHash === hash && appliedConfig === nginxConfig) {
      const status = await confirm(priorId!);
      return { ...status, autoStart: persist ? saveConsoleBootPolicy(true) : readSavedDaemonConfig()?.webapp ?? null };
    }
    // The saved boot flag is also the durable operator intent if the process exits during the Docker operation.
    const autoStart = persist ? saveConsoleBootPolicy(true) : readSavedDaemonConfig()?.webapp ?? null;
    if (priorId) await removeContainer(priorId, { graceful: true });
    fs.mkdirSync(this.configDir, { recursive: true });
    fs.writeFileSync(configPath, nginxConfig, 'utf8');
    const created = await createContainer(spec, { fullId: true, pull: 'never' });
    return { ...await confirm(created), autoStart };
  }

  /** Explicit stop also works with a failed daemon. Shutdown preserves its next-start policy. */
  async stop(shutdown = false): Promise<boolean | null> {
    const stop = async () => {
      if (shutdown && !readSavedDaemonConfig()?.webapp) return null;
      const inspect = () => getContainerState(consoleContainerName(), { orThrow: true, fullId: true });
      const state = await inspect();
      const id = state && assertConsoleOwnership(state);
      const autoStart = shutdown ? true : saveConsoleBootPolicy(false);
      if (id) {
        try {
          await stopContainer(id, 5);
          await removeContainer(id);
        } catch (error) {
          if (await inspect()) throw error;
          return autoStart;
        }
        if (await inspect()) throw Error('Console removal is unconfirmed');
      }
      return autoStart;
    };
    return shutdown ? withInstancePolicy(OMNITRON_HOME, stop) : withConsoleOperator(stop);
  }

  async status(): Promise<{ running: boolean; port: number; healthy: boolean; url: string }> {
    const state = await getContainerState(consoleContainerName(), { orThrow: true, fullId: true });
    if (state) assertConsoleOwnership(state);
    if (state?.status === 'running') return { running: true, healthy: state.health === 'healthy', ...consoleEndpoint(state) };
    const port = this.publication?.port ?? readSavedDaemonConfig()?.httpPort ?? 9800;
    return { running: false, healthy: false, port, url: 'http://localhost:' + port };
  }

  /**
   * Check if webapp is built.
   */
  isBuilt(): boolean {
    return fs.existsSync(path.join(this.webappDir, 'dist', 'index.html'));
  }
}
