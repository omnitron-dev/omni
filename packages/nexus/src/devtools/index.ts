/**
 * DevTools Extension for Nexus DI
 * 
 * @module devtools
 * @packageDocumentation
 * 
 * Provides debugging and visualization tools for dependency injection
 */

import { InjectionToken, Provider, ResolutionContext, Scope } from '../types/core';
import { Container } from '../container/container';
import { Plugin } from '../plugins/plugin';
import { createToken } from '../token/token';
import { LifecycleEvent } from '../lifecycle/lifecycle';

/**
 * DevTools message types
 */
export enum MessageType {
  ContainerCreated = 'CONTAINER_CREATED',
  ContainerDisposed = 'CONTAINER_DISPOSED',
  TokenRegistered = 'TOKEN_REGISTERED',
  TokenResolved = 'TOKEN_RESOLVED',
  ResolutionStarted = 'RESOLUTION_STARTED',
  ResolutionCompleted = 'RESOLUTION_COMPLETED',
  ResolutionFailed = 'RESOLUTION_FAILED',
  ScopeCreated = 'SCOPE_CREATED',
  ScopeDisposed = 'SCOPE_DISPOSED',
  ModuleLoaded = 'MODULE_LOADED',
  PluginInstalled = 'PLUGIN_INSTALLED',
  StateSnapshot = 'STATE_SNAPSHOT',
  PerformanceMetrics = 'PERFORMANCE_METRICS'
}

/**
 * DevTools message
 */
export interface DevToolsMessage {
  type: MessageType;
  timestamp: number;
  containerId: string;
  data: any;
}

/**
 * Dependency graph node
 */
export interface DependencyNode {
  id: string;
  token: string;
  scope: Scope;
  dependencies: string[];
  dependents: string[];
  metadata: Record<string, any>;
  instanceCreated: boolean;
  creationTime?: number;
  resolutionCount: number;
}

/**
 * Dependency graph
 */
export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: Array<{ from: string; to: string; type: 'dependency' | 'parent' }>;
  roots: string[];
  leaves: string[];
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  totalResolutions: number;
  averageResolutionTime: number;
  slowestResolutions: Array<{
    token: string;
    time: number;
    timestamp: number;
  }>;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  cacheHitRate: number;
  errorRate: number;
}

/**
 * Container state snapshot
 */
export interface ContainerSnapshot {
  id: string;
  timestamp: number;
  registrations: Array<{
    token: string;
    provider: string;
    scope: Scope;
    metadata: Record<string, any>;
  }>;
  instances: Array<{
    token: string;
    created: boolean;
    createdAt?: number;
    disposed: boolean;
  }>;
  scopes: Array<{
    id: string;
    parent?: string;
    created: number;
    context: Record<string, any>;
  }>;
  modules: string[];
  plugins: string[];
}

/**
 * DevTools server for browser extension communication
 */
export class DevToolsServer {
  private port = 9229;
  private server?: any; // WebSocket server
  private connections = new Set<any>();
  private messageQueue: DevToolsMessage[] = [];
  private maxQueueSize = 1000;
  
  constructor(port?: number) {
    if (port) this.port = port;
  }
  
  /**
   * Start the DevTools server
   */
  async start(): Promise<void> {
    // Check if we're in a Node.js environment
    if (typeof global !== 'undefined' && global.process) {
      try {
        const WebSocket = await import('ws');
        const { Server } = WebSocket;
        
        this.server = new Server({ port: this.port });
        
        this.server.on('connection', (ws: any) => {
          this.connections.add(ws);
          
          // Send queued messages
          this.messageQueue.forEach(msg => {
            ws.send(JSON.stringify(msg));
          });
          
          ws.on('close', () => {
            this.connections.delete(ws);
          });
          
          ws.on('message', (data: any) => {
            this.handleClientMessage(JSON.parse(data.toString()));
          });
        });
        
        console.log(`Nexus DevTools server listening on ws://localhost:${this.port}`);
      } catch (error) {
        console.warn('WebSocket server not available:', error);
      }
    }
  }
  
  /**
   * Stop the DevTools server
   */
  stop(): void {
    if (this.server) {
      this.connections.forEach(ws => ws.close());
      this.server.close();
      this.server = undefined;
    }
  }
  
  /**
   * Send message to all connected clients
   */
  broadcast(message: DevToolsMessage): void {
    const serialized = JSON.stringify(message);
    
    if (this.connections.size > 0) {
      this.connections.forEach(ws => {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(serialized);
        }
      });
    } else {
      // Queue messages if no connections
      this.messageQueue.push(message);
      if (this.messageQueue.length > this.maxQueueSize) {
        this.messageQueue.shift();
      }
    }
  }
  
  /**
   * Handle messages from clients
   */
  private handleClientMessage(message: any): void {
    // Handle commands from DevTools extension
    switch (message.type) {
      case 'GET_SNAPSHOT':
        // Request handled by DevToolsPlugin
        break;
      case 'CLEAR_CACHE':
        // Request handled by DevToolsPlugin
        break;
      case 'TRIGGER_GC':
        if (global.gc) {
          global.gc();
        }
        break;
    }
  }
}

/**
 * DevTools plugin for container
 */
export class DevToolsPlugin implements Plugin {
  name = 'devtools';
  version = '1.0.0';
  
  private server: DevToolsServer;
  private containers = new Map<string, Container>();
  private graphs = new Map<string, DependencyGraph>();
  private metrics = new Map<string, PerformanceMetrics>();
  private resolutionTimes = new Map<string, number[]>();
  private enabled = true;
  
  constructor(config?: {
    port?: number;
    autoStart?: boolean;
    enabled?: boolean;
  }) {
    this.server = new DevToolsServer(config?.port);
    this.enabled = config?.enabled !== false;
    
    if (config?.autoStart !== false && this.enabled) {
      this.server.start().catch(console.error);
    }
  }
  
  install(container: Container): void {
    if (!this.enabled) return;
    
    const containerId = this.generateContainerId();
    (container as any).__devtools_id = containerId;
    this.containers.set(containerId, container);
    this.graphs.set(containerId, this.createEmptyGraph());
    this.metrics.set(containerId, this.createEmptyMetrics());
    
    // Notify DevTools
    this.sendMessage({
      type: MessageType.ContainerCreated,
      timestamp: Date.now(),
      containerId,
      data: { id: containerId }
    });
    
    // Install hooks
    this.installHooks(container, containerId);
    
    // Register DevTools service in container
    container.register(DevToolsToken, { useValue: this });
  }
  
  /**
   * Get dependency graph for a container
   */
  getDependencyGraph(containerId: string): DependencyGraph | undefined {
    return this.graphs.get(containerId);
  }
  
  /**
   * Get performance metrics for a container
   */
  getPerformanceMetrics(containerId: string): PerformanceMetrics | undefined {
    return this.metrics.get(containerId);
  }
  
  /**
   * Get container snapshot
   */
  getSnapshot(containerId: string): ContainerSnapshot | undefined {
    const container = this.containers.get(containerId);
    if (!container) return undefined;
    
    const snapshot: ContainerSnapshot = {
      id: containerId,
      timestamp: Date.now(),
      registrations: [],
      instances: [],
      scopes: [],
      modules: [],
      plugins: []
    };
    
    // Get registrations
    const registrations = (container as any).registrations;
    if (registrations) {
      registrations.forEach((registration: any, token: any) => {
        snapshot.registrations.push({
          token: this.getTokenName(token),
          provider: this.getProviderType(registration.provider),
          scope: registration.scope,
          metadata: registration.metadata || {}
        });
      });
    }
    
    // Get instances
    const instances = (container as any).instances;
    if (instances) {
      instances.forEach((instance: any, token: any) => {
        snapshot.instances.push({
          token: this.getTokenName(token),
          created: true,
          createdAt: Date.now(),
          disposed: false
        });
      });
    }
    
    return snapshot;
  }
  
  /**
   * Visualize dependency graph as DOT format
   */
  generateGraphVisualization(containerId: string): string {
    const graph = this.graphs.get(containerId);
    if (!graph) return '';
    
    const lines: string[] = ['digraph Dependencies {'];
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box];');
    
    // Add nodes
    graph.nodes.forEach(node => {
      const color = node.instanceCreated ? 'lightgreen' : 'lightgray';
      const label = `${node.token}\\n${node.scope}\\n(${node.resolutionCount} resolutions)`;
      lines.push(`  "${node.id}" [label="${label}", fillcolor="${color}", style="filled"];`);
    });
    
    // Add edges
    graph.edges.forEach(edge => {
      const style = edge.type === 'parent' ? 'dashed' : 'solid';
      lines.push(`  "${edge.from}" -> "${edge.to}" [style="${style}"];`);
    });
    
    lines.push('}');
    return lines.join('\n');
  }
  
  /**
   * Generate Mermaid diagram
   */
  generateMermaidDiagram(containerId: string): string {
    const graph = this.graphs.get(containerId);
    if (!graph) return '';
    
    const lines: string[] = ['graph TD'];
    
    // Add nodes
    graph.nodes.forEach(node => {
      const shape = node.scope === Scope.Singleton ? '((' : '([';
      const endShape = node.scope === Scope.Singleton ? '))' : '])';
      lines.push(`  ${node.id}${shape}${node.token}${endShape}`);
    });
    
    // Add edges
    graph.edges.forEach(edge => {
      const arrow = edge.type === 'parent' ? '-..->' : '-->';
      lines.push(`  ${edge.from} ${arrow} ${edge.to}`);
    });
    
    return lines.join('\n');
  }
  
  /**
   * Export telemetry data
   */
  exportTelemetry(containerId: string): any {
    return {
      graph: this.graphs.get(containerId),
      metrics: this.metrics.get(containerId),
      snapshot: this.getSnapshot(containerId)
    };
  }
  
  private installHooks(container: Container, containerId: string): void {
    const graph = this.graphs.get(containerId)!;
    const metrics = this.metrics.get(containerId)!;
    
    // Get the lifecycle manager from the container
    const lifecycleManager = (container as any).lifecycleManager;
    if (!lifecycleManager) return;
    
    // Registration hook
    lifecycleManager.on(LifecycleEvent.AfterRegister, (data: any) => {
      const token = data.token;
      const provider = data.metadata?.provider;
      
      if (!token) return;
      
      const nodeId = this.getNodeId(token);
      
      if (!graph.nodes.has(nodeId)) {
        graph.nodes.set(nodeId, {
          id: nodeId,
          token: this.getTokenName(token),
          scope: (provider as any)?.scope || Scope.Transient,
          dependencies: [],
          dependents: [],
          metadata: {},
          instanceCreated: false,
          resolutionCount: 0
        });
      }
      
      this.sendMessage({
        type: MessageType.TokenRegistered,
        timestamp: Date.now(),
        containerId,
        data: {
          token: this.getTokenName(token),
          provider: provider ? this.getProviderType(provider) : 'unknown'
        }
      });
    });
    
    // Resolution hooks
    lifecycleManager.on(LifecycleEvent.BeforeResolve, (data: any) => {
      const token = data.token;
      const context = data.context;
      
      if (!token || !context) return;
      
      const startTime = Date.now();
      (context as any).__resolution_start = startTime;
      
      this.sendMessage({
        type: MessageType.ResolutionStarted,
        timestamp: startTime,
        containerId,
        data: {
          token: this.getTokenName(token),
          context: this.serializeContext(context)
        }
      });
    });
    
    lifecycleManager.on(LifecycleEvent.AfterResolve, (data: any) => {
      const token = data.token;
      const instance = data.instance;
      const context = data.context;
      
      if (!token || !context) return;
      
      const startTime = (context as any).__resolution_start || Date.now();
      const duration = Date.now() - startTime;
      
      // Update graph
      const nodeId = this.getNodeId(token);
      const node = graph.nodes.get(nodeId);
      if (node) {
        node.instanceCreated = true;
        node.creationTime = Date.now();
        node.resolutionCount++;
      }
      
      // Update metrics
      metrics.totalResolutions++;
      const times = this.resolutionTimes.get(containerId) || [];
      times.push(duration);
      this.resolutionTimes.set(containerId, times);
      
      // Update average
      metrics.averageResolutionTime = times.reduce((a, b) => a + b, 0) / times.length;
      
      // Track slowest
      if (duration > 10) { // More than 10ms is considered slow
        metrics.slowestResolutions.push({
          token: this.getTokenName(token),
          time: duration,
          timestamp: Date.now()
        });
        metrics.slowestResolutions.sort((a, b) => b.time - a.time);
        metrics.slowestResolutions = metrics.slowestResolutions.slice(0, 10);
      }
      
      this.sendMessage({
        type: MessageType.ResolutionCompleted,
        timestamp: Date.now(),
        containerId,
        data: {
          token: this.getTokenName(token),
          duration,
          instance: this.serializeInstance(instance)
        }
      });
    });
    
    // Error hook
    lifecycleManager.on(LifecycleEvent.ResolveFailed, (data: any) => {
      const error = data.error;
      const context = data.context;
      
      if (!error) return;
      
      metrics.errorRate = (metrics.errorRate * metrics.totalResolutions + 1) / (metrics.totalResolutions + 1);
      
      this.sendMessage({
        type: MessageType.ResolutionFailed,
        timestamp: Date.now(),
        containerId,
        data: {
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack
          },
          context: context ? this.serializeContext(context) : {}
        }
      });
    });
    
    // Container lifecycle hooks
    lifecycleManager.on(LifecycleEvent.ContainerDisposing, () => {
      this.sendMessage({
        type: MessageType.ContainerDisposed,
        timestamp: Date.now(),
        containerId,
        data: { id: containerId }
      });
      
      // Clean up
      this.containers.delete(containerId);
      this.graphs.delete(containerId);
      this.metrics.delete(containerId);
      this.resolutionTimes.delete(containerId);
    });
    
    // Module hooks
    lifecycleManager.on(LifecycleEvent.ModuleLoaded, (data: any) => {
      this.sendMessage({
        type: MessageType.ModuleLoaded,
        timestamp: Date.now(),
        containerId,
        data: {
          moduleName: data.metadata?.moduleName || 'unknown'
        }
      });
    });
    
    // Plugin hooks
    lifecycleManager.on(LifecycleEvent.PluginInstalled, (data: any) => {
      this.sendMessage({
        type: MessageType.PluginInstalled,
        timestamp: Date.now(),
        containerId,
        data: {
          pluginName: data.metadata?.pluginName || 'unknown'
        }
      });
    });
    
    // Cache hooks
    lifecycleManager.on(LifecycleEvent.CacheHit, (data: any) => {
      const cacheHits = (metrics as any).cacheHits || 0;
      (metrics as any).cacheHits = cacheHits + 1;
      this.updateCacheHitRate(metrics);
    });
    
    lifecycleManager.on(LifecycleEvent.CacheMiss, (data: any) => {
      const cacheMisses = (metrics as any).cacheMisses || 0;
      (metrics as any).cacheMisses = cacheMisses + 1;
      this.updateCacheHitRate(metrics);
    });
  }
  
  private sendMessage(message: DevToolsMessage): void {
    this.server.broadcast(message);
  }
  
  private generateContainerId(): string {
    return `container_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private getNodeId(token: InjectionToken<any>): string {
    return this.getTokenName(token);
  }
  
  private getTokenName(token: InjectionToken<any>): string {
    if (typeof token === 'string') return token;
    if (typeof token === 'symbol') return token.toString();
    if (typeof token === 'function') return token.name || 'AnonymousClass';
    if (token && typeof token === 'object' && 'name' in token) return token.name;
    return 'Unknown';
  }
  
  private getProviderType(provider: any): string {
    if (provider.useClass) return 'class';
    if (provider.useValue) return 'value';
    if (provider.useFactory) return 'factory';
    if (provider.useToken) return 'token';
    if (provider.useAsync) return 'async';
    return 'unknown';
  }
  
  private updateCacheHitRate(metrics: PerformanceMetrics): void {
    const hits = (metrics as any).cacheHits || 0;
    const misses = (metrics as any).cacheMisses || 0;
    const total = hits + misses;
    metrics.cacheHitRate = total > 0 ? hits / total : 0;
  }
  
  private serializeContext(context: ResolutionContext): any {
    return {
      scope: context.scope,
      parentExists: !!context.parent
    };
  }
  
  private serializeInstance(instance: any): any {
    if (!instance) return null;
    
    const type = typeof instance;
    if (type === 'function') {
      return {
        type: 'function',
        name: instance.name || 'anonymous',
        length: instance.length
      };
    }
    
    if (type === 'object') {
      return {
        type: 'object',
        constructor: instance.constructor?.name || 'Object',
        keys: Object.keys(instance).slice(0, 10)
      };
    }
    
    return {
      type,
      value: type === 'string' && instance.length > 100 
        ? instance.substring(0, 100) + '...' 
        : instance
    };
  }
  
  private createEmptyGraph(): DependencyGraph {
    return {
      nodes: new Map(),
      edges: [],
      roots: [],
      leaves: []
    };
  }
  
  private createEmptyMetrics(): PerformanceMetrics {
    return {
      totalResolutions: 0,
      averageResolutionTime: 0,
      slowestResolutions: [],
      memoryUsage: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0
      },
      cacheHitRate: 0,
      errorRate: 0
    };
  }
}

/**
 * Browser extension connector
 */
export class DevToolsExtension {
  private port?: any; // chrome.runtime.Port
  private listeners = new Map<MessageType, Set<(data: any) => void>>();
  
  /**
   * Connect to browser extension
   */
  connect(): void {
    if (typeof (globalThis as any).chrome !== 'undefined' && (globalThis as any).chrome?.runtime) {
      try {
        const chrome = (globalThis as any).chrome;
        this.port = chrome.runtime.connect({ name: 'nexus-devtools' });
        
        this.port.onMessage.addListener((message: DevToolsMessage) => {
          this.handleMessage(message);
        });
        
        this.port.onDisconnect.addListener(() => {
          console.log('Nexus DevTools extension disconnected');
          this.port = undefined;
        });
        
        console.log('Connected to Nexus DevTools extension');
      } catch (error) {
        console.warn('Failed to connect to Nexus DevTools extension:', error);
      }
    }
  }
  
  /**
   * Send message to extension
   */
  send(message: DevToolsMessage): void {
    if (this.port) {
      this.port.postMessage(message);
    }
  }
  
  /**
   * Listen for messages
   */
  on(type: MessageType, callback: (data: any) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    
    this.listeners.get(type)!.add(callback);
    
    return () => {
      this.listeners.get(type)?.delete(callback);
    };
  }
  
  private handleMessage(message: DevToolsMessage): void {
    const listeners = this.listeners.get(message.type);
    if (listeners) {
      listeners.forEach(callback => callback(message.data));
    }
  }
}

/**
 * Console DevTools (fallback when no extension available)
 */
export class ConsoleDevTools {
  private enabled = true;
  private verbose = false;
  
  constructor(config?: { enabled?: boolean; verbose?: boolean }) {
    this.enabled = config?.enabled !== false;
    this.verbose = config?.verbose || false;
  }
  
  log(message: DevToolsMessage): void {
    if (!this.enabled) return;
    
    const prefix = `[Nexus:${message.type}]`;
    const timestamp = new Date(message.timestamp).toISOString();
    
    switch (message.type) {
      case MessageType.ResolutionFailed:
        console.error(prefix, timestamp, message.data);
        break;
      
      case MessageType.ResolutionCompleted:
        if (message.data.duration > 10) {
          console.warn(prefix, `Slow resolution (${message.data.duration}ms):`, message.data.token);
        } else if (this.verbose) {
          console.log(prefix, timestamp, message.data);
        }
        break;
      
      default:
        if (this.verbose) {
          console.log(prefix, timestamp, message.data);
        }
    }
  }
}

// Export tokens
export const DevToolsToken = createToken<DevToolsPlugin>('DevTools');
export const DevToolsServerToken = createToken<DevToolsServer>('DevToolsServer');