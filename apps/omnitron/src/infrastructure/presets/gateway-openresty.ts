/**
 * OpenResty API Gateway Preset
 *
 * Reverse proxy with Lua scripting for maintenance mode, rate limiting, PoW captcha.
 * Mounts project-level config directory (nginx.conf template, lua/, maintenance.html).
 * Upstream addresses injected via env vars, rendered by docker-entrypoint.sh.
 */

import type { IServicePreset } from './types.js';

export const gatewayOpenrestyPreset: IServicePreset = {
  name: 'openresty',
  type: 'gateway',
  defaultImage: 'openresty/openresty:alpine',
  defaultPorts: { http: 8080 },
  defaultSecrets: {},

  defaultHealthCheck: {
    type: 'http',
    target: '/nginx-health',
    interval: '10s',
    timeout: '5s',
    retries: 3,
  },

  defaultDocker: {
    // Volumes and entrypoint configured by resolveGateway based on configDir
  },

  generateEnvTemplates(): Record<string, string> {
    return {
      GATEWAY_URL: 'http://${host}:${port:http}',
    };
  },
};
