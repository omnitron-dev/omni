/**
 * Network Request Monitoring
 *
 * Tracks network requests, responses, and performance metrics.
 *
 * @module monitoring/network-monitor
 */

import { getPerformanceMonitor } from './performance.js';

export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status?: number;
  statusText?: string;
  requestSize?: number;
  responseSize?: number;
  cached?: boolean;
  failed?: boolean;
  error?: Error;
  headers?: Record<string, string>;
}

export interface NetworkStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cachedRequests: number;
  averageDuration: number;
  totalTransferred: number;
  slowestRequest?: NetworkRequest;
  fastestRequest?: NetworkRequest;
}

export interface NetworkMonitorConfig {
  enabled?: boolean;
  maxRequests?: number;
  slowRequestThreshold?: number;
  onSlowRequest?: (request: NetworkRequest) => void;
  onFailedRequest?: (request: NetworkRequest) => void;
  trackHeaders?: boolean;
}

export class NetworkMonitor {
  private config: Required<NetworkMonitorConfig>;
  private requests = new Map<string, NetworkRequest>();
  private requestList: NetworkRequest[] = [];
  private requestIdCounter = 0;
  private enabled = true;

  constructor(config: NetworkMonitorConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxRequests: config.maxRequests ?? 100,
      slowRequestThreshold: config.slowRequestThreshold ?? 1000,
      onSlowRequest: config.onSlowRequest ?? (() => {}),
      onFailedRequest: config.onFailedRequest ?? (() => {}),
      trackHeaders: config.trackHeaders ?? false,
    };

    this.enabled = this.config.enabled;
  }

  trackRequestStart(url: string, method: string = 'GET', headers?: Record<string, string>): string {
    if (!this.enabled) return '';

    const id = `req-${this.requestIdCounter++}`;
    const request: NetworkRequest = {
      id,
      url,
      method,
      startTime: performance.now(),
      headers: this.config.trackHeaders ? headers : undefined,
    };

    this.requests.set(id, request);
    this.requestList.push(request);

    if (this.requestList.length > this.config.maxRequests) {
      const removed = this.requestList.shift();
      if (removed) {
        this.requests.delete(removed.id);
      }
    }

    getPerformanceMonitor().mark(`${id}-start`, {
      type: 'network',
      url,
      method,
    });

    return id;
  }

  trackRequestEnd(
    id: string,
    status: number,
    statusText: string,
    responseSize?: number,
    cached: boolean = false
  ): void {
    if (!this.enabled) return;

    const request = this.requests.get(id);
    if (!request) return;

    const endTime = performance.now();
    const duration = endTime - request.startTime;

    request.endTime = endTime;
    request.duration = duration;
    request.status = status;
    request.statusText = statusText;
    request.responseSize = responseSize;
    request.cached = cached;
    request.failed = status >= 400;

    getPerformanceMonitor().mark(`${id}-end`, {
      type: 'network',
      status,
      duration,
    });

    getPerformanceMonitor().measure(`${id}`, `${id}-start`, `${id}-end`);

    if (duration > this.config.slowRequestThreshold) {
      this.config.onSlowRequest(request);
    }

    if (request.failed) {
      this.config.onFailedRequest(request);
    }
  }

  trackRequestError(id: string, error: Error): void {
    if (!this.enabled) return;

    const request = this.requests.get(id);
    if (!request) return;

    request.endTime = performance.now();
    request.duration = request.endTime - request.startTime;
    request.failed = true;
    request.error = error;

    this.config.onFailedRequest(request);
  }

  getRequest(id: string): NetworkRequest | null {
    return this.requests.get(id) || null;
  }

  getAllRequests(): NetworkRequest[] {
    return [...this.requestList];
  }

  getStats(): NetworkStats {
    const completed = this.requestList.filter((r) => r.endTime);
    const successful = completed.filter((r) => !r.failed);
    const failed = completed.filter((r) => r.failed);
    const cached = completed.filter((r) => r.cached);

    const durations = completed.filter((r) => r.duration).map((r) => r.duration!);
    const averageDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const totalTransferred = completed.reduce((sum, r) => sum + (r.responseSize || 0), 0);

    const slowest = completed.reduce((prev, curr) => {
      if (!prev || !curr.duration) return prev;
      return !prev.duration || curr.duration > prev.duration ? curr : prev;
    }, completed[0]);

    const fastest = completed.reduce((prev, curr) => {
      if (!prev || !curr.duration) return prev;
      return !prev.duration || curr.duration < prev.duration ? curr : prev;
    }, completed[0]);

    return {
      totalRequests: this.requestList.length,
      successfulRequests: successful.length,
      failedRequests: failed.length,
      cachedRequests: cached.length,
      averageDuration,
      totalTransferred,
      slowestRequest: slowest,
      fastestRequest: fastest,
    };
  }

  getSlowRequests(threshold?: number): NetworkRequest[] {
    const limit = threshold || this.config.slowRequestThreshold;
    return this.requestList.filter((r) => r.duration && r.duration > limit);
  }

  getFailedRequests(): NetworkRequest[] {
    return this.requestList.filter((r) => r.failed);
  }

  getCacheHitRate(): number {
    const completed = this.requestList.filter((r) => r.endTime);
    if (completed.length === 0) return 0;
    const cached = completed.filter((r) => r.cached);
    return (cached.length / completed.length) * 100;
  }

  clear(): void {
    this.requests.clear();
    this.requestList = [];
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

let globalMonitor: NetworkMonitor | null = null;

export function getNetworkMonitor(config?: NetworkMonitorConfig): NetworkMonitor {
  if (!globalMonitor) {
    globalMonitor = new NetworkMonitor(config);
  }
  return globalMonitor;
}

export function resetNetworkMonitor(): void {
  if (globalMonitor) {
    globalMonitor.clear();
    globalMonitor = null;
  }
}
