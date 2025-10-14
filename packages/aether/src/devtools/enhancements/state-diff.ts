/**
 * State Diff Viewer
 *
 * Shows before/after state changes with highlighting.
 *
 * @module devtools/enhancements/state-diff
 */

import { signal } from '../../core/reactivity/signal.js';

export interface StateDiff {
  timestamp: number;
  path: string;
  before: any;
  after: any;
  type: 'added' | 'removed' | 'modified';
}

export interface DiffViewerConfig {
  enabled?: boolean;
  maxDiffs?: number;
  autoExpand?: boolean;
}

export class StateDiffViewer {
  private config: Required<DiffViewerConfig>;
  private diffs = signal<StateDiff[]>([]);
  private enabled = true;

  constructor(config: DiffViewerConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxDiffs: config.maxDiffs ?? 100,
      autoExpand: config.autoExpand ?? false,
    };

    this.enabled = this.config.enabled;
  }

  trackChange(path: string, before: any, after: any): void {
    if (!this.enabled) return;

    const type = this.determineChangeType(before, after);
    const diff: StateDiff = {
      timestamp: Date.now(),
      path,
      before,
      after,
      type,
    };

    const current = this.diffs();
    current.push(diff);

    if (current.length > this.config.maxDiffs) {
      current.shift();
    }

    this.diffs.set([...current]);
  }

  private determineChangeType(before: any, after: any): 'added' | 'removed' | 'modified' {
    if (before === undefined) return 'added';
    if (after === undefined) return 'removed';
    return 'modified';
  }

  getDiffs(): StateDiff[] {
    return this.diffs();
  }

  clearDiffs(): void {
    this.diffs.set([]);
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

  formatDiff(diff: StateDiff): string {
    const lines: string[] = [];
    lines.push(`[${new Date(diff.timestamp).toISOString()}] ${diff.path}`);
    lines.push(`Type: ${diff.type}`);

    if (diff.type === 'modified') {
      lines.push(`- ${JSON.stringify(diff.before)}`);
      lines.push(`+ ${JSON.stringify(diff.after)}`);
    } else if (diff.type === 'added') {
      lines.push(`+ ${JSON.stringify(diff.after)}`);
    } else {
      lines.push(`- ${JSON.stringify(diff.before)}`);
    }

    return lines.join('\n');
  }
}

let globalViewer: StateDiffViewer | null = null;

export function getStateDiffViewer(config?: DiffViewerConfig): StateDiffViewer {
  if (!globalViewer) {
    globalViewer = new StateDiffViewer(config);
  }
  return globalViewer;
}

export function resetStateDiffViewer(): void {
  if (globalViewer) {
    globalViewer.clearDiffs();
    globalViewer = null;
  }
}
