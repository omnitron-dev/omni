/**
 * Performance Overlay
 *
 * Visual overlay showing component render performance metrics.
 *
 * @module devtools/enhancements/performance-overlay
 */

import { signal } from '../../core/reactivity/signal.js';
import { computed } from '../../core/reactivity/computed.js';
import { getComponentTracker } from '../../monitoring/component-tracking.js';
import { getPerformanceMonitor } from '../../monitoring/performance.js';

export interface OverlayConfig {
  enabled?: boolean;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  showRenderTimes?: boolean;
  showUpdateFrequency?: boolean;
  showMemoryUsage?: boolean;
  highlightSlowRenders?: boolean;
  slowRenderThreshold?: number;
}

export class PerformanceOverlay {
  private config: Required<OverlayConfig>;
  private overlayElement: HTMLElement | null = null;
  private enabled = signal(true);
  private stats = signal({
    fps: 0,
    renderCount: 0,
    slowRenders: 0,
    averageDuration: 0,
  });

  constructor(config: OverlayConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      position: config.position ?? 'top-right',
      showRenderTimes: config.showRenderTimes ?? true,
      showUpdateFrequency: config.showUpdateFrequency ?? true,
      showMemoryUsage: config.showMemoryUsage ?? true,
      highlightSlowRenders: config.highlightSlowRenders ?? true,
      slowRenderThreshold: config.slowRenderThreshold ?? 16,
    };

    if (this.config.enabled && typeof document !== 'undefined') {
      this.initialize();
    }
  }

  private initialize(): void {
    this.createOverlay();
    this.startTracking();
  }

  private createOverlay(): void {
    if (typeof document === 'undefined') return;

    this.overlayElement = document.createElement('div');
    this.overlayElement.id = 'aether-performance-overlay';
    this.overlayElement.style.cssText = this.getOverlayStyles();
    document.body.appendChild(this.overlayElement);
  }

  private getOverlayStyles(): string {
    const positions = {
      'top-left': 'top: 10px; left: 10px;',
      'top-right': 'top: 10px; right: 10px;',
      'bottom-left': 'bottom: 10px; left: 10px;',
      'bottom-right': 'bottom: 10px; right: 10px;',
    };

    return `
      position: fixed;
      ${positions[this.config.position]}
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 10px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      z-index: 999999;
      min-width: 200px;
    `;
  }

  private startTracking(): void {
    let lastTime = performance.now();
    let frames = 0;

    const updateStats = () => {
      const now = performance.now();
      const delta = now - lastTime;
      frames++;

      if (delta >= 1000) {
        const fps = Math.round((frames * 1000) / delta);
        const tracker = getComponentTracker();
        const slowest = tracker.getSlowestComponents(1)[0];

        this.stats.set({
          fps,
          renderCount: tracker.getAllComponents().length,
          slowRenders: tracker.getTopRerenderingComponents(1)[0]?.renderCount || 0,
          averageDuration: slowest?.averageDuration || 0,
        });

        this.updateOverlay();
        frames = 0;
        lastTime = now;
      }

      if (this.enabled()) {
        requestAnimationFrame(updateStats);
      }
    };

    requestAnimationFrame(updateStats);
  }

  private updateOverlay(): void {
    if (!this.overlayElement) return;

    const stats = this.stats();
    const lines: string[] = [];

    if (this.config.showRenderTimes) {
      lines.push(`FPS: ${stats.fps}`);
      lines.push(`Avg Render: ${stats.averageDuration.toFixed(2)}ms`);
    }

    if (this.config.showUpdateFrequency) {
      lines.push(`Components: ${stats.renderCount}`);
      lines.push(`Re-renders: ${stats.slowRenders}`);
    }

    if (this.config.showMemoryUsage && (performance as any).memory) {
      const memory = (performance as any).memory;
      const used = (memory.usedJSHeapSize / 1048576).toFixed(1);
      lines.push(`Memory: ${used}MB`);
    }

    this.overlayElement.innerHTML = lines.join('<br>');
  }

  show(): void {
    this.enabled.set(true);
    if (this.overlayElement) {
      this.overlayElement.style.display = 'block';
    }
  }

  hide(): void {
    this.enabled.set(false);
    if (this.overlayElement) {
      this.overlayElement.style.display = 'none';
    }
  }

  dispose(): void {
    this.enabled.set(false);
    if (this.overlayElement) {
      this.overlayElement.remove();
      this.overlayElement = null;
    }
  }
}

let globalOverlay: PerformanceOverlay | null = null;

export function getPerformanceOverlay(config?: OverlayConfig): PerformanceOverlay {
  if (!globalOverlay) {
    globalOverlay = new PerformanceOverlay(config);
  }
  return globalOverlay;
}

export function resetPerformanceOverlay(): void {
  if (globalOverlay) {
    globalOverlay.dispose();
    globalOverlay = null;
  }
}
