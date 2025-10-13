/**
 * Network Inspector - Track netron-browser requests and WebSocket connections
 *
 * Provides network monitoring capabilities for Aether's netron-browser
 * integration, tracking all RPC calls, responses, and WebSocket activity.
 *
 * @module devtools/network
 */

import type { NetworkInspector, NetworkState, NetworkEvent, WebSocketConnection } from './types.js';

/**
 * Generate unique ID
 */
let nextEventId = 0;
const generateEventId = (): string => `event-${++nextEventId}`;

let nextConnectionId = 0;
const generateConnectionId = (): string => `ws-${++nextConnectionId}`;

/**
 * Network inspector implementation
 */
export class NetworkInspectorImpl implements NetworkInspector {
  private events: NetworkEvent[] = [];
  private connections = new Map<string, WebSocketConnection>();
  private cacheHits = 0;
  private cacheMisses = 0;

  // Request timing tracking
  private pendingRequests = new Map<string, { startTime: number; event: NetworkEvent }>();

  /**
   * Intercept netron request
   */
  interceptRequest(request: any): void {
    const event: NetworkEvent = {
      id: generateEventId(),
      type: 'request',
      timestamp: Date.now(),
      service: request.service,
      method: request.method,
      request: this.serializePayload(request.args),
    };

    this.events.push(event);
    this.pendingRequests.set(event.id, { startTime: performance.now(), event });
  }

  /**
   * Log response
   */
  logResponse(response: any): void {
    const requestId = response.requestId || response.id;
    const pending = this.pendingRequests.get(requestId);

    if (pending) {
      const duration = performance.now() - pending.startTime;
      const event = pending.event;

      // Update the event with response data
      event.type = 'response';
      event.response = this.serializePayload(response.result);
      event.duration = duration;
      event.cached = response.cached || false;

      if (event.cached) {
        this.cacheHits++;
        event.cacheKey = response.cacheKey;
      } else {
        this.cacheMisses++;
      }

      this.pendingRequests.delete(requestId);
    } else {
      // Standalone response (might be from cache or subscription)
      const event: NetworkEvent = {
        id: generateEventId(),
        type: 'response',
        timestamp: Date.now(),
        service: response.service,
        method: response.method,
        response: this.serializePayload(response.result),
        cached: response.cached || false,
      };

      if (event.cached) {
        this.cacheHits++;
        event.cacheKey = response.cacheKey;
      }

      this.events.push(event);
    }
  }

  /**
   * Log error
   */
  logError(error: any, requestId?: string): void {
    const pending = requestId ? this.pendingRequests.get(requestId) : undefined;

    if (pending) {
      const duration = performance.now() - pending.startTime;
      const event = pending.event;

      // Update event with error
      event.type = 'error';
      event.error = {
        message: error.message || String(error),
        stack: error.stack,
      };
      event.duration = duration;

      if (requestId) {
        this.pendingRequests.delete(requestId);
      }
    } else {
      // Standalone error
      const event: NetworkEvent = {
        id: generateEventId(),
        type: 'error',
        timestamp: Date.now(),
        error: {
          message: error.message || String(error),
          stack: error.stack,
        },
      };

      this.events.push(event);
    }
  }

  /**
   * Track WebSocket connection
   */
  trackWebSocket(ws: WebSocket, url: string): void {
    const connectionId = generateConnectionId();

    const connection: WebSocketConnection = {
      id: connectionId,
      url,
      state: 'connecting',
      connectedAt: Date.now(),
      messageCount: 0,
      bytesSent: 0,
      bytesReceived: 0,
    };

    this.connections.set(connectionId, connection);

    // Log WebSocket open event
    const openEvent: NetworkEvent = {
      id: generateEventId(),
      type: 'websocket',
      timestamp: Date.now(),
      connectionId,
      wsEvent: 'open',
    };
    this.events.push(openEvent);

    // Intercept WebSocket events
    const originalSend = ws.send.bind(ws);
    ws.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
      connection.messageCount++;
      connection.bytesSent += this.calculateSize(data);

      // Log message event
      const messageEvent: NetworkEvent = {
        id: generateEventId(),
        type: 'websocket',
        timestamp: Date.now(),
        connectionId,
        wsEvent: 'message',
        request: this.serializeWebSocketData(data),
      };
      this.events.push(messageEvent);

      return originalSend(data);
    };

    ws.addEventListener('open', () => {
      connection.state = 'open';
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      connection.messageCount++;
      connection.bytesReceived += this.calculateSize(event.data);

      // Log message event
      const messageEvent: NetworkEvent = {
        id: generateEventId(),
        type: 'websocket',
        timestamp: Date.now(),
        connectionId,
        wsEvent: 'message',
        response: this.serializeWebSocketData(event.data),
      };
      this.events.push(messageEvent);
    });

    ws.addEventListener('close', () => {
      connection.state = 'closed';

      // Log close event
      const closeEvent: NetworkEvent = {
        id: generateEventId(),
        type: 'websocket',
        timestamp: Date.now(),
        connectionId,
        wsEvent: 'close',
      };
      this.events.push(closeEvent);
    });

    ws.addEventListener('error', (event: Event) => {
      // Log error event
      const errorEvent: NetworkEvent = {
        id: generateEventId(),
        type: 'websocket',
        timestamp: Date.now(),
        connectionId,
        wsEvent: 'error',
        error: {
          message: 'WebSocket error',
          stack: String(event),
        },
      };
      this.events.push(errorEvent);
    });
  }

  /**
   * Calculate data size in bytes
   */
  private calculateSize(data: any): number {
    if (typeof data === 'string') {
      return new Blob([data]).size;
    }
    if (data instanceof Blob) {
      return data.size;
    }
    if (data instanceof ArrayBuffer) {
      return data.byteLength;
    }
    if (ArrayBuffer.isView(data)) {
      return data.byteLength;
    }
    return 0;
  }

  /**
   * Serialize WebSocket data for display
   */
  private serializeWebSocketData(data: any): any {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return data;
      }
    }
    if (data instanceof ArrayBuffer) {
      return `[ArrayBuffer ${data.byteLength} bytes]`;
    }
    if (ArrayBuffer.isView(data)) {
      return `[${data.constructor.name} ${data.byteLength} bytes]`;
    }
    return String(data);
  }

  /**
   * Serialize payload for display
   */
  private serializePayload(payload: any): any {
    try {
      // Handle circular references
      const seen = new WeakSet();

      const serialize = (val: any, depth = 0): any => {
        if (depth > 5) return '[Deep Object]';
        if (val === null || val === undefined) return val;
        if (typeof val !== 'object') return val;

        if (seen.has(val)) return '[Circular]';
        seen.add(val);

        if (Array.isArray(val)) {
          return val.map((item) => serialize(item, depth + 1));
        }

        const result: any = {};
        for (const key in val) {
          if (Object.prototype.hasOwnProperty.call(val, key)) {
            result[key] = serialize(val[key], depth + 1);
          }
        }
        return result;
      };

      return serialize(payload);
    } catch {
      return '[Unserializable]';
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): NetworkState['cacheStats'] {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? this.cacheHits / total : 0;

    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate,
    };
  }

  /**
   * Get network timeline
   */
  getNetworkTimeline(): NetworkEvent[] {
    return [...this.events].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get events by type
   */
  getEventsByType(type: NetworkEvent['type']): NetworkEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Get events by service
   */
  getEventsByService(service: string): NetworkEvent[] {
    return this.events.filter((e) => e.service === service);
  }

  /**
   * Get active connections
   */
  getActiveConnections(): WebSocketConnection[] {
    return Array.from(this.connections.values()).filter((c) => c.state === 'open' || c.state === 'connecting');
  }

  /**
   * Get current state
   */
  getState(): NetworkState {
    return {
      events: [...this.events],
      connections: new Map(this.connections),
      cacheStats: this.getCacheStats(),
    };
  }

  /**
   * Clear events
   */
  clear(): void {
    this.events = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.pendingRequests.clear();
  }

  /**
   * Clear connections
   */
  clearConnections(): void {
    this.connections.clear();
  }
}

/**
 * Create network inspector instance
 */
export function createNetworkInspector(): NetworkInspector {
  return new NetworkInspectorImpl();
}
