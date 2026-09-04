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
} from '../infrastructure/container-runtime.js';
import { resolveOmnitronNginx } from '../infrastructure/service-resolver.js';

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
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 120s;
            proxy_send_timeout 120s;
        }

        # Health endpoint (under /api/ prefix to avoid SPA route conflicts)
        location /api/health {
            proxy_pass http://${apiHost}:${apiPort}/health;
        }

        # Metrics endpoint (under /api/ prefix to avoid SPA route conflicts)
        location /api/metrics {
            proxy_pass http://${apiHost}:${apiPort}/metrics;
        }

        # WebSocket support — the daemon's Netron WS transport listens on a
        # separate port (httpPort + 2 = 9802) and serves at the root path, so
        # the trailing slash rewrites "/ws" → "/" on the upstream.
        location /ws {
            proxy_pass http://${apiHost}:${wsPort}/;
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
            add_header Cache-Control "public, max-age=31536000, immutable" always;
${securityHeaders('            ')}
            try_files $uri =404;
        }

        # Unhashed assets still get a short cache with revalidation.
        location ~* "\\.(js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico)$" {
            add_header Cache-Control "public, max-age=3600, must-revalidate" always;
${securityHeaders('            ')}
            try_files $uri =404;
        }

        # index.html must never be cached: it carries the hashed asset names,
        # so a stale copy pins the whole app to a previous deploy.
        location = /index.html {
            add_header Cache-Control "no-cache, must-revalidate" always;
${securityHeaders('            ')}
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
  private readonly webappDir: string;
  private readonly configDir: string;

  constructor(
    private readonly logger: ILogger,
    _projectRoot?: string,
    private readonly apiPort: number = 9801,
    private readonly publicPort: number = 9800
  ) {
    // Resolve webapp dir — find it relative to this module's location (not CWD)
    const thisDir = path.dirname(new URL(import.meta.url).pathname);
    // thisDir = .../apps/omnitron/src/webapp/ or .../apps/omnitron/dist/webapp/
    const omnitronRoot = path.resolve(thisDir, '..', '..');
    this.webappDir = path.join(omnitronRoot, 'webapp');
    this.configDir = path.join(omnitronRoot, 'node_modules', '.omnitron-nginx');
    fs.mkdirSync(this.configDir, { recursive: true });
  }

  /**
   * Build the webapp using vite.
   */
  async build(): Promise<{ distPath: string; duration: number }> {
    const start = Date.now();
    this.logger.info('Building Omnitron Console webapp...');

    try {
      // Use vite build directly from webapp dir (avoids needing monorepo root for pnpm --filter)
      await exec('npx', ['vite', 'build'], {
        cwd: this.webappDir,
        timeout: 120_000,
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

  /**
   * Start the omnitron-nginx container serving the webapp.
   * If the container is already running and healthy, skips recreation.
   * Pass force=true to always recreate the container (e.g. after config changes).
   */
  async start(options?: { force?: boolean }): Promise<void> {
    const force = options?.force ?? false;

    // 1. Render the config we WANT before deciding whether to keep the running
    //    container.
    //
    //    This ordering matters. `start()` used to return as soon as it saw a
    //    healthy container, without ever comparing configuration — so an
    //    edit to the nginx template took effect only if someone happened to
    //    remove the container by hand. The security headers added in this
    //    same change went live only after a manual recreate, which is exactly
    //    the drift the infrastructure reconciler already guards against for
    //    every other managed container.
    //
    //    WS transport lives on httpPort + 2; daemon HTTP (apiPort) is
    //    httpPort + 1.
    const nginxConfig = generateNginxConfig('host.docker.internal', this.apiPort, this.apiPort + 1);
    const configPath = path.join(this.configDir, 'nginx.conf');
    const appliedConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null;
    const configChanged = appliedConfig !== nginxConfig;

    // 2. Keep a healthy container only when it is running the current config.
    if (!force && !configChanged) {
      const state = await getContainerState('omnitron-nginx');
      if (state?.status === 'running') {
        if (state.health === 'healthy') {
          this.logger.info({ port: this.publicPort }, 'Omnitron Console is already running');
          return;
        }
        // Running but not healthy — stop and recreate
        this.logger.warn('Nginx container running but not healthy — recreating...');
      }
    } else if (configChanged && appliedConfig !== null) {
      this.logger.info('Nginx config changed — recreating the console container');
    }

    // 3. Check webapp is built
    const distPath = path.join(this.webappDir, 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      this.logger.info('Webapp not built — building now...');
      await this.build();
    }

    fs.writeFileSync(configPath, nginxConfig, 'utf-8');
    this.logger.info({ configPath }, 'Generated nginx config');

    // 4. Remove existing container if any
    await removeContainer('omnitron-nginx');

    // 5. Create container
    const containerSpec = resolveOmnitronNginx({
      port: this.publicPort,
      internalApiPort: this.apiPort,
      webappDistPath: distPath,
    });

    // Add nginx config mount
    containerSpec.volumes.push({
      source: configPath,
      target: '/etc/nginx/nginx.conf',
      readonly: true,
    });

    await ensureImage(containerSpec.image);
    await createContainer(containerSpec);

    // 6. Wait for healthy
    const healthy = await waitForHealthy('omnitron-nginx', 30_000);
    if (healthy) {
      this.logger.info({ port: this.publicPort }, 'Omnitron Console available');
    } else {
      this.logger.warn('Nginx started but health check not passing yet');
    }
  }

  /**
   * Stop the omnitron-nginx container.
   */
  async stop(): Promise<void> {
    try {
      await stopContainer('omnitron-nginx', 5);
    } catch {
      // Already stopped
    }
    await removeContainer('omnitron-nginx');
    this.logger.info('Omnitron Console stopped');
  }

  /**
   * Get status of the nginx container.
   */
  async status(): Promise<{ running: boolean; port: number; healthy: boolean }> {
    const state = await getContainerState('omnitron-nginx');
    return {
      running: state?.status === 'running',
      port: this.publicPort,
      healthy: state?.health === 'healthy',
    };
  }

  /**
   * Check if webapp is built.
   */
  isBuilt(): boolean {
    return fs.existsSync(path.join(this.webappDir, 'dist', 'index.html'));
  }
}
