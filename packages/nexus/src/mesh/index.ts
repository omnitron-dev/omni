/**
 * Service Mesh Integration for Nexus DI
 * 
 * @module mesh
 * @packageDocumentation
 * 
 * Provides service discovery, load balancing, and distributed communication
 */

import { InjectionToken, Provider } from '../types/core';
import { Container } from '../container/container';
import { createToken } from '../token/token';

/**
 * Service instance information
 */
export interface ServiceInstance {
  id: string;
  name: string;
  version: string;
  address: string;
  port: number;
  metadata: Record<string, any>;
  health: 'healthy' | 'unhealthy' | 'unknown';
  lastHeartbeat: Date;
  weight?: number;
  tags?: string[];
}

/**
 * Service discovery provider interface
 */
export interface ServiceDiscovery {
  register(service: ServiceInstance): Promise<void>;
  deregister(serviceId: string): Promise<void>;
  discover(serviceName: string, version?: string): Promise<ServiceInstance[]>;
  watch(serviceName: string, callback: (instances: ServiceInstance[]) => void): () => void;
  health(serviceId: string): Promise<'healthy' | 'unhealthy'>;
}

/**
 * Load balancing strategies
 */
export enum LoadBalancingStrategy {
  RoundRobin = 'round-robin',
  Random = 'random',
  LeastConnections = 'least-connections',
  WeightedRoundRobin = 'weighted-round-robin',
  ResponseTime = 'response-time',
  ConsistentHash = 'consistent-hash'
}

/**
 * Circuit breaker state
 */
export enum CircuitState {
  Closed = 'closed',
  Open = 'open',
  HalfOpen = 'half-open'
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  threshold: number;
  timeout: number;
  resetTimeout: number;
  monitoringPeriod: number;
  failureRate: number;
}

/**
 * Service proxy configuration
 */
export interface ServiceProxyConfig {
  serviceName: string;
  version?: string;
  loadBalancing: LoadBalancingStrategy;
  circuitBreaker?: CircuitBreakerConfig;
  retries?: number;
  timeout?: number;
  fallback?: (...args: any[]) => any;
}

/**
 * Consul service discovery implementation
 */
export class ConsulServiceDiscovery implements ServiceDiscovery {
  private consulUrl: string;
  private services = new Map<string, ServiceInstance[]>();
  private watchers = new Map<string, Set<(instances: ServiceInstance[]) => void>>();
  
  constructor(consulUrl: string = 'http://localhost:8500') {
    this.consulUrl = consulUrl;
    this.startHealthChecking();
  }
  
  async register(service: ServiceInstance): Promise<void> {
    const registration = {
      ID: service.id,
      Name: service.name,
      Tags: [...(service.tags || []), `version:${service.version}`],
      Address: service.address,
      Port: service.port,
      Meta: service.metadata,
      Check: {
        HTTP: `http://${service.address}:${service.port}/health`,
        Interval: '10s',
        Timeout: '5s'
      }
    };
    
    const response = await fetch(`${this.consulUrl}/v1/agent/service/register`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registration)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to register service: ${response.statusText}`);
    }
    
    // Update local cache
    const instances = this.services.get(service.name) || [];
    instances.push(service);
    this.services.set(service.name, instances);
    this.notifyWatchers(service.name);
  }
  
  async deregister(serviceId: string): Promise<void> {
    const response = await fetch(
      `${this.consulUrl}/v1/agent/service/deregister/${serviceId}`,
      { method: 'PUT' }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to deregister service: ${response.statusText}`);
    }
    
    // Update local cache
    for (const [name, instances] of this.services) {
      const index = instances.findIndex(i => i.id === serviceId);
      if (index !== -1) {
        instances.splice(index, 1);
        this.notifyWatchers(name);
        break;
      }
    }
  }
  
  async discover(serviceName: string, version?: string): Promise<ServiceInstance[]> {
    const response = await fetch(
      `${this.consulUrl}/v1/health/service/${serviceName}?passing=true`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to discover service: ${response.statusText}`);
    }
    
    const data = await response.json();
    const instances: ServiceInstance[] = data.map((entry: any) => ({
      id: entry.Service.ID,
      name: entry.Service.Service,
      version: this.extractVersion(entry.Service.Tags),
      address: entry.Service.Address,
      port: entry.Service.Port,
      metadata: entry.Service.Meta || {},
      health: 'healthy',
      lastHeartbeat: new Date(),
      tags: entry.Service.Tags
    }));
    
    // Filter by version if specified
    if (version) {
      return instances.filter(i => i.version === version);
    }
    
    return instances;
  }
  
  watch(serviceName: string, callback: (instances: ServiceInstance[]) => void): () => void {
    if (!this.watchers.has(serviceName)) {
      this.watchers.set(serviceName, new Set());
    }
    
    this.watchers.get(serviceName)!.add(callback);
    
    // Return unwatch function
    return () => {
      const watchers = this.watchers.get(serviceName);
      if (watchers) {
        watchers.delete(callback);
      }
    };
  }
  
  async health(serviceId: string): Promise<'healthy' | 'unhealthy'> {
    const response = await fetch(
      `${this.consulUrl}/v1/agent/health/service/id/${serviceId}`
    );
    
    if (!response.ok) {
      return 'unhealthy';
    }
    
    const data = await response.json();
    return data.AggregatedStatus === 'passing' ? 'healthy' : 'unhealthy';
  }
  
  private extractVersion(tags: string[]): string {
    const versionTag = tags?.find(t => t.startsWith('version:'));
    return versionTag ? versionTag.split(':')[1] : '1.0.0';
  }
  
  private notifyWatchers(serviceName: string): void {
    const watchers = this.watchers.get(serviceName);
    if (watchers) {
      const instances = this.services.get(serviceName) || [];
      watchers.forEach(callback => callback(instances));
    }
  }
  
  private startHealthChecking(): void {
    setInterval(async () => {
      for (const [name, instances] of this.services) {
        for (const instance of instances) {
          try {
            instance.health = await this.health(instance.id);
          } catch {
            instance.health = 'unknown';
          }
        }
      }
    }, 30000); // Check every 30 seconds
  }
}

/**
 * Load balancer implementation
 */
export class LoadBalancer {
  private strategy: LoadBalancingStrategy;
  private instances: ServiceInstance[] = [];
  private currentIndex = 0;
  private connections = new Map<string, number>();
  private responseTimes = new Map<string, number[]>();
  
  constructor(strategy: LoadBalancingStrategy = LoadBalancingStrategy.RoundRobin) {
    this.strategy = strategy;
  }
  
  setInstances(instances: ServiceInstance[]): void {
    this.instances = instances.filter(i => i.health === 'healthy');
  }
  
  selectInstance(): ServiceInstance | null {
    if (this.instances.length === 0) {
      return null;
    }
    
    switch (this.strategy) {
      case LoadBalancingStrategy.RoundRobin:
        return this.roundRobin();
      
      case LoadBalancingStrategy.Random:
        return this.random();
      
      case LoadBalancingStrategy.LeastConnections:
        return this.leastConnections();
      
      case LoadBalancingStrategy.WeightedRoundRobin:
        return this.weightedRoundRobin();
      
      case LoadBalancingStrategy.ResponseTime:
        return this.responseTime();
      
      case LoadBalancingStrategy.ConsistentHash:
        return this.consistentHash();
      
      default:
        return this.roundRobin();
    }
  }
  
  recordConnection(instanceId: string): void {
    this.connections.set(instanceId, (this.connections.get(instanceId) || 0) + 1);
  }
  
  releaseConnection(instanceId: string): void {
    const count = this.connections.get(instanceId) || 0;
    if (count > 0) {
      this.connections.set(instanceId, count - 1);
    }
  }
  
  recordResponseTime(instanceId: string, time: number): void {
    const times = this.responseTimes.get(instanceId) || [];
    times.push(time);
    // Keep only last 100 response times
    if (times.length > 100) {
      times.shift();
    }
    this.responseTimes.set(instanceId, times);
  }
  
  private roundRobin(): ServiceInstance {
    const instance = this.instances[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.instances.length;
    return instance;
  }
  
  private random(): ServiceInstance {
    const index = Math.floor(Math.random() * this.instances.length);
    return this.instances[index];
  }
  
  private leastConnections(): ServiceInstance {
    let minConnections = Infinity;
    let selected = this.instances[0];
    
    for (const instance of this.instances) {
      const connections = this.connections.get(instance.id) || 0;
      if (connections < minConnections) {
        minConnections = connections;
        selected = instance;
      }
    }
    
    return selected;
  }
  
  private weightedRoundRobin(): ServiceInstance {
    const totalWeight = this.instances.reduce((sum, i) => sum + (i.weight || 1), 0);
    let random = Math.random() * totalWeight;
    
    for (const instance of this.instances) {
      random -= instance.weight || 1;
      if (random <= 0) {
        return instance;
      }
    }
    
    return this.instances[0];
  }
  
  private responseTime(): ServiceInstance {
    let minTime = Infinity;
    let selected = this.instances[0];
    
    for (const instance of this.instances) {
      const times = this.responseTimes.get(instance.id) || [];
      if (times.length === 0) {
        // No data yet, select this one
        return instance;
      }
      
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      if (avgTime < minTime) {
        minTime = avgTime;
        selected = instance;
      }
    }
    
    return selected;
  }
  
  private consistentHash(): ServiceInstance {
    // Simplified consistent hash implementation
    // In production, use a proper consistent hashing algorithm
    return this.instances[0];
  }
}

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.Closed;
  private failures = 0;
  private successes = 0;
  private lastFailureTime?: Date;
  private config: CircuitBreakerConfig;
  
  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.Open) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HalfOpen;
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failures = 0;
    
    if (this.state === CircuitState.HalfOpen) {
      // A single success in half-open state should close the circuit
      this.state = CircuitState.Closed;
      this.successes = 0;
    }
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = new Date();
    
    if (this.failures >= this.config.threshold) {
      this.state = CircuitState.Open;
    }
    
    if (this.state === CircuitState.HalfOpen) {
      this.state = CircuitState.Open;
      this.successes = 0;
    }
  }
  
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) {
      return true;
    }
    
    const timeSinceLastFailure = Date.now() - this.lastFailureTime.getTime();
    return timeSinceLastFailure >= this.config.resetTimeout;
  }
  
  getState(): CircuitState {
    return this.state;
  }
  
  reset(): void {
    this.state = CircuitState.Closed;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = undefined;
  }
}

/**
 * Service proxy for remote service calls
 */
export class ServiceProxy<T = any> {
  private discovery: ServiceDiscovery;
  private loadBalancer: LoadBalancer;
  private circuitBreaker?: CircuitBreaker;
  private config: ServiceProxyConfig;
  
  constructor(
    discovery: ServiceDiscovery,
    config: ServiceProxyConfig
  ) {
    this.discovery = discovery;
    this.config = config;
    this.loadBalancer = new LoadBalancer(config.loadBalancing);
    
    if (config.circuitBreaker) {
      this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    }
    
    this.startWatching();
  }
  
  /**
   * Create a proxy for method calls
   */
  createProxy(): T {
    return new Proxy({} as any, {
      get: (target, prop) => {
        if (typeof prop === 'string') {
          return (...args: any[]) => this.invokeRemoteMethod(prop, args);
        }
        return undefined;
      }
    }) as T;
  }
  
  /**
   * Invoke remote method
   */
  private async invokeRemoteMethod(method: string, args: any[]): Promise<any> {
    const execute = async () => {
      const instance = this.loadBalancer.selectInstance();
      if (!instance) {
        throw new Error(`No healthy instances available for ${this.config.serviceName}`);
      }
      
      this.loadBalancer.recordConnection(instance.id);
      const startTime = Date.now();
      
      try {
        const result = await this.callRemoteService(instance, method, args);
        this.loadBalancer.recordResponseTime(instance.id, Date.now() - startTime);
        return result;
      } finally {
        this.loadBalancer.releaseConnection(instance.id);
      }
    };
    
    // Apply circuit breaker if configured
    if (this.circuitBreaker) {
      try {
        return await this.circuitBreaker.execute(execute);
      } catch (error) {
        if (this.config.fallback) {
          return this.config.fallback(...args);
        }
        throw error;
      }
    }
    
    // Apply retry logic
    let lastError: any;
    for (let i = 0; i <= (this.config.retries || 0); i++) {
      try {
        return await execute();
      } catch (error) {
        lastError = error;
        if (i < (this.config.retries || 0)) {
          await this.delay(Math.pow(2, i) * 1000); // Exponential backoff
        }
      }
    }
    
    if (this.config.fallback) {
      return this.config.fallback(...args);
    }
    
    throw lastError;
  }
  
  /**
   * Call remote service
   */
  private async callRemoteService(
    instance: ServiceInstance,
    method: string,
    args: any[]
  ): Promise<any> {
    const url = `http://${instance.address}:${instance.port}/rpc`;
    const timeout = this.config.timeout || 30000;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Name': this.config.serviceName,
          'X-Service-Version': this.config.version || '',
          'X-Method': method
        },
        body: JSON.stringify({ method, args }),
        signal: controller.signal
      });
      
      if (!response.ok) {
        throw new Error(`Remote call failed: ${response.statusText}`);
      }
      
      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }
      
      return result.data;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  
  /**
   * Start watching service instances
   */
  private startWatching(): void {
    this.discovery.watch(this.config.serviceName, (instances) => {
      if (this.config.version) {
        instances = instances.filter(i => i.version === this.config.version);
      }
      this.loadBalancer.setInstances(instances);
    });
    
    // Initial discovery
    this.discovery.discover(this.config.serviceName, this.config.version).then(
      instances => this.loadBalancer.setInstances(instances)
    );
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a remote proxy for service invocation
 */
export function createRemoteProxy<T>(
  discovery: ServiceDiscovery,
  serviceName: string,
  options?: Partial<ServiceProxyConfig>
): T {
  const config: ServiceProxyConfig = {
    serviceName,
    loadBalancing: options?.loadBalancing || LoadBalancingStrategy.RoundRobin,
    ...options
  };
  
  const proxy = new ServiceProxy<T>(discovery, config);
  return proxy.createProxy();
}

/**
 * Service mesh configuration
 */
export interface ServiceMeshConfig {
  discovery: ServiceDiscovery;
  loadBalancing?: LoadBalancingStrategy;
  circuitBreaker?: CircuitBreakerConfig;
  retries?: number;
  timeout?: number;
}

/**
 * Service mesh manager
 */
export class ServiceMeshManager {
  private discovery: ServiceDiscovery;
  private services = new Map<string, ServiceProxy>();
  private config: ServiceMeshConfig;
  
  constructor(config: ServiceMeshConfig) {
    this.config = config;
    this.discovery = config.discovery;
  }
  
  /**
   * Register a local service
   */
  async registerService(instance: ServiceInstance): Promise<void> {
    await this.discovery.register(instance);
  }
  
  /**
   * Deregister a local service
   */
  async deregisterService(serviceId: string): Promise<void> {
    await this.discovery.deregister(serviceId);
  }
  
  /**
   * Get a proxy for a remote service
   */
  getServiceProxy<T>(serviceName: string, version?: string): T {
    const key = `${serviceName}:${version || 'latest'}`;
    
    if (!this.services.has(key)) {
      const proxyConfig: ServiceProxyConfig = {
        serviceName,
        version,
        loadBalancing: this.config.loadBalancing || LoadBalancingStrategy.RoundRobin,
        circuitBreaker: this.config.circuitBreaker,
        retries: this.config.retries,
        timeout: this.config.timeout
      };
      
      const proxy = new ServiceProxy<T>(this.discovery, proxyConfig);
      this.services.set(key, proxy);
    }
    
    return this.services.get(key)!.createProxy() as T;
  }
  
  /**
   * Health check for all services
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const health = new Map<string, boolean>();
    
    for (const [name, proxy] of this.services) {
      try {
        // Attempt to call a health endpoint
        const result = await (proxy as any).invokeRemoteMethod('health', []);
        health.set(name, result === 'healthy');
      } catch {
        health.set(name, false);
      }
    }
    
    return health;
  }
}

/**
 * Service registry for local services
 */
export class ServiceRegistry {
  private services = new Map<string, any>();
  private metadata = new Map<string, ServiceInstance>();
  
  /**
   * Register a service implementation
   */
  register<T>(name: string, implementation: T, metadata?: Partial<ServiceInstance>): void {
    this.services.set(name, implementation);
    
    if (metadata) {
      this.metadata.set(name, {
        id: metadata.id || `${name}-${Date.now()}`,
        name,
        version: metadata.version || '1.0.0',
        address: metadata.address || 'localhost',
        port: metadata.port || 3000,
        metadata: metadata.metadata || {},
        health: 'healthy',
        lastHeartbeat: new Date(),
        ...metadata
      });
    }
  }
  
  /**
   * Get service implementation
   */
  get<T>(name: string): T | undefined {
    return this.services.get(name) as T;
  }
  
  /**
   * Get service metadata
   */
  getMetadata(name: string): ServiceInstance | undefined {
    return this.metadata.get(name);
  }
  
  /**
   * List all registered services
   */
  list(): string[] {
    return Array.from(this.services.keys());
  }
}

/**
 * Create remote service provider
 */
export function createRemoteServiceProvider<T>(
  serviceName: string,
  discoveryToken: InjectionToken<ServiceDiscovery>
): Provider<T> {
  return {
    useFactory: (discovery: ServiceDiscovery) => {
      const proxy = new ServiceProxy<T>(discovery, {
        serviceName,
        loadBalancing: LoadBalancingStrategy.RoundRobin,
        retries: 3,
        timeout: 30000,
        circuitBreaker: {
          threshold: 5,
          timeout: 60000,
          resetTimeout: 30000,
          monitoringPeriod: 60000,
          failureRate: 0.5
        }
      });
      
      return proxy.createProxy();
    },
    inject: [discoveryToken]
  };
}

// Export tokens
export const ServiceDiscoveryToken = createToken<ServiceDiscovery>('ServiceDiscovery');
export const LoadBalancerToken = createToken<LoadBalancer>('LoadBalancer');
export const CircuitBreakerToken = createToken<CircuitBreaker>('CircuitBreaker');