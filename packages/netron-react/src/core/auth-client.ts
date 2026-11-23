import { AuthenticationClient, LocalTokenStorage, SessionTokenStorage } from '@omnitron-dev/netron-browser';
import type { AuthConfig } from './types.js';

export function resolveAuthClient(config: AuthConfig = {}): AuthenticationClient {
  if (config.client) return config.client;

  const storage = config.storage === 'local' ? new LocalTokenStorage()
    : config.storage === 'session' ? new SessionTokenStorage()
    : undefined;

  return new AuthenticationClient({
    storage,
    autoRefresh: config.autoRefresh,
    refreshThreshold: config.refreshThreshold,
    refreshConfig: config.refreshEndpoint ? { endpoint: config.refreshEndpoint } : undefined,
    logoutConfig: config.logoutEndpoint ? { endpoint: config.logoutEndpoint } : undefined,
  });
}
