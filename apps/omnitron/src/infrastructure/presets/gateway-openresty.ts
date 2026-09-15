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
  // 80 — the port nginx listens on inside this image. It is a fact about
  // the image, not something a stack config can change; a config naming
  // `http` is saying where to PUBLISH it. Declared as 8080 here, the
  // container published 8080→8080 while the server was on 80, and every
  // connection was refused.
  defaultPorts: { http: 80 },
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
