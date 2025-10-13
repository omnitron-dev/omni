/**
 * DevTools Bridge - Communication between app and extension
 *
 * Provides bidirectional communication bridge between the application
 * and the browser extension DevTools panel.
 *
 * @module devtools/bridge
 */

import type { Bridge, DevToolsMessage } from './types.js';

/**
 * Bridge event names
 */
const BRIDGE_EVENT = '__AETHER_DEVTOOLS__';
const HANDSHAKE_EVENT = '__AETHER_DEVTOOLS_HANDSHAKE__';

/**
 * Default connection timeout
 */
const CONNECTION_TIMEOUT = 5000; // 5 seconds

/**
 * Message handler type
 */
type MessageHandler = (message: DevToolsMessage) => void;

/**
 * Bridge implementation
 */
export class BridgeImpl implements Bridge {
  private connected = false;
  private handlers: Set<MessageHandler> = new Set();
  private messageQueue: DevToolsMessage[] = [];
  private heartbeatInterval?: ReturnType<typeof setInterval>;

  /**
   * Connect to extension
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    // Check if running in browser with window object
    if (typeof window === 'undefined') {
      throw new Error('Bridge can only be used in browser environment');
    }

    // Send handshake
    this.sendHandshake();

    // Wait for handshake response
    await this.waitForHandshake();

    // Setup message listener
    this.setupMessageListener();

    // Start heartbeat
    this.startHeartbeat();

    this.connected = true;

    // Send queued messages
    this.flushMessageQueue();
  }

  /**
   * Disconnect from extension
   */
  disconnect(): void {
    if (!this.connected) return;

    this.connected = false;
    this.stopHeartbeat();
    this.cleanup();
  }

  /**
   * Send message to extension
   */
  send(message: DevToolsMessage): void {
    if (!this.connected) {
      // Queue message for later
      this.messageQueue.push(message);
      return;
    }

    this.postMessage(message);
  }

  /**
   * Register message handler
   */
  receive(handler: MessageHandler): () => void {
    this.handlers.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Send handshake message
   */
  private sendHandshake(): void {
    window.postMessage(
      {
        source: HANDSHAKE_EVENT,
        type: 'app-ready',
        timestamp: Date.now(),
      },
      '*',
    );
  }

  /**
   * Wait for handshake response
   */
  private waitForHandshake(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('Handshake timeout - DevTools extension may not be installed'));
      }, CONNECTION_TIMEOUT);

      const handler = (event: MessageEvent) => {
        if (
          event.data &&
          event.data.source === HANDSHAKE_EVENT &&
          event.data.type === 'extension-ready'
        ) {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve();
        }
      };

      window.addEventListener('message', handler);
    });
  }

  /**
   * Setup message listener
   */
  private setupMessageListener(): void {
    window.addEventListener('message', this.handleMessage);
  }

  /**
   * Handle incoming message
   */
  private handleMessage = (event: MessageEvent): void => {
    if (!event.data || event.data.source !== BRIDGE_EVENT) return;

    const message = event.data.message as DevToolsMessage;
    if (!message || !message.type) return;

    // Handle ping
    if (message.type === 'ping') {
      this.send({ type: 'pong', timestamp: Date.now() });
      return;
    }

    // Dispatch to handlers
    for (const handler of this.handlers) {
      try {
        handler(message);
      } catch (error) {
        console.error('DevTools bridge handler error:', error);
      }
    }
  };

  /**
   * Post message to extension
   */
  private postMessage(message: DevToolsMessage): void {
    window.postMessage(
      {
        source: BRIDGE_EVENT,
        message: this.serializeMessage(message),
      },
      '*',
    );
  }

  /**
   * Serialize message (handle circular references)
   */
  private serializeMessage(message: DevToolsMessage): DevToolsMessage {
    try {
      // Clone to avoid modifying original
      const cloned = JSON.parse(JSON.stringify(message));
      return cloned;
    } catch (_error) {
      // If serialization fails, send minimal message
      return {
        type: message.type,
        timestamp: message.timestamp,
        payload: '[Serialization Error]',
      };
    }
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.postMessage(message);
      }
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.connected) {
        this.send({ type: 'ping', timestamp: Date.now() });
      }
    }, 10000); // Every 10 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.handleMessage);
    }
    this.handlers.clear();
    this.messageQueue = [];
  }
}

/**
 * Create bridge instance
 */
export function createBridge(): Bridge {
  return new BridgeImpl();
}

/**
 * Check if DevTools is available
 */
export function isDevToolsAvailable(): boolean {
  if (typeof window === 'undefined') return false;

  // Check for extension marker
  return '__AETHER_DEVTOOLS_EXTENSION__' in window;
}
