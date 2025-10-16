/**
 * Editor profiling system
 *
 * Provides:
 * - Transaction profiler
 * - Plugin profiler
 * - Render profiler
 * - Memory profiler
 * - Profile export for analysis
 * - Visual profiling overlay
 */

import type { EditorState, Transaction } from 'prosemirror-state';

/**
 * Profile entry
 */
export interface ProfileEntry {
  name: string;
  type: 'transaction' | 'plugin' | 'render' | 'memory' | 'custom';
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Transaction profile
 */
export interface TransactionProfile extends ProfileEntry {
  type: 'transaction';
  metadata: {
    docSize: number;
    steps: number;
    meta: Record<string, any>;
  };
}

/**
 * Plugin profile
 */
export interface PluginProfile extends ProfileEntry {
  type: 'plugin';
  metadata: {
    pluginName: string;
    phase: 'state' | 'view' | 'props';
  };
}

/**
 * Render profile
 */
export interface RenderProfile extends ProfileEntry {
  type: 'render';
  metadata: {
    updateType: 'full' | 'partial' | 'decoration';
    nodeCount: number;
  };
}

/**
 * Memory profile
 */
export interface MemoryProfile {
  timestamp: number;
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  delta?: number;
}

/**
 * Profiler configuration
 */
export interface ProfilerConfig {
  /** Enable profiling */
  enabled?: boolean;

  /** Profile transactions */
  profileTransactions?: boolean;

  /** Profile plugins */
  profilePlugins?: boolean;

  /** Profile renders */
  profileRenders?: boolean;

  /** Profile memory */
  profileMemory?: boolean;

  /** Memory sampling interval (ms) */
  memorySampleInterval?: number;

  /** Maximum profile entries to keep */
  maxEntries?: number;

  /** Show visual overlay */
  showOverlay?: boolean;

  /** Performance budget warnings */
  budgets?: {
    transaction?: number;
    plugin?: number;
    render?: number;
  };
}

/**
 * Profiler statistics
 */
export interface ProfilerStats {
  totalTransactions: number;
  totalPluginCalls: number;
  totalRenders: number;
  averageTransactionTime: number;
  averagePluginTime: number;
  averageRenderTime: number;
  slowestTransaction?: ProfileEntry;
  slowestPlugin?: ProfileEntry;
  slowestRender?: ProfileEntry;
  memoryUsage?: {
    current: number;
    peak: number;
    average: number;
  };
}

/**
 * EditorProfiler class
 */
export class EditorProfiler {
  private config: Required<ProfilerConfig>;
  private profiles: ProfileEntry[] = [];
  private memoryProfiles: MemoryProfile[] = [];
  private memoryInterval?: ReturnType<typeof setInterval>;
  private overlay?: HTMLElement;

  constructor(config: ProfilerConfig = {}) {
    this.config = {
      enabled: false,
      profileTransactions: true,
      profilePlugins: true,
      profileRenders: true,
      profileMemory: true,
      memorySampleInterval: 1000,
      maxEntries: 1000,
      showOverlay: false,
      budgets: {},
      ...config,
    };
  }

  /**
   * Start profiling
   */
  start(): void {
    if (!this.config.enabled) {
      return;
    }

    // Start memory profiling
    if (this.config.profileMemory) {
      this.startMemoryProfiling();
    }

    // Show overlay
    if (this.config.showOverlay) {
      this.createOverlay();
    }
  }

  /**
   * Stop profiling
   */
  stop(): void {
    this.stopMemoryProfiling();
    this.removeOverlay();
  }

  /**
   * Profile a transaction
   */
  profileTransaction(tr: Transaction, oldState: EditorState, newState: EditorState): void {
    if (!this.config.enabled || !this.config.profileTransactions) {
      return;
    }

    const start = performance.now();

    // Transaction is already applied, just record the timing
    const duration = performance.now() - start;

    const profile: TransactionProfile = {
      name: 'transaction',
      type: 'transaction',
      duration,
      timestamp: start,
      metadata: {
        docSize: newState.doc.content.size,
        steps: tr.steps.length,
        meta: tr.meta || {},
      },
    };

    this.addProfile(profile);

    // Check budget
    if (this.config.budgets.transaction && duration > this.config.budgets.transaction) {
      console.warn(`Transaction exceeded budget: ${duration.toFixed(2)}ms`);
    }
  }

  /**
   * Profile a plugin
   */
  profilePlugin(pluginName: string, phase: 'state' | 'view' | 'props', fn: () => any): any {
    if (!this.config.enabled || !this.config.profilePlugins) {
      return fn();
    }

    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;

    const profile: PluginProfile = {
      name: pluginName,
      type: 'plugin',
      duration,
      timestamp: start,
      metadata: {
        pluginName,
        phase,
      },
    };

    this.addProfile(profile);

    // Check budget
    if (this.config.budgets.plugin && duration > this.config.budgets.plugin) {
      console.warn(`Plugin ${pluginName} exceeded budget: ${duration.toFixed(2)}ms`);
    }

    return result;
  }

  /**
   * Profile a render
   */
  profileRender(updateType: 'full' | 'partial' | 'decoration', nodeCount: number, fn: () => void): void {
    if (!this.config.enabled || !this.config.profileRenders) {
      fn();
      return;
    }

    const start = performance.now();
    fn();
    const duration = performance.now() - start;

    const profile: RenderProfile = {
      name: 'render',
      type: 'render',
      duration,
      timestamp: start,
      metadata: {
        updateType,
        nodeCount,
      },
    };

    this.addProfile(profile);

    // Check budget
    if (this.config.budgets.render && duration > this.config.budgets.render) {
      console.warn(`Render exceeded budget: ${duration.toFixed(2)}ms`);
    }

    // Update overlay
    if (this.overlay) {
      this.updateOverlay();
    }
  }

  /**
   * Add custom profile entry
   */
  profile(name: string, fn: () => any, metadata?: Record<string, any>): any {
    if (!this.config.enabled) {
      return fn();
    }

    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;

    const profile: ProfileEntry = {
      name,
      type: 'custom',
      duration,
      timestamp: start,
      metadata,
    };

    this.addProfile(profile);

    return result;
  }

  /**
   * Add profile entry
   */
  private addProfile(profile: ProfileEntry): void {
    this.profiles.push(profile);

    // Limit size
    if (this.profiles.length > this.config.maxEntries) {
      this.profiles.shift();
    }
  }

  /**
   * Start memory profiling
   */
  private startMemoryProfiling(): void {
    if (typeof performance === 'undefined' || !(performance as any).memory) {
      return;
    }

    this.memoryInterval = setInterval(() => {
      const memory = (performance as any).memory;
      const current: MemoryProfile = {
        timestamp: performance.now(),
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
      };

      // Calculate delta
      if (this.memoryProfiles.length > 0) {
        const last = this.memoryProfiles[this.memoryProfiles.length - 1];
        current.delta = current.usedJSHeapSize - last.usedJSHeapSize;
      }

      this.memoryProfiles.push(current);

      // Limit size
      if (this.memoryProfiles.length > this.config.maxEntries) {
        this.memoryProfiles.shift();
      }
    }, this.config.memorySampleInterval);
  }

  /**
   * Stop memory profiling
   */
  private stopMemoryProfiling(): void {
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
      this.memoryInterval = undefined;
    }
  }

  /**
   * Get profiler statistics
   */
  getStats(): ProfilerStats {
    const transactions = this.profiles.filter((p) => p.type === 'transaction');
    const plugins = this.profiles.filter((p) => p.type === 'plugin');
    const renders = this.profiles.filter((p) => p.type === 'render');

    const avgTransaction =
      transactions.length > 0 ? transactions.reduce((sum, p) => sum + p.duration, 0) / transactions.length : 0;

    const avgPlugin = plugins.length > 0 ? plugins.reduce((sum, p) => sum + p.duration, 0) / plugins.length : 0;

    const avgRender = renders.length > 0 ? renders.reduce((sum, p) => sum + p.duration, 0) / renders.length : 0;

    const slowestTransaction = transactions.reduce(
      (max, p) => (p.duration > (max?.duration || 0) ? p : max),
      undefined as ProfileEntry | undefined
    );

    const slowestPlugin = plugins.reduce(
      (max, p) => (p.duration > (max?.duration || 0) ? p : max),
      undefined as ProfileEntry | undefined
    );

    const slowestRender = renders.reduce(
      (max, p) => (p.duration > (max?.duration || 0) ? p : max),
      undefined as ProfileEntry | undefined
    );

    let memoryUsage: ProfilerStats['memoryUsage'];
    if (this.memoryProfiles.length > 0) {
      const used = this.memoryProfiles.map((m) => m.usedJSHeapSize);
      memoryUsage = {
        current: used[used.length - 1],
        peak: Math.max(...used),
        average: used.reduce((sum, v) => sum + v, 0) / used.length,
      };
    }

    return {
      totalTransactions: transactions.length,
      totalPluginCalls: plugins.length,
      totalRenders: renders.length,
      averageTransactionTime: avgTransaction,
      averagePluginTime: avgPlugin,
      averageRenderTime: avgRender,
      slowestTransaction,
      slowestPlugin,
      slowestRender,
      memoryUsage,
    };
  }

  /**
   * Export profiles as JSON
   */
  exportJSON(): string {
    return JSON.stringify(
      {
        config: this.config,
        profiles: this.profiles,
        memoryProfiles: this.memoryProfiles,
        stats: this.getStats(),
      },
      null,
      2
    );
  }

  /**
   * Clear all profiles
   */
  clear(): void {
    this.profiles = [];
    this.memoryProfiles = [];
  }

  /**
   * Create visual overlay
   */
  private createOverlay(): void {
    if (typeof document === 'undefined') {
      return;
    }

    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #0f0;
      font-family: monospace;
      font-size: 12px;
      padding: 10px;
      border-radius: 4px;
      z-index: 10000;
      max-width: 300px;
    `;

    document.body.appendChild(this.overlay);
    this.updateOverlay();
  }

  /**
   * Update overlay content
   */
  private updateOverlay(): void {
    if (!this.overlay) {
      return;
    }

    const stats = this.getStats();

    const lines: string[] = [
      '📊 Editor Profiler',
      '',
      `Transactions: ${stats.totalTransactions}`,
      `Avg: ${stats.averageTransactionTime.toFixed(2)}ms`,
      '',
      `Plugins: ${stats.totalPluginCalls}`,
      `Avg: ${stats.averagePluginTime.toFixed(2)}ms`,
      '',
      `Renders: ${stats.totalRenders}`,
      `Avg: ${stats.averageRenderTime.toFixed(2)}ms`,
    ];

    if (stats.memoryUsage) {
      const usedMB = (stats.memoryUsage.current / 1024 / 1024).toFixed(2);
      const peakMB = (stats.memoryUsage.peak / 1024 / 1024).toFixed(2);
      lines.push('', `Memory: ${usedMB} MB`, `Peak: ${peakMB} MB`);
    }

    this.overlay.innerHTML = lines.join('<br>');
  }

  /**
   * Remove overlay
   */
  private removeOverlay(): void {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
      this.overlay = undefined;
    }
  }

  /**
   * Destroy profiler
   */
  destroy(): void {
    this.stop();
    this.clear();
  }
}

/**
 * Global profiler instance
 */
export const editorProfiler = new EditorProfiler();

/**
 * Profile decorator for methods
 */
export function Profile(name?: string) {
  return function profileDecorator(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const profileName = name || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = function profiledMethod(...args: any[]) {
      return editorProfiler.profile(profileName, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}
