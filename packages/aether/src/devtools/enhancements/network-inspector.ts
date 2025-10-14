/**
 * Network Inspector
 *
 * UI for inspecting network requests with details.
 *
 * @module devtools/enhancements/network-inspector
 */

import { signal } from '../../core/reactivity/signal.js';
import { computed } from '../../core/reactivity/computed.js';
import { getNetworkMonitor, type NetworkRequest } from '../../monitoring/network-monitor.js';

export interface InspectorConfig {
  enabled?: boolean;
  position?: 'bottom' | 'right';
  height?: number;
  width?: number;
}

export class NetworkInspector {
  private config: Required<InspectorConfig>;
  private selectedRequest = signal<string | null>(null);
  private filterText = signal('');
  private enabled = signal(true);

  constructor(config: InspectorConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      position: config.position ?? 'bottom',
      height: config.height ?? 300,
      width: config.width ?? 400,
    };

    this.enabled.set(this.config.enabled);
  }

  getRequests = computed(() => {
    const monitor = getNetworkMonitor();
    const requests = monitor.getAllRequests();
    const filter = this.filterText().toLowerCase();

    if (!filter) return requests;

    return requests.filter((r) => r.url.toLowerCase().includes(filter) || r.method.toLowerCase().includes(filter));
  });

  getSelectedRequestDetails = computed(() => {
    const id = this.selectedRequest();
    if (!id) return null;

    const monitor = getNetworkMonitor();
    return monitor.getRequest(id);
  });

  selectRequest(id: string): void {
    this.selectedRequest.set(id);
  }

  clearSelection(): void {
    this.selectedRequest.set(null);
  }

  setFilter(text: string): void {
    this.filterText.set(text);
  }

  formatRequest(request: NetworkRequest): string {
    const lines: string[] = [];
    lines.push(`${request.method} ${request.url}`);
    lines.push(`Status: ${request.status || 'Pending'} ${request.statusText || ''}`);

    if (request.duration) {
      lines.push(`Duration: ${request.duration.toFixed(2)}ms`);
    }

    if (request.responseSize) {
      lines.push(`Size: ${(request.responseSize / 1024).toFixed(2)}KB`);
    }

    if (request.cached) {
      lines.push('Cached: Yes');
    }

    if (request.headers) {
      lines.push('\nHeaders:');
      for (const [key, value] of Object.entries(request.headers)) {
        lines.push(`  ${key}: ${value}`);
      }
    }

    return lines.join('\n');
  }

  enable(): void {
    this.enabled.set(true);
  }

  disable(): void {
    this.enabled.set(false);
  }

  isEnabled(): boolean {
    return this.enabled();
  }
}

let globalInspector: NetworkInspector | null = null;

export function getNetworkInspector(config?: InspectorConfig): NetworkInspector {
  if (!globalInspector) {
    globalInspector = new NetworkInspector(config);
  }
  return globalInspector;
}

export function resetNetworkInspector(): void {
  if (globalInspector) {
    globalInspector.clearSelection();
    globalInspector = null;
  }
}
