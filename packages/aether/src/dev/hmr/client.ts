/**
 * HMR Client Runtime
 *
 * Client-side Hot Module Replacement runtime for Aether
 * This code runs in the browser
 */

import type { HMRPayload, HMRUpdate } from '../types.js';

interface HotAPI {
  accept: (cb?: (mod: any) => void) => void;
  acceptExports: (exports: string[], cb?: (mod: any) => void) => void;
  dispose: (cb: (data: any) => void) => void;
  decline: () => void;
  invalidate: () => void;
  data: any;
  on: (event: string, cb: (...args: any[]) => void) => void;
}

// Extend ImportMeta interface
declare module '*.ts' {
  interface ImportMeta {
    hot?: HotAPI;
    url: string;
    env?: Record<string, string>;
  }
}

/**
 * HMR Client
 */
export class HMRClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private pendingUpdates: HMRUpdate[] = [];
  private isFirstUpdate = true;

  /**
   * Connect to HMR server
   */
  connect(url: string): void {
    if (this.ws) {
      return;
    }

    console.log('[HMR] Connecting to', url);

    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      console.log('[HMR] Connected');
      this.reconnectAttempts = 0;
      this.isFirstUpdate = true;
    });

    this.ws.addEventListener('message', async (event) => {
      try {
        const payload: HMRPayload = JSON.parse(event.data);
        await this.handleMessage(payload);
      } catch (error) {
        console.error('[HMR] Failed to process message:', error);
      }
    });

    this.ws.addEventListener('close', () => {
      console.log('[HMR] Connection closed');
      this.ws = null;
      this.scheduleReconnect(url);
    });

    this.ws.addEventListener('error', (error) => {
      console.error('[HMR] WebSocket error:', error);
    });
  }

  /**
   * Handle HMR message
   */
  private async handleMessage(payload: HMRPayload): Promise<void> {
    switch (payload.type) {
      case 'connected':
        await this.handleConnected();
        break;

      case 'update':
        if (payload.updates) {
          await this.handleUpdates(payload.updates);
        }
        break;

      case 'full-reload':
        this.handleFullReload();
        break;

      case 'prune':
        await this.handlePrune(payload.updates || []);
        break;

      case 'error':
        this.handleError(payload.error);
        break;

      case 'custom':
        await this.handleCustom(payload.data);
        break;

      default:
        console.warn('[HMR] Unknown message type:', payload.type);
    }
  }

  /**
   * Handle connected message
   */
  private async handleConnected(): Promise<void> {
    // Send pending updates from before connection
    if (this.pendingUpdates.length > 0) {
      await this.handleUpdates(this.pendingUpdates);
      this.pendingUpdates = [];
    }
  }

  /**
   * Handle module updates
   */
  private async handleUpdates(updates: HMRUpdate[]): Promise<void> {
    const updatePromises: Promise<void>[] = [];

    for (const update of updates) {
      if (update.type === 'update') {
        updatePromises.push(this.applyUpdate(update));
      } else if (update.type === 'full-reload') {
        this.handleFullReload();
        return;
      }
    }

    try {
      await Promise.all(updatePromises);

      // Show update notification
      if (!this.isFirstUpdate) {
        this.notifyUpdate(updates);
      }

      this.isFirstUpdate = false;
    } catch (error) {
      console.error('[HMR] Update failed:', error);
      this.handleFullReload();
    }
  }

  /**
   * Apply single module update
   */
  private async applyUpdate(update: HMRUpdate): Promise<void> {
    const { path, acceptedPath, timestamp } = update;

    console.log(`[HMR] Updating ${path}`);

    try {
      // Import the updated module
      const modulePath = this.resolveModulePath(acceptedPath || path);
      const newModule = await import(
        /* @vite-ignore */ `${modulePath}?t=${timestamp}`
      );

      // Check if module accepts HMR
      if (typeof (import.meta as any).hot?.accept === 'function') {
        // Module can handle its own update
        (import.meta as any).hot.accept(() => {
          console.log(`[HMR] Module ${path} accepted update`);
        });
      }

      // Dispatch custom event for app-level handling
      this.dispatchUpdateEvent(path, newModule);
    } catch (error) {
      console.error(`[HMR] Failed to apply update for ${path}:`, error);
      throw error;
    }
  }

  /**
   * Handle full page reload
   */
  private handleFullReload(): void {
    console.log('[HMR] Full reload required');
    window.location.reload();
  }

  /**
   * Handle module pruning (unused modules)
   */
  private async handlePrune(updates: HMRUpdate[]): Promise<void> {
    for (const update of updates) {
      console.log(`[HMR] Pruning ${update.path}`);
      // Remove module from cache
      // This is handled by the bundler
    }
  }

  /**
   * Handle error
   */
  private handleError(error?: any): void {
    console.error('[HMR] Server error:', error);

    // Show error overlay if available
    if ((window as any).__AETHER_ERROR_OVERLAY__) {
      (window as any).__AETHER_ERROR_OVERLAY__.show(error);
    }
  }

  /**
   * Handle custom event
   */
  private async handleCustom(data: any): Promise<void> {
    console.log('[HMR] Custom event:', data);

    // Dispatch custom event
    window.dispatchEvent(
      new CustomEvent('aether:hmr:custom', {
        detail: data,
      })
    );
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(url: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[HMR] Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(
      `[HMR] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect(url);
    }, delay);
  }

  /**
   * Resolve module path
   */
  private resolveModulePath(path: string): string {
    // Handle absolute paths
    if (path.startsWith('/')) {
      return path;
    }

    // Handle relative paths
    if (path.startsWith('.')) {
      const base = import.meta.url.substring(
        0,
        import.meta.url.lastIndexOf('/')
      );
      return `${base}/${path}`;
    }

    // Handle bare imports
    return `/@modules/${path}`;
  }

  /**
   * Dispatch update event
   */
  private dispatchUpdateEvent(path: string, module: any): void {
    window.dispatchEvent(
      new CustomEvent('aether:hmr:update', {
        detail: { path, module },
      })
    );
  }

  /**
   * Show update notification
   */
  private notifyUpdate(updates: HMRUpdate[]): void {
    const paths = updates.map((u) => u.path).join(', ');
    console.log(`[HMR] Updated: ${paths}`);

    // Optional: Show toast notification
    if ((window as any).__AETHER_TOAST__) {
      (window as any).__AETHER_TOAST__.show({
        type: 'success',
        message: `Updated ${updates.length} module(s)`,
        duration: 2000,
      });
    }
  }

  /**
   * Disconnect from HMR server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

/**
 * Global HMR client instance
 */
let hmrClient: HMRClient | null = null;

/**
 * Initialize HMR client
 */
export function initHMR(): void {
  if (hmrClient) {
    return;
  }

  // Only in development
  if (import.meta.env?.MODE !== 'development') {
    return;
  }

  hmrClient = new HMRClient();

  // Connect to WebSocket server
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}/__aether_hmr`;

  hmrClient.connect(url);
}

/**
 * Get HMR client instance
 */
export function getHMRClient(): HMRClient | null {
  return hmrClient;
}

// Auto-initialize in browser
if (typeof window !== 'undefined') {
  initHMR();
}
