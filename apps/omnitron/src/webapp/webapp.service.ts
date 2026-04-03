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
 *                             → /ws → :9801 (WebSocket upgrade)
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

function generateNginxConfig(apiHost: string, apiPort: number): string {
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

    server {
        listen 80;
        server_name _;

        # Webapp static files
        root /usr/share/nginx/html;
        index index.html;

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

        # WebSocket support
        location /ws {
            proxy_pass http://${apiHost}:${apiPort}/ws;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_read_timeout 3600s;
        }

        # SPA fallback — all non-file routes serve index.html
        location / {
            try_files $uri $uri/ /index.html;
        }

        # Cache static assets aggressively
        location ~* \\.(js|css|woff2|ttf|png|jpg|svg|ico)$ {
            expires 7d;
            add_header Cache-Control "public";
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

    // 1. Check if container is already running
    if (!force) {
      const state = await getContainerState('omnitron-nginx');
      if (state?.status === 'running') {
        if (state.health === 'healthy') {
          this.logger.info({ port: this.publicPort }, 'Omnitron Console is already running');
          return;
        }
        // Running but not healthy — stop and recreate
        this.logger.warn('Nginx container running but not healthy — recreating...');
      }
    }

    // 2. Check webapp is built
    const distPath = path.join(this.webappDir, 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      this.logger.info('Webapp not built — building now...');
      await this.build();
    }

    // 3. Generate nginx config
    const nginxConfig = generateNginxConfig('host.docker.internal', this.apiPort);
    const configPath = path.join(this.configDir, 'nginx.conf');
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
