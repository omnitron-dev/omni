/**
 * Worker Bundling System
 * Comprehensive worker support for Web Workers, Service Workers, and Shared Workers
 */

import type { Plugin as RollupPlugin, RollupOptions } from 'rollup';

/**
 * Worker types supported by the bundling system
 */
export type WorkerType = 'web-worker' | 'service-worker' | 'shared-worker' | 'module-worker';

/**
 * Worker output format
 */
export type WorkerFormat = 'es' | 'iife';

/**
 * Worker bundling configuration
 */
export interface WorkerBundlingConfig {
  /**
   * Inline small workers as blob URLs
   * @default true for workers < 50KB
   */
  inline?: boolean;

  /**
   * Maximum size for inlining workers (bytes)
   * @default 50000 (50KB)
   */
  inlineThreshold?: number;

  /**
   * Output format for workers
   * @default 'es'
   */
  format?: WorkerFormat;

  /**
   * Worker-specific plugins
   */
  plugins?: RollupPlugin[];

  /**
   * Worker-specific rollup options
   */
  rollupOptions?: RollupOptions;

  /**
   * Enable minification
   * @default true
   */
  minify?: boolean;

  /**
   * Generate source maps
   * @default true
   */
  sourcemap?: boolean;

  /**
   * Enable code splitting for workers
   * @default false
   */
  codeSplitting?: boolean;

  /**
   * Enable tree shaking for workers
   * @default true
   */
  treeShaking?: boolean;

  /**
   * Worker pool configuration
   */
  pool?: WorkerPoolConfig;

  /**
   * Service worker specific options
   */
  serviceWorker?: ServiceWorkerConfig;

  /**
   * Enable HMR for workers
   * @default true in development
   */
  hmr?: boolean;

  /**
   * Enable worker caching
   * @default true
   */
  cache?: boolean;

  /**
   * Cache directory
   * @default '.aether/worker-cache'
   */
  cacheDir?: string;
}

/**
 * Worker pool configuration
 */
export interface WorkerPoolConfig {
  /**
   * Maximum number of workers in pool
   * @default 4
   */
  maxWorkers?: number;

  /**
   * Minimum number of workers in pool
   * @default 1
   */
  minWorkers?: number;

  /**
   * Worker idle timeout (ms)
   * @default 30000 (30 seconds)
   */
  idleTimeout?: number;

  /**
   * Enable worker recycling
   * @default true
   */
  recycleWorkers?: boolean;
}

/**
 * Service worker configuration
 */
export interface ServiceWorkerConfig {
  /**
   * PWA manifest path
   */
  manifest?: string;

  /**
   * Caching strategy
   * @default 'cache-first'
   */
  strategy?: CacheStrategy;

  /**
   * Enable background sync
   * @default false
   */
  backgroundSync?: boolean;

  /**
   * Enable push notifications
   * @default false
   */
  pushNotifications?: boolean;

  /**
   * Cache name prefix
   * @default 'aether-cache'
   */
  cacheName?: string;

  /**
   * Routes to precache
   */
  precache?: string[];

  /**
   * Runtime caching rules
   */
  runtimeCaching?: RuntimeCacheRule[];
}

/**
 * Cache strategy for service workers
 */
export type CacheStrategy = 'cache-first' | 'network-first' | 'cache-only' | 'network-only' | 'stale-while-revalidate';

/**
 * Runtime cache rule
 */
export interface RuntimeCacheRule {
  urlPattern: RegExp | string;
  handler: CacheStrategy;
  options?: {
    cacheName?: string;
    expiration?: {
      maxEntries?: number;
      maxAgeSeconds?: number;
    };
  };
}

/**
 * Worker bundle result
 */
export interface WorkerBundleResult {
  /**
   * Worker ID
   */
  id: string;

  /**
   * Worker type
   */
  type: WorkerType;

  /**
   * Worker code (if inlined)
   */
  code?: string;

  /**
   * Worker file path (if not inlined)
   */
  path?: string;

  /**
   * Worker size in bytes
   */
  size: number;

  /**
   * Whether worker was inlined
   */
  inlined: boolean;

  /**
   * Worker source map
   */
  map?: string;

  /**
   * Worker dependencies
   */
  dependencies: string[];

  /**
   * Bundle hash for caching
   */
  hash: string;
}

/**
 * Worker detection result
 */
export interface WorkerDetectionResult {
  /**
   * Worker source path
   */
  source: string;

  /**
   * Worker type
   */
  type: WorkerType;

  /**
   * Worker options
   */
  options?: WorkerOptions;

  /**
   * Position in source code
   */
  position: {
    start: number;
    end: number;
  };
}

/**
 * Worker instantiation options
 */
export interface WorkerOptions {
  type?: 'classic' | 'module';
  credentials?: 'omit' | 'same-origin' | 'include';
  name?: string;
}

/**
 * Worker communication message
 */
export interface WorkerMessage<T = any> {
  type: string;
  payload: T;
  id?: string;
  timestamp?: number;
}

/**
 * Worker performance metrics
 */
export interface WorkerMetrics {
  /**
   * Worker ID
   */
  workerId: string;

  /**
   * Total messages sent
   */
  messagesSent: number;

  /**
   * Total messages received
   */
  messagesReceived: number;

  /**
   * Average message latency (ms)
   */
  averageLatency: number;

  /**
   * Memory usage (bytes)
   */
  memoryUsage: number;

  /**
   * CPU usage (percentage)
   */
  cpuUsage: number;

  /**
   * Uptime (ms)
   */
  uptime: number;
}

/**
 * Worker bundler
 */
export class WorkerBundler {
  private config: Required<WorkerBundlingConfig>;
  private workers: Map<string, WorkerBundleResult> = new Map();
  private cache: Map<string, WorkerBundleResult> = new Map();

  constructor(config: WorkerBundlingConfig = {}) {
    const defaultPoolConfig: Required<WorkerPoolConfig> = {
      maxWorkers: 4,
      minWorkers: 1,
      idleTimeout: 30000,
      recycleWorkers: true,
    };

    const defaultServiceWorkerConfig = {
      manifest: undefined as string | undefined,
      strategy: 'cache-first' as CacheStrategy,
      backgroundSync: false,
      pushNotifications: false,
      cacheName: 'aether-cache',
      precache: [] as string[],
      runtimeCaching: [] as RuntimeCacheRule[],
    };

    this.config = {
      inline: true,
      inlineThreshold: 50000,
      format: 'es',
      plugins: [],
      rollupOptions: {},
      minify: true,
      sourcemap: true,
      codeSplitting: false,
      treeShaking: true,
      hmr: false,
      cache: true,
      cacheDir: '.aether/worker-cache',
      ...config,
      pool: { ...defaultPoolConfig, ...config.pool },
      serviceWorker: { ...defaultServiceWorkerConfig, ...config.serviceWorker },
    };
  }

  /**
   * Detect workers in source code
   */
  detectWorkers(code: string): WorkerDetectionResult[] {
    const workers: WorkerDetectionResult[] = [];

    // Detect Web Workers
    const webWorkerRegex = /new\s+Worker\s*\(\s*(['"`])(.+?)\1\s*(?:,\s*(\{[^}]*\}))?\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = webWorkerRegex.exec(code)) !== null) {
      const source = match[2];
      if (!source) continue;

      const optionsStr = match[3];
      let options: WorkerOptions | undefined;

      if (optionsStr) {
        try {
          options = this.parseWorkerOptions(optionsStr);
        } catch {
          options = undefined;
        }
      }

      workers.push({
        source,
        type: options?.type === 'module' ? 'module-worker' : 'web-worker',
        options,
        position: {
          start: match.index,
          end: match.index + match[0].length,
        },
      });
    }

    // Detect Service Workers
    const serviceWorkerRegex = /navigator\.serviceWorker\.register\s*\(\s*(['"`])(.+?)\1\s*(?:,\s*(\{[^}]*\}))?\s*\)/g;

    while ((match = serviceWorkerRegex.exec(code)) !== null) {
      const source = match[2];
      if (!source) continue;

      workers.push({
        source,
        type: 'service-worker',
        position: {
          start: match.index,
          end: match.index + match[0].length,
        },
      });
    }

    // Detect Shared Workers
    const sharedWorkerRegex = /new\s+SharedWorker\s*\(\s*(['"`])(.+?)\1\s*(?:,\s*(['"`])(.+?)\3)?\s*\)/g;

    while ((match = sharedWorkerRegex.exec(code)) !== null) {
      const source = match[2];
      if (!source) continue;

      workers.push({
        source,
        type: 'shared-worker',
        options: match[4] ? { name: match[4] } : undefined,
        position: {
          start: match.index,
          end: match.index + match[0].length,
        },
      });
    }

    return workers;
  }

  /**
   * Bundle a worker
   */
  async bundleWorker(
    source: string,
    code: string,
    type: WorkerType,
    options?: WorkerOptions
  ): Promise<WorkerBundleResult> {
    // Check cache
    const cacheKey = this.generateCacheKey(source, code, type);
    if (this.config.cache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Transform worker code
    let workerCode = code;
    const dependencies: string[] = [];

    // Tree shaking
    if (this.config.treeShaking) {
      workerCode = this.treeShakeWorker(workerCode);
    }

    // Extract dependencies
    dependencies.push(...this.extractDependencies(workerCode));

    // Minification
    if (this.config.minify) {
      workerCode = this.minifyWorker(workerCode);
    }

    // Generate source map
    let sourceMap: string | undefined;
    if (this.config.sourcemap) {
      sourceMap = this.generateSourceMap(source, workerCode);
    }

    // Calculate size
    const size = new TextEncoder().encode(workerCode).length;

    // Determine if should be inlined
    const shouldInline = this.config.inline && size < this.config.inlineThreshold;

    // Generate hash
    const hash = this.generateHash(workerCode);

    const result: WorkerBundleResult = {
      id: this.generateWorkerId(source),
      type,
      code: shouldInline ? workerCode : undefined,
      path: shouldInline ? undefined : this.generateWorkerPath(source, hash),
      size,
      inlined: shouldInline,
      map: sourceMap,
      dependencies,
      hash,
    };

    // Cache result
    if (this.config.cache) {
      this.cache.set(cacheKey, result);
    }

    this.workers.set(result.id, result);
    return result;
  }

  /**
   * Generate worker instantiation code
   */
  generateWorkerCode(bundle: WorkerBundleResult, options?: WorkerOptions): string {
    if (bundle.inlined && bundle.code) {
      // Generate blob URL for inlined worker
      const blob = `new Blob([${JSON.stringify(bundle.code)}], { type: 'application/javascript' })`;
      const url = `URL.createObjectURL(${blob})`;

      switch (bundle.type) {
        case 'web-worker':
        case 'module-worker':
          return `new Worker(${url}, ${JSON.stringify(options || { type: bundle.type === 'module-worker' ? 'module' : 'classic' })})`;
        case 'shared-worker':
          return `new SharedWorker(${url}${options?.name ? `, ${JSON.stringify(options.name)}` : ''})`;
        case 'service-worker':
          return `navigator.serviceWorker.register(${url})`;
        default:
          throw new Error(`Unsupported worker type: ${bundle.type}`);
      }
    } else {
      // Use file path
      const path = bundle.path || '';

      switch (bundle.type) {
        case 'web-worker':
        case 'module-worker':
          return `new Worker(${JSON.stringify(path)}, ${JSON.stringify(options || { type: bundle.type === 'module-worker' ? 'module' : 'classic' })})`;
        case 'shared-worker':
          return `new SharedWorker(${JSON.stringify(path)}${options?.name ? `, ${JSON.stringify(options.name)}` : ''})`;
        case 'service-worker':
          return `navigator.serviceWorker.register(${JSON.stringify(path)})`;
        default:
          throw new Error(`Unsupported worker type: ${bundle.type}`);
      }
    }
  }

  /**
   * Generate service worker code
   */
  generateServiceWorkerCode(): string {
    const config = this.config.serviceWorker;
    const cacheName = `${config.cacheName}-v1`;

    return `
// Aether Service Worker
const CACHE_NAME = '${cacheName}';
const PRECACHE_URLS = ${JSON.stringify(config.precache)};
const CACHE_STRATEGY = '${config.strategy}';

// Install event - precache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - implement caching strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(handleFetch(event.request));
});

async function handleFetch(request) {
  const cache = await caches.open(CACHE_NAME);

  ${this.generateCacheStrategyCode(config.strategy!)}
}

${config.backgroundSync ? this.generateBackgroundSyncCode() : ''}
${config.pushNotifications ? this.generatePushNotificationCode() : ''}
`.trim();
  }

  /**
   * Get all bundled workers
   */
  getWorkers(): Map<string, WorkerBundleResult> {
    return new Map(this.workers);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Parse worker options from string
   */
  private parseWorkerOptions(optionsStr: string): WorkerOptions {
    // Simple JSON-like parsing
    const options: WorkerOptions = {};

    const typeMatch = optionsStr.match(/type\s*:\s*['"](\w+)['"]/);
    if (typeMatch) {
      options.type = typeMatch[1] as 'classic' | 'module';
    }

    const credentialsMatch = optionsStr.match(/credentials\s*:\s*['"](\w+)['"]/);
    if (credentialsMatch) {
      options.credentials = credentialsMatch[1] as 'omit' | 'same-origin' | 'include';
    }

    const nameMatch = optionsStr.match(/name\s*:\s*['"]([^'"]+)['"]/);
    if (nameMatch) {
      options.name = nameMatch[1];
    }

    return options;
  }

  /**
   * Tree shake worker code
   */
  private treeShakeWorker(code: string): string {
    // Basic tree shaking - remove unused imports and dead code
    let shaken = code;

    // Remove unused imports (very basic implementation)
    const imports = new Map<string, Set<string>>();
    const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(code)) !== null) {
      if (!match[1] || !match[2]) continue;
      const imported = match[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      imports.set(match[2], new Set(imported));
    }

    // Remove console.log in production
    if (this.config.minify) {
      shaken = shaken.replace(/console\.log\([^)]*\);?/g, '');
    }

    return shaken;
  }

  /**
   * Extract dependencies from worker code
   */
  private extractDependencies(code: string): string[] {
    const dependencies: string[] = [];
    const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(code)) !== null) {
      if (match[1]) {
        dependencies.push(match[1]);
      }
    }

    return Array.from(new Set(dependencies));
  }

  /**
   * Minify worker code
   */
  private minifyWorker(code: string): string {
    // Basic minification
    return (
      code
        // Remove comments
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '')
        // Remove extra whitespace
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}();,:])\s*/g, '$1')
        // Remove trailing semicolons before closing braces
        .replace(/;}/g, '}')
        .trim()
    );
  }

  /**
   * Generate source map
   */
  private generateSourceMap(source: string, code: string): string {
    // Simplified source map
    return JSON.stringify({
      version: 3,
      file: source,
      sources: [source],
      sourcesContent: [code],
      mappings: '',
      names: [],
    });
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(source: string, code: string, type: WorkerType): string {
    return `${type}:${source}:${this.generateHash(code)}`;
  }

  /**
   * Generate hash
   */
  private generateHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Generate worker ID
   */
  private generateWorkerId(source: string): string {
    return `worker-${this.generateHash(source)}`;
  }

  /**
   * Generate worker output path
   */
  private generateWorkerPath(source: string, hash: string): string {
    const basename =
      source
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') || 'worker';
    return `assets/${basename}.${hash}.worker.js`;
  }

  /**
   * Generate cache strategy code
   */
  private generateCacheStrategyCode(strategy: CacheStrategy): string {
    switch (strategy) {
      case 'cache-first':
        return `
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
        `.trim();

      case 'network-first':
        return `
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw new Error('Network request failed and no cache available');
  }
        `.trim();

      case 'cache-only':
        return `
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  throw new Error('No cache available');
        `.trim();

      case 'network-only':
        return `
  return await fetch(request);
        `.trim();

      case 'stale-while-revalidate':
        return `
  const cachedResponse = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    cache.put(request, response.clone());
    return response;
  });
  return cachedResponse || fetchPromise;
        `.trim();

      default:
        return 'return await fetch(request);';
    }
  }

  /**
   * Generate background sync code
   */
  private generateBackgroundSyncCode(): string {
    return `
// Background Sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(syncData());
  }
});

async function syncData() {
  // Implement sync logic
  console.log('Background sync triggered');
}
    `.trim();
  }

  /**
   * Generate push notification code
   */
  private generatePushNotificationCode(): string {
    return `
// Push Notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Notification';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon.png',
    badge: data.badge || '/badge.png',
    data: data.data || {}
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});
    `.trim();
  }
}

/**
 * Type-safe worker communication wrapper
 */
export class TypedWorker<TSend = any, TReceive = any> {
  private worker: Worker;
  private messageHandlers: Map<string, (payload: any) => void> = new Map();
  private messageId = 0;

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (event: MessageEvent<WorkerMessage<TReceive>>) => {
      const message = event.data;
      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        handler(message.payload);
      }
    };
  }

  /**
   * Send message to worker
   */
  send(type: string, payload: TSend): void {
    const message: WorkerMessage<TSend> = {
      type,
      payload,
      id: `msg-${this.messageId++}`,
      timestamp: Date.now(),
    };
    this.worker.postMessage(message);
  }

  /**
   * Send message and wait for response
   */
  sendAndWait(type: string, payload: TSend, timeout = 5000): Promise<TReceive> {
    return new Promise((resolve, reject) => {
      const messageId = `msg-${this.messageId++}`;
      const responseType = `${type}:response`;

      const timeoutId = setTimeout(() => {
        this.messageHandlers.delete(responseType);
        reject(new Error(`Worker message timeout: ${type}`));
      }, timeout);

      this.messageHandlers.set(responseType, (responsePayload: TReceive) => {
        clearTimeout(timeoutId);
        this.messageHandlers.delete(responseType);
        resolve(responsePayload);
      });

      const message: WorkerMessage<TSend> = {
        type,
        payload,
        id: messageId,
        timestamp: Date.now(),
      };
      this.worker.postMessage(message);
    });
  }

  /**
   * Register message handler
   */
  on(type: string, handler: (payload: TReceive) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Unregister message handler
   */
  off(type: string): void {
    this.messageHandlers.delete(type);
  }

  /**
   * Terminate worker
   */
  terminate(): void {
    this.worker.terminate();
    this.messageHandlers.clear();
  }
}

/**
 * Worker pool manager
 */
export class WorkerPool<TSend = any, TReceive = any> {
  private config: Required<WorkerPoolConfig>;
  private workers: TypedWorker<TSend, TReceive>[] = [];
  private availableWorkers: TypedWorker<TSend, TReceive>[] = [];
  private workerFactory: () => Worker;
  private metrics: Map<string, WorkerMetrics> = new Map();

  constructor(workerFactory: () => Worker, config: WorkerPoolConfig = {}) {
    this.workerFactory = workerFactory;
    this.config = {
      maxWorkers: 4,
      minWorkers: 1,
      idleTimeout: 30000,
      recycleWorkers: true,
      ...config,
    };

    // Initialize minimum workers
    for (let i = 0; i < this.config.minWorkers; i++) {
      this.createWorker();
    }
  }

  /**
   * Execute task on available worker
   */
  async execute(type: string, payload: TSend, timeout?: number): Promise<TReceive> {
    const worker = await this.getWorker();
    try {
      return await worker.sendAndWait(type, payload, timeout);
    } finally {
      this.releaseWorker(worker);
    }
  }

  /**
   * Broadcast message to all workers
   */
  broadcast(type: string, payload: TSend): void {
    for (const worker of this.workers) {
      worker.send(type, payload);
    }
  }

  /**
   * Get worker metrics
   */
  getMetrics(): Map<string, WorkerMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.availableWorkers = [];
    this.metrics.clear();
  }

  /**
   * Create new worker
   */
  private createWorker(): TypedWorker<TSend, TReceive> {
    if (this.workers.length >= this.config.maxWorkers) {
      throw new Error('Maximum worker pool size reached');
    }

    const rawWorker = this.workerFactory();
    const worker = new TypedWorker<TSend, TReceive>(rawWorker);
    this.workers.push(worker);
    this.availableWorkers.push(worker);

    return worker;
  }

  /**
   * Get available worker
   */
  private async getWorker(): Promise<TypedWorker<TSend, TReceive>> {
    // Try to get available worker
    if (this.availableWorkers.length > 0) {
      return this.availableWorkers.shift()!;
    }

    // Create new worker if under max
    if (this.workers.length < this.config.maxWorkers) {
      const worker = this.createWorker();
      return this.availableWorkers.shift()!;
    }

    // Wait for worker to become available
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.availableWorkers.length > 0) {
          clearInterval(checkInterval);
          resolve(this.availableWorkers.shift()!);
        }
      }, 10);
    });
  }

  /**
   * Release worker back to pool
   */
  private releaseWorker(worker: TypedWorker<TSend, TReceive>): void {
    if (!this.availableWorkers.includes(worker)) {
      this.availableWorkers.push(worker);
    }
  }
}

/**
 * Worker performance monitor
 */
export class WorkerPerformanceMonitor {
  private metrics: Map<string, WorkerMetrics> = new Map();

  /**
   * Track worker message
   */
  trackMessage(workerId: string, sent: boolean): void {
    const metric = this.getOrCreateMetric(workerId);
    if (sent) {
      metric.messagesSent++;
    } else {
      metric.messagesReceived++;
    }
  }

  /**
   * Track message latency
   */
  trackLatency(workerId: string, latency: number): void {
    const metric = this.getOrCreateMetric(workerId);
    const totalLatency = metric.averageLatency * (metric.messagesSent + metric.messagesReceived);
    metric.averageLatency = (totalLatency + latency) / (metric.messagesSent + metric.messagesReceived + 1);
  }

  /**
   * Get metrics for worker
   */
  getMetrics(workerId: string): WorkerMetrics | undefined {
    return this.metrics.get(workerId);
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Map<string, WorkerMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Clear metrics
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Get or create metric
   */
  private getOrCreateMetric(workerId: string): WorkerMetrics {
    if (!this.metrics.has(workerId)) {
      this.metrics.set(workerId, {
        workerId,
        messagesSent: 0,
        messagesReceived: 0,
        averageLatency: 0,
        memoryUsage: 0,
        cpuUsage: 0,
        uptime: Date.now(),
      });
    }
    return this.metrics.get(workerId)!;
  }
}

/**
 * Mock worker for testing
 */
export class MockWorker implements Worker {
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onmessageerror: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  private messageQueue: any[] = [];

  postMessage(message: any): void {
    this.messageQueue.push(message);
    setTimeout(() => {
      if (this.onmessage) {
        this.onmessage(new MessageEvent('message', { data: message }));
      }
    }, 0);
  }

  terminate(): void {
    this.messageQueue = [];
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      this.onmessage = listener as (event: MessageEvent) => void;
    } else if (type === 'error') {
      this.onerror = listener as (event: ErrorEvent) => void;
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      this.onmessage = null;
    } else if (type === 'error') {
      this.onerror = null;
    }
  }

  dispatchEvent(_event: Event): boolean {
    return true;
  }
}

/**
 * HMR worker manager
 */
export class HMRWorkerManager {
  private workers: Map<string, Worker> = new Map();

  /**
   * Register worker for HMR
   */
  register(id: string, worker: Worker): void {
    this.workers.set(id, worker);
  }

  /**
   * Unregister worker
   */
  unregister(id: string): void {
    const worker = this.workers.get(id);
    if (worker) {
      worker.terminate();
      this.workers.delete(id);
    }
  }

  /**
   * Reload worker
   */
  reload(id: string, factory: () => Worker): Worker {
    this.unregister(id);
    const worker = factory();
    this.register(id, worker);
    return worker;
  }

  /**
   * Terminate all workers
   */
  terminateAll(): void {
    const workerIds = Array.from(this.workers.keys());
    for (const id of workerIds) {
      this.unregister(id);
    }
  }
}

/**
 * Detect workers in source code
 */
export function detectWorkers(code: string): WorkerDetectionResult[] {
  const bundler = new WorkerBundler();
  return bundler.detectWorkers(code);
}

/**
 * Create a worker pool
 */
export function createWorkerPool<TSend = any, TReceive = any>(
  workerFactory: () => Worker,
  config?: WorkerPoolConfig
): WorkerPool<TSend, TReceive> {
  return new WorkerPool<TSend, TReceive>(workerFactory, config);
}
