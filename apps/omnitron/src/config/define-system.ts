/**
 * defineSystem() — Declarative system configuration
 *
 * Every system (app) declares its processes explicitly via IProcessEntry[].
 * Each process is a Titan @Module running in its own OS process.
 */

import type { IAppDefinition, IHttpTransportConfig, IWebSocketTransportConfig } from './types.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

class DefineSystemError extends Error {
  constructor(appName: string, message: string) {
    super(`defineSystem('${appName}'): ${message}`);
    this.name = 'DefineSystemError';
  }
}

function validate(definition: IAppDefinition): void {
  const { name, processes } = definition;

  if (!name || typeof name !== 'string') {
    throw new DefineSystemError(name ?? '?', 'name is required');
  }

  if (!processes || processes.length === 0) {
    throw new DefineSystemError(name, 'At least one process must be defined');
  }

  const names = new Set<string>();
  for (const proc of processes) {
    if (!proc.name) {
      throw new DefineSystemError(name, 'Every process must have a name');
    }
    if (!proc.module) {
      throw new DefineSystemError(name, `Process '${proc.name}' must have a module path`);
    }
    if (names.has(proc.name)) {
      throw new DefineSystemError(name, `Duplicate process name '${proc.name}'`);
    }
    names.add(proc.name);
  }

  // Startup ordering is determined by topology graph (providers before consumers).
  // topology.access validation is deferred to runtime — service names are resolved
  // from @Service metadata via auto-discovery, not from process topology config.
  for (const proc of processes) {

    if (proc.transports?.http?.port != null) {
      const port = proc.transports.http.port;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new DefineSystemError(name, `Process '${proc.name}' has invalid HTTP port ${port}`);
      }
    }
    if (proc.transports?.websocket?.port != null) {
      const port = proc.transports.websocket.port;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new DefineSystemError(name, `Process '${proc.name}' has invalid WebSocket port ${port}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Transport defaults
// ---------------------------------------------------------------------------

function applyHttpDefaults(config: IHttpTransportConfig): IHttpTransportConfig {
  return {
    host: '0.0.0.0',
    cors: true,
    requestTimeout: 120_000,
    keepAliveTimeout: 65_000,
    headersTimeout: 60_000,
    ...config,
  };
}

function applyWsDefaults(config: IWebSocketTransportConfig): IWebSocketTransportConfig {
  return {
    host: '0.0.0.0',
    path: '/ws',
    ...config,
  };
}

// ---------------------------------------------------------------------------
// defineSystem()
// ---------------------------------------------------------------------------

export function defineSystem(definition: IAppDefinition): IAppDefinition {
  // Apply top-level defaults
  const result: IAppDefinition = {
    ...definition,
    shutdown: {
      timeout: 10_000,
      priority: 0,
      drainConnections: true,
      ...definition.shutdown,
    },
  };

  // Apply transport defaults to each process
  result.processes = result.processes.map((proc) => {
    if (!proc.transports) return proc;
    const patched = { ...proc, transports: { ...proc.transports } };
    if (patched.transports!.http) {
      patched.transports!.http = applyHttpDefaults(patched.transports!.http);
    }
    if (patched.transports!.websocket) {
      patched.transports!.websocket = applyWsDefaults(patched.transports!.websocket);
    }
    return patched;
  });

  // Validate
  validate(result);

  return result;
}
