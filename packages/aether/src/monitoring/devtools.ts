/**
 * Developer Tools Module
 *
 * Provides debugging and profiling tools for development.
 * Includes performance profiler, memory leak detection, and network viewer.
 */

import type { DevToolsConfig } from './types.js';

/**
 * Performance profile entry
 */
interface ProfileEntry {
  name: string;
  duration: number;
  startTime: number;
  endTime: number;
  metadata?: Record<string, any>;
}

/**
 * Memory snapshot
 */
interface MemorySnapshot {
  timestamp: number;
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/**
 * Network request
 */
interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  duration?: number;
  startTime: number;
  endTime?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: any;
  responseBody?: any;
  error?: string;
}

/**
 * Component render info
 */
interface ComponentRender {
  name: string;
  duration: number;
  timestamp: number;
  props?: any;
  rerenderCount?: number;
}

/**
 * Developer tools class
 */
export class DevTools {
  private config: DevToolsConfig;
  private profiles: Map<string, ProfileEntry[]> = new Map();
  private memorySnapshots: MemorySnapshot[] = [];
  private networkRequests: Map<string, NetworkRequest> = new Map();
  private componentRenders: ComponentRender[] = [];
  private activeProfile: string | null = null;

  constructor(config: DevToolsConfig = {}) {
    this.config = {
      profiler: true,
      bundleAnalyzer: false,
      memoryLeakDetection: true,
      networkViewer: true,
      componentTracking: true,
      ...config,
    };

    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      this.init();
    }
  }

  /**
   * Initialize devtools
   */
  private init(): void {
    if (this.config.networkViewer) {
      this.initNetworkViewer();
    }

    if (this.config.memoryLeakDetection) {
      this.startMemoryMonitoring();
    }

    // Expose devtools API
    (window as any).__AETHER_DEVTOOLS__ = this;
  }

  /**
   * Start profiling
   */
  startProfile(name: string): void {
    if (!this.config.profiler) return;

    this.activeProfile = name;

    if (!this.profiles.has(name)) {
      this.profiles.set(name, []);
    }

    console.log(`[Aether DevTools] Started profile: ${name}`);
  }

  /**
   * End profiling
   */
  endProfile(name: string): void {
    if (!this.config.profiler || this.activeProfile !== name) return;

    const profile = this.profiles.get(name);
    if (profile) {
      console.table(profile);
      console.log(`[Aether DevTools] Profile "${name}" complete with ${profile.length} entries`);
    }

    this.activeProfile = null;
  }

  /**
   * Record profile entry
   */
  recordProfileEntry(entry: ProfileEntry): void {
    if (!this.config.profiler || !this.activeProfile) return;

    const profile = this.profiles.get(this.activeProfile);
    if (profile) {
      profile.push(entry);
    }
  }

  /**
   * Get profile
   */
  getProfile(name: string): ProfileEntry[] {
    return this.profiles.get(name) || [];
  }

  /**
   * Clear profile
   */
  clearProfile(name: string): void {
    this.profiles.delete(name);
  }

  /**
   * Clear all profiles
   */
  clearAllProfiles(): void {
    this.profiles.clear();
  }

  /**
   * Initialize network viewer
   */
  private initNetworkViewer(): void {
    // Intercept fetch
    const originalFetch = window.fetch.bind(window);
    const { generateIdFn, networkRequests, logNetworkRequest } = {
      generateIdFn: this.generateId.bind(this),
      networkRequests: this.networkRequests,
      logNetworkRequest: this.logNetworkRequest.bind(this),
    };

    (window.fetch as any) = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method || 'GET';
      const requestId = generateIdFn();

      const request: NetworkRequest = {
        id: requestId,
        url,
        method,
        startTime: Date.now(),
        requestHeaders: init?.headers as Record<string, string>,
        requestBody: init?.body,
      };

      networkRequests.set(requestId, request);

      try {
        const response = await originalFetch(input, init);

        request.endTime = Date.now();
        request.duration = request.endTime - request.startTime;
        request.status = response.status;
        request.statusText = response.statusText;
        request.responseHeaders = Object.fromEntries(response.headers.entries());

        logNetworkRequest(request);

        return response;
      } catch (error) {
        request.endTime = Date.now();
        request.duration = request.endTime - request.startTime;
        request.error = (error as Error).message;

        logNetworkRequest(request);

        throw error;
      }
    };

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function xhrOpenInterceptor(
      method: string,
      url: string | URL,
      ...args: any[]
    ) {
      (this as any)._aether_url = typeof url === 'string' ? url : url.href;
      (this as any)._aether_method = method;
      (this as any)._aether_id = generateIdFn();
      return (originalOpen as any).call(this, method, url, ...args);
    };

    XMLHttpRequest.prototype.send = function xhrSendInterceptor(...args: any[]) {
      const xhr = this as any;
      const requestId = xhr._aether_id;
      const requestUrl = xhr._aether_url;
      const requestMethod = xhr._aether_method;

      const request: NetworkRequest = {
        id: requestId,
        url: requestUrl,
        method: requestMethod,
        startTime: Date.now(),
      };

      this.addEventListener('loadend', () => {
        request.endTime = Date.now();
        request.duration = request.endTime - request.startTime;
        request.status = xhr.status;
        request.statusText = xhr.statusText;

        logNetworkRequest(request);
      });

      return originalSend.call(this, ...args);
    };
  }

  /**
   * Log network request
   */
  private logNetworkRequest(request: NetworkRequest): void {
    const color = request.status && request.status >= 200 && request.status < 300 ? 'green' : 'red';
    console.log(
      `%c[Network] ${request.method} ${request.url} (${request.duration}ms)`,
      `color: ${color}`,
      request
    );
  }

  /**
   * Get network requests
   */
  getNetworkRequests(): NetworkRequest[] {
    return Array.from(this.networkRequests.values());
  }

  /**
   * Clear network requests
   */
  clearNetworkRequests(): void {
    this.networkRequests.clear();
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(): void {
    if (!(performance as any).memory) {
      console.warn('[Aether DevTools] Memory API not available');
      return;
    }

    setInterval(() => {
      this.captureMemorySnapshot();
    }, 5000);
  }

  /**
   * Capture memory snapshot
   */
  private captureMemorySnapshot(): void {
    const memory = (performance as any).memory;
    if (!memory) return;

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
      jsHeapSizeLimit: memory.jsHeapSizeLimit,
    };

    this.memorySnapshots.push(snapshot);

    // Keep only last 100 snapshots
    if (this.memorySnapshots.length > 100) {
      this.memorySnapshots.shift();
    }

    // Detect potential memory leak
    if (this.memorySnapshots.length > 10) {
      this.detectMemoryLeak();
    }
  }

  /**
   * Detect memory leak
   */
  private detectMemoryLeak(): void {
    const recentSnapshots = this.memorySnapshots.slice(-10);
    const trend = this.calculateMemoryTrend(recentSnapshots);

    // If memory is consistently growing
    if (trend > 1000000) {
      // 1MB per snapshot
      console.warn(
        '[Aether DevTools] Potential memory leak detected!',
        `Memory growing at ${(trend / 1000000).toFixed(2)}MB per snapshot`
      );

      window.dispatchEvent(
        new CustomEvent('aether:devtools:memory-leak', {
          detail: { trend, snapshots: recentSnapshots },
        })
      );
    }
  }

  /**
   * Calculate memory trend
   */
  private calculateMemoryTrend(snapshots: MemorySnapshot[]): number {
    if (snapshots.length < 2) return 0;

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    if (!first || !last) return 0;

    return (last.usedJSHeapSize - first.usedJSHeapSize) / snapshots.length;
  }

  /**
   * Get memory snapshots
   */
  getMemorySnapshots(): MemorySnapshot[] {
    return [...this.memorySnapshots];
  }

  /**
   * Clear memory snapshots
   */
  clearMemorySnapshots(): void {
    this.memorySnapshots = [];
  }

  /**
   * Track component render
   */
  trackComponentRender(render: ComponentRender): void {
    if (!this.config.componentTracking) return;

    this.componentRenders.push(render);

    // Log slow renders
    if (render.duration > 16) {
      // > 16ms
      console.warn(
        `[Aether DevTools] Slow component render: ${render.name} (${render.duration.toFixed(2)}ms)`
      );
    }

    // Keep only last 1000 renders
    if (this.componentRenders.length > 1000) {
      this.componentRenders.shift();
    }
  }

  /**
   * Get component renders
   */
  getComponentRenders(): ComponentRender[] {
    return [...this.componentRenders];
  }

  /**
   * Clear component renders
   */
  clearComponentRenders(): void {
    this.componentRenders = [];
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Export devtools data
   */
  export(): {
    profiles: Record<string, ProfileEntry[]>;
    networkRequests: NetworkRequest[];
    memorySnapshots: MemorySnapshot[];
    componentRenders: ComponentRender[];
  } {
    return {
      profiles: Object.fromEntries(this.profiles),
      networkRequests: this.getNetworkRequests(),
      memorySnapshots: this.getMemorySnapshots(),
      componentRenders: this.getComponentRenders(),
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.clearAllProfiles();
    this.clearNetworkRequests();
    this.clearMemorySnapshots();
    this.clearComponentRenders();
  }
}

/**
 * Performance profiler decorator
 */
export function Profile(name?: string) {
  return function profileDecorator(
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;

    descriptor.value = function profiledMethod(...args: any[]) {
      const profileName = name || `${target.constructor.name}.${propertyKey}`;
      const startTime = performance.now();

      const result = originalMethod.apply(this, args);

      const endTime = performance.now();
      const duration = endTime - startTime;

      const self = (window as any).__AETHER_DEVTOOLS__ as DevTools | undefined;
      if (self) {
        self.recordProfileEntry({
          name: profileName,
          duration,
          startTime,
          endTime,
        });
      }

      return result;
    };

    return descriptor;
  };
}

/**
 * Global devtools instance
 */
let globalDevTools: DevTools | null = null;

/**
 * Get or create global devtools
 */
export function getDevTools(config?: DevToolsConfig): DevTools {
  if (!globalDevTools) {
    globalDevTools = new DevTools(config);
  }
  return globalDevTools;
}

/**
 * Reset global devtools
 */
export function resetDevTools(): void {
  if (globalDevTools) {
    globalDevTools.clear();
    globalDevTools = null;
  }
}
