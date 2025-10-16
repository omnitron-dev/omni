import { Injectable } from '@omnitron-dev/aether/di';
import { signal } from '@omnitron-dev/aether';

export interface AppConfig {
  version: string;
  apiUrl?: string;
  wsUrl?: string;
  features: {
    terminal: boolean;
    chat: boolean;
    editor: boolean;
    canvas: boolean;
  };
  limits: {
    maxFileSize: number;
    maxConnections: number;
    maxHistory: number;
  };
}

/**
 * Config Service
 *
 * Manages application configuration
 */
@Injectable({ scope: 'module' })
export class ConfigService {
  private config = signal<AppConfig>({
    version: '1.0.0',
    apiUrl: import.meta.env.VITE_API_URL,
    wsUrl: import.meta.env.VITE_WS_URL,
    features: {
      terminal: true,
      chat: true,
      editor: true,
      canvas: true,
    },
    limits: {
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxConnections: 10,
      maxHistory: 1000,
    },
  });

  /**
   * Get configuration
   */
  getConfig(): AppConfig {
    return this.config();
  }

  /**
   * Get configuration value
   */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config()[key];
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AppConfig>) {
    this.config.update((config) => ({ ...config, ...updates }));
  }

  /**
   * Check if feature is enabled
   */
  isFeatureEnabled(feature: keyof AppConfig['features']): boolean {
    return this.config().features[feature];
  }

  /**
   * Enable feature
   */
  enableFeature(feature: keyof AppConfig['features']) {
    this.config.update((config) => ({
      ...config,
      features: { ...config.features, [feature]: true },
    }));
  }

  /**
   * Disable feature
   */
  disableFeature(feature: keyof AppConfig['features']) {
    this.config.update((config) => ({
      ...config,
      features: { ...config.features, [feature]: false },
    }));
  }

  /**
   * Get limit value
   */
  getLimit(limit: keyof AppConfig['limits']): number {
    return this.config().limits[limit];
  }

  /**
   * Update limit value
   */
  updateLimit(limit: keyof AppConfig['limits'], value: number) {
    this.config.update((config) => ({
      ...config,
      limits: { ...config.limits, [limit]: value },
    }));
  }

  /**
   * Get API URL
   */
  getApiUrl(): string | undefined {
    return this.config().apiUrl;
  }

  /**
   * Get WebSocket URL
   */
  getWsUrl(): string | undefined {
    return this.config().wsUrl;
  }

  /**
   * Get version
   */
  getVersion(): string {
    return this.config().version;
  }

  /**
   * Validate configuration
   */
  validateConfig(): boolean {
    const config = this.config();
    return !!(config.version && config.features && config.limits);
  }
}
