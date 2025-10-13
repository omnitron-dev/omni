/**
 * Enhanced Time-Travel Debugging
 *
 * Provides advanced time-travel debugging with state snapshots,
 * rewind/replay, action logs, state diff visualization, and breakpoints.
 *
 * @module devtools/time-travel
 */

import type { Recorder, HistoryEntry, StateDiff } from './types.js';

/**
 * Time-travel configuration
 */
export interface TimeTravelConfig {
  /** Enable automatic snapshots */
  autoSnapshot?: boolean;
  /** Snapshot interval (ms) */
  snapshotInterval?: number;
  /** Enable action logging */
  enableActionLog?: boolean;
  /** Enable breakpoints */
  enableBreakpoints?: boolean;
  /** Maximum undo history */
  maxHistory?: number;
}

/**
 * Action log entry
 */
export interface ActionLogEntry {
  id: string;
  timestamp: number;
  action: string;
  payload: any;
  description: string;
  historyIndex: number;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * State snapshot
 */
export interface StateSnapshot {
  id: string;
  timestamp: number;
  index: number;
  state: Map<string, any>;
  description: string;
  tags: string[];
}

/**
 * Breakpoint configuration
 */
export interface Breakpoint {
  id: string;
  type: 'state-change' | 'value-equals' | 'value-range' | 'mutation-count';
  targetId: string;
  condition?: BreakpointCondition;
  enabled: boolean;
  hitCount: number;
}

/**
 * Breakpoint condition
 */
export interface BreakpointCondition {
  type: 'equals' | 'not-equals' | 'greater-than' | 'less-than' | 'range' | 'custom';
  value?: any;
  min?: number;
  max?: number;
  predicate?: (value: any) => boolean;
}

/**
 * Diff visualization node
 */
export interface DiffNode {
  path: string;
  type: 'added' | 'removed' | 'changed' | 'unchanged';
  oldValue?: any;
  newValue?: any;
  children?: DiffNode[];
}

/**
 * Playback options
 */
export interface PlaybackOptions {
  speed: number; // 1.0 = normal speed
  startIndex?: number;
  endIndex?: number;
  loop?: boolean;
  pauseOnBreakpoint?: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<TimeTravelConfig> = {
  autoSnapshot: true,
  snapshotInterval: 5000,
  enableActionLog: true,
  enableBreakpoints: true,
  maxHistory: 1000,
};

/**
 * Enhanced Time-Travel Debugger
 */
export class TimeTravelDebugger {
  private config: Required<TimeTravelConfig>;
  private recorder: Recorder;

  // Action logging
  private actionLog: ActionLogEntry[] = [];

  // Snapshots
  private snapshots: StateSnapshot[] = [];
  private snapshotTimer?: number;

  // Breakpoints
  private breakpoints = new Map<string, Breakpoint>();
  private pausedAtBreakpoint: Breakpoint | null = null;

  // Playback
  private isPlaying = false;
  private playbackTimer?: number;
  private playbackOptions?: PlaybackOptions;

  constructor(recorder: Recorder, config: Partial<TimeTravelConfig> = {}) {
    this.recorder = recorder;
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoSnapshot) {
      this.startAutoSnapshot();
    }
  }

  /**
   * Take manual snapshot
   */
  takeSnapshot(description: string = '', tags: string[] = []): StateSnapshot {
    const recorderState = this.recorder.getState();
    const snapshot: StateSnapshot = {
      id: `snapshot-${Date.now()}`,
      timestamp: Date.now(),
      index: recorderState.currentIndex,
      state: new Map(), // Would be populated from actual state
      description,
      tags,
    };

    this.snapshots.push(snapshot);
    return snapshot;
  }

  /**
   * Restore from snapshot
   */
  restoreSnapshot(snapshotId: string): void {
    const snapshot = this.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    this.recorder.jumpToState(snapshot.index);
    this.logAction('restore-snapshot', { snapshotId }, `Restored snapshot: ${snapshot.description}`);
  }

  /**
   * Start auto-snapshot
   */
  private startAutoSnapshot(): void {
    this.snapshotTimer = window.setInterval(() => {
      const state = this.recorder.getState();
      if (state.isRecording) {
        this.takeSnapshot('Auto snapshot');
      }
    }, this.config.snapshotInterval);
  }

  /**
   * Stop auto-snapshot
   */
  private stopAutoSnapshot(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  /**
   * Log action
   */
  private logAction(action: string, payload: any, description: string): void {
    if (!this.config.enableActionLog) return;

    const state = this.recorder.getState();
    const entry: ActionLogEntry = {
      id: `action-${Date.now()}`,
      timestamp: Date.now(),
      action,
      payload,
      description,
      historyIndex: state.currentIndex,
      canUndo: state.currentIndex >= 0,
      canRedo: state.currentIndex < state.history.length - 1,
    };

    this.actionLog.push(entry);

    // Enforce max history
    if (this.actionLog.length > this.config.maxHistory) {
      this.actionLog.shift();
    }
  }

  /**
   * Undo with logging
   */
  undo(): void {
    this.recorder.undo();
    this.logAction('undo', {}, 'Undo state change');
  }

  /**
   * Redo with logging
   */
  redo(): void {
    this.recorder.redo();
    this.logAction('redo', {}, 'Redo state change');
  }

  /**
   * Jump to specific state
   */
  jumpTo(index: number): void {
    this.recorder.jumpToState(index);
    this.logAction('jump', { index }, `Jumped to state ${index}`);
  }

  /**
   * Get action log
   */
  getActionLog(): ActionLogEntry[] {
    return [...this.actionLog];
  }

  /**
   * Clear action log
   */
  clearActionLog(): void {
    this.actionLog = [];
  }

  /**
   * Get all snapshots
   */
  getSnapshots(): StateSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Delete snapshot
   */
  deleteSnapshot(snapshotId: string): void {
    const index = this.snapshots.findIndex((s) => s.id === snapshotId);
    if (index !== -1) {
      this.snapshots.splice(index, 1);
    }
  }

  /**
   * Export debug session
   */
  exportSession(): string {
    const recorderSession = this.recorder.exportSession();
    const parsed = JSON.parse(recorderSession);

    const session = {
      ...parsed,
      actionLog: this.actionLog,
      snapshots: this.snapshots.map((s) => ({
        ...s,
        state: Array.from(s.state.entries()),
      })),
      breakpoints: Array.from(this.breakpoints.values()),
    };

    return JSON.stringify(session, null, 2);
  }

  /**
   * Import debug session
   */
  importSession(data: string): void {
    try {
      const session = JSON.parse(data);

      // Import recorder session
      const recorderSession = {
        version: session.version,
        sessionStartTime: session.sessionStartTime,
        history: session.history,
        currentIndex: session.currentIndex,
      };
      this.recorder.importSession(JSON.stringify(recorderSession));

      // Import action log
      this.actionLog = session.actionLog || [];

      // Import snapshots
      this.snapshots = (session.snapshots || []).map((s: any) => ({
        ...s,
        state: new Map(s.state),
      }));

      // Import breakpoints
      if (session.breakpoints) {
        this.breakpoints.clear();
        for (const bp of session.breakpoints) {
          this.breakpoints.set(bp.id, bp);
        }
      }
    } catch (error) {
      throw new Error(`Failed to import session: ${error}`);
    }
  }

  /**
   * Create state diff visualization
   */
  visualizeDiff(indexA: number, indexB: number): DiffNode[] {
    const diff = this.recorder.diff(indexA, indexB);
    return this.buildDiffTree(diff);
  }

  /**
   * Build diff tree from flat changes
   */
  private buildDiffTree(diff: StateDiff): DiffNode[] {
    const nodes: DiffNode[] = [];

    for (const change of diff.changes) {
      const node: DiffNode = {
        path: change.path,
        type: change.type,
        oldValue: change.oldValue,
        newValue: change.newValue,
        children: this.buildValueDiff(change.oldValue, change.newValue),
      };
      nodes.push(node);
    }

    return nodes;
  }

  /**
   * Build value diff (deep comparison)
   */
  private buildValueDiff(oldValue: any, newValue: any): DiffNode[] | undefined {
    if (typeof oldValue !== 'object' || typeof newValue !== 'object') {
      return undefined;
    }

    const nodes: DiffNode[] = [];
    const oldKeys = new Set(Object.keys(oldValue || {}));
    const newKeys = new Set(Object.keys(newValue || {}));

    // Added keys
    for (const key of newKeys) {
      if (!oldKeys.has(key)) {
        nodes.push({
          path: key,
          type: 'added',
          newValue: newValue[key],
        });
      }
    }

    // Removed keys
    for (const key of oldKeys) {
      if (!newKeys.has(key)) {
        nodes.push({
          path: key,
          type: 'removed',
          oldValue: oldValue[key],
        });
      }
    }

    // Changed keys
    for (const key of oldKeys) {
      if (newKeys.has(key) && oldValue[key] !== newValue[key]) {
        nodes.push({
          path: key,
          type: 'changed',
          oldValue: oldValue[key],
          newValue: newValue[key],
          children: this.buildValueDiff(oldValue[key], newValue[key]),
        });
      }
    }

    return nodes.length > 0 ? nodes : undefined;
  }

  /**
   * Add breakpoint
   */
  addBreakpoint(targetId: string, type: Breakpoint['type'], condition?: BreakpointCondition): Breakpoint {
    const breakpoint: Breakpoint = {
      id: `bp-${Date.now()}`,
      type,
      targetId,
      condition,
      enabled: true,
      hitCount: 0,
    };

    this.breakpoints.set(breakpoint.id, breakpoint);
    return breakpoint;
  }

  /**
   * Remove breakpoint
   */
  removeBreakpoint(breakpointId: string): void {
    this.breakpoints.delete(breakpointId);
  }

  /**
   * Toggle breakpoint
   */
  toggleBreakpoint(breakpointId: string): void {
    const breakpoint = this.breakpoints.get(breakpointId);
    if (breakpoint) {
      breakpoint.enabled = !breakpoint.enabled;
    }
  }

  /**
   * Get all breakpoints
   */
  getBreakpoints(): Breakpoint[] {
    return Array.from(this.breakpoints.values());
  }

  /**
   * Check if state change should break
   */
  checkBreakpoint(targetId: string, newValue: any): boolean {
    if (!this.config.enableBreakpoints) return false;

    for (const breakpoint of this.breakpoints.values()) {
      if (!breakpoint.enabled) continue;
      if (breakpoint.targetId !== targetId) continue;

      let shouldBreak = false;

      switch (breakpoint.type) {
        case 'state-change':
          shouldBreak = true;
          break;

        case 'value-equals':
          if (breakpoint.condition?.value !== undefined) {
            shouldBreak = newValue === breakpoint.condition.value;
          }
          break;

        case 'value-range':
          if (breakpoint.condition?.min !== undefined && breakpoint.condition?.max !== undefined) {
            shouldBreak =
              typeof newValue === 'number' &&
              newValue >= breakpoint.condition.min &&
              newValue <= breakpoint.condition.max;
          }
          break;

        case 'mutation-count':
          breakpoint.hitCount++;
          if (breakpoint.condition?.value !== undefined) {
            shouldBreak = breakpoint.hitCount >= breakpoint.condition.value;
          }
          break;
        default:
          // Unknown breakpoint type
          break;
      }

      if (shouldBreak) {
        this.pausedAtBreakpoint = breakpoint;
        return true;
      }
    }

    return false;
  }

  /**
   * Resume from breakpoint
   */
  resume(): void {
    this.pausedAtBreakpoint = null;
  }

  /**
   * Get current breakpoint (if paused)
   */
  getCurrentBreakpoint(): Breakpoint | null {
    return this.pausedAtBreakpoint;
  }

  /**
   * Start playback
   */
  startPlayback(options: PlaybackOptions): void {
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.playbackOptions = options;

    const state = this.recorder.getState();
    const startIndex = options.startIndex ?? 0;
    const endIndex = options.endIndex ?? state.history.length - 1;
    let currentIndex = startIndex;

    const play = () => {
      if (!this.isPlaying) return;

      // Check if paused at breakpoint
      if (this.pausedAtBreakpoint && options.pauseOnBreakpoint) {
        return;
      }

      // Jump to current index
      this.recorder.jumpToState(currentIndex);

      currentIndex++;

      // Check if we've reached the end
      if (currentIndex > endIndex) {
        if (options.loop) {
          currentIndex = startIndex;
        } else {
          this.stopPlayback();
          return;
        }
      }

      // Schedule next frame
      const delay = 1000 / 60 / options.speed; // Assuming 60fps baseline
      this.playbackTimer = window.setTimeout(play, delay);
    };

    play();
  }

  /**
   * Stop playback
   */
  stopPlayback(): void {
    this.isPlaying = false;
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = undefined;
    }
  }

  /**
   * Pause playback
   */
  pausePlayback(): void {
    this.isPlaying = false;
  }

  /**
   * Is currently playing
   */
  isPlaybackActive(): boolean {
    return this.isPlaying;
  }

  /**
   * Get history visualization data
   */
  getHistoryVisualization(): HistoryVisualization {
    const history = this.recorder.getHistory();
    const state = this.recorder.getState();

    return {
      entries: history.map((entry, index) => ({
        index,
        entry,
        isCurrent: index === state.currentIndex,
        hasSnapshot: this.snapshots.some((s) => s.index === index),
        hasBreakpoint: Array.from(this.breakpoints.values()).some((bp) => bp.targetId === entry.targetId),
      })),
      currentIndex: state.currentIndex,
      totalEntries: history.length,
      snapshots: this.snapshots,
    };
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.stopAutoSnapshot();
    this.stopPlayback();
    this.actionLog = [];
    this.snapshots = [];
    this.breakpoints.clear();
  }
}

/**
 * History visualization data
 */
export interface HistoryVisualization {
  entries: Array<{
    index: number;
    entry: HistoryEntry;
    isCurrent: boolean;
    hasSnapshot: boolean;
    hasBreakpoint: boolean;
  }>;
  currentIndex: number;
  totalEntries: number;
  snapshots: StateSnapshot[];
}

/**
 * Create time-travel debugger
 */
export function createTimeTravelDebugger(recorder: Recorder, config?: Partial<TimeTravelConfig>): TimeTravelDebugger {
  return new TimeTravelDebugger(recorder, config);
}
