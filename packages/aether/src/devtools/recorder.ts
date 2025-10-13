/**
 * Time-Travel Recorder - Record and replay state mutations
 *
 * Provides time-travel debugging capabilities by recording all state
 * mutations and allowing navigation through history.
 *
 * @module devtools/recorder
 */

import type { Recorder, RecorderState, HistoryEntry, StateDiff } from './types.js';

/**
 * Default maximum history size
 */
const DEFAULT_MAX_HISTORY = 1000;

/**
 * Generate unique ID
 */
let nextEntryId = 0;
const generateEntryId = (): string => `entry-${++nextEntryId}`;

/**
 * Get call stack trace
 */
function getStackTrace(): string {
  const stack = new Error().stack;
  if (!stack) return '';
  return stack.split('\n').slice(3).join('\n');
}

/**
 * Deep clone value
 */
function deepClone(value: any): any {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/**
 * Recorder implementation
 */
export class RecorderImpl implements Recorder {
  private isRecording = false;
  private history: HistoryEntry[] = [];
  private currentIndex = -1;
  private maxSize: number;
  private sessionStartTime = 0;

  // Snapshot storage for time-travel
  private snapshots = new Map<number, Map<string, any>>();

  // Callbacks for state restoration
  private restoreCallbacks = new Map<string, (value: any) => void>();

  constructor(maxSize = DEFAULT_MAX_HISTORY) {
    this.maxSize = maxSize;
  }

  /**
   * Start recording state changes
   */
  startRecording(): void {
    const wasRecording = this.isRecording;

    this.isRecording = true;
    // Only update session start time if not already recording
    if (!wasRecording) {
      this.sessionStartTime = Date.now();
    }
    // Always clear history on start (for clean restart)
    this.history = [];
    this.currentIndex = -1;
    this.snapshots.clear();

    // Take initial snapshot
    this.takeSnapshot();
  }

  /**
   * Stop recording
   */
  stopRecording(): void {
    this.isRecording = false;
  }

  /**
   * Record a state mutation
   */
  record(
    type: 'signal' | 'store' | 'effect',
    targetId: string,
    prevValue: any,
    newValue: any,
    description: string
  ): void {
    if (!this.isRecording) return;

    // If we're not at the end of history, truncate future entries
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }

    const entry: HistoryEntry = {
      id: generateEntryId(),
      timestamp: Date.now(),
      type,
      targetId,
      prevValue: deepClone(prevValue),
      newValue: deepClone(newValue),
      description,
      stack: getStackTrace(),
    };

    this.history.push(entry);
    this.currentIndex++;

    // Take snapshot after mutation
    this.takeSnapshot();

    // Enforce max history size
    if (this.history.length > this.maxSize) {
      const removed = this.history.shift();
      this.currentIndex--;

      // Remove old snapshots
      if (removed) {
        const index = this.history.indexOf(removed);
        this.snapshots.delete(index);
      }
    }
  }

  /**
   * Register restore callback for target
   */
  registerRestoreCallback(targetId: string, callback: (value: any) => void): void {
    this.restoreCallbacks.set(targetId, callback);
  }

  /**
   * Take snapshot of current state
   */
  private takeSnapshot(): void {
    const snapshot = new Map<string, any>();

    // Store current state for all tracked targets
    // This would be populated from the inspector
    this.snapshots.set(this.currentIndex, snapshot);
  }

  /**
   * Get history
   */
  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  /**
   * Jump to specific state in history
   */
  jumpToState(index: number): void {
    if (index < 0 || index >= this.history.length) {
      throw new Error(`Invalid history index: ${index}`);
    }

    const targetIndex = index;
    const currentIndex = this.currentIndex;

    if (targetIndex === currentIndex) return;

    // Moving backwards
    if (targetIndex < currentIndex) {
      // Restore from snapshot or replay from beginning
      this.restoreFromSnapshot(targetIndex);
    } else {
      // Moving forwards - replay mutations
      for (let i = currentIndex + 1; i <= targetIndex; i++) {
        const entry = this.history[i];
        if (entry) {
          this.applyMutation(entry, 'forward');
        }
      }
    }

    this.currentIndex = targetIndex;
  }

  /**
   * Undo last mutation
   */
  undo(): void {
    if (this.currentIndex < 0) return;

    const entry = this.history[this.currentIndex];
    if (entry) {
      this.applyMutation(entry, 'backward');
    }
    this.currentIndex--;
  }

  /**
   * Redo next mutation
   */
  redo(): void {
    if (this.currentIndex >= this.history.length - 1) return;

    this.currentIndex++;
    const entry = this.history[this.currentIndex];
    if (entry) {
      this.applyMutation(entry, 'forward');
    }
  }

  /**
   * Apply mutation in direction
   */
  private applyMutation(entry: HistoryEntry, direction: 'forward' | 'backward'): void {
    const callback = this.restoreCallbacks.get(entry.targetId);
    if (!callback) return;

    const value = direction === 'forward' ? entry.newValue : entry.prevValue;
    callback(value);
  }

  /**
   * Restore from snapshot
   */
  private restoreFromSnapshot(index: number): void {
    const snapshot = this.snapshots.get(index);
    if (!snapshot) {
      // No snapshot, replay from beginning
      this.replayFromBeginning(index);
      return;
    }

    // Restore all values from snapshot
    for (const [targetId, value] of snapshot.entries()) {
      const callback = this.restoreCallbacks.get(targetId);
      if (callback) {
        callback(value);
      }
    }
  }

  /**
   * Replay from beginning to target index
   */
  private replayFromBeginning(targetIndex: number): void {
    // Reset to initial state
    // Then replay mutations up to target index
    for (let i = 0; i <= targetIndex; i++) {
      const entry = this.history[i];
      if (entry) {
        this.applyMutation(entry, 'forward');
      }
    }
  }

  /**
   * Diff two states
   */
  diff(indexA: number, indexB: number): StateDiff {
    if (indexA < 0 || indexA >= this.history.length) {
      throw new Error(`Invalid history index A: ${indexA}`);
    }
    if (indexB < 0 || indexB >= this.history.length) {
      throw new Error(`Invalid history index B: ${indexB}`);
    }

    const entryA = this.history[indexA];
    const entryB = this.history[indexB];

    if (!entryA || !entryB) {
      throw new Error('History entries not found');
    }

    const changes: StateDiff['changes'] = [];

    // Collect all mutations between the two indices
    const start = Math.min(indexA, indexB);
    const end = Math.max(indexA, indexB);

    const mutations = this.history.slice(start, end + 1);

    // Build change list
    const seen = new Set<string>();
    for (const mutation of mutations) {
      if (seen.has(mutation.targetId)) continue;
      seen.add(mutation.targetId);

      changes.push({
        type: 'changed',
        path: mutation.targetId,
        oldValue: mutation.prevValue,
        newValue: mutation.newValue,
      });
    }

    return {
      timestampA: entryA.timestamp,
      timestampB: entryB.timestamp,
      changes,
    };
  }

  /**
   * Export session to JSON
   */
  exportSession(): string {
    const data = {
      version: '1.0.0',
      sessionStartTime: this.sessionStartTime,
      history: this.history,
      currentIndex: this.currentIndex,
    };

    return JSON.stringify(data, null, 2);
  }

  /**
   * Import session from JSON
   */
  importSession(data: string): void {
    try {
      const parsed = JSON.parse(data);

      if (!parsed.version || !parsed.history) {
        throw new Error('Invalid session data');
      }

      this.sessionStartTime = parsed.sessionStartTime || Date.now();
      this.history = parsed.history;
      this.currentIndex = parsed.currentIndex ?? -1;
      this.isRecording = false;

      // Restore to current index
      if (this.currentIndex >= 0) {
        this.jumpToState(this.currentIndex);
      }
    } catch (error) {
      throw new Error(`Failed to import session: ${error}`);
    }
  }

  /**
   * Clear history
   */
  clear(): void {
    this.history = [];
    this.currentIndex = -1;
    this.snapshots.clear();
    this.restoreCallbacks.clear();
  }

  /**
   * Get current state
   */
  getState(): RecorderState {
    return {
      isRecording: this.isRecording,
      history: [...this.history],
      currentIndex: this.currentIndex,
      maxSize: this.maxSize,
      sessionStartTime: this.sessionStartTime,
    };
  }
}

/**
 * Create recorder instance
 */
export function createRecorder(maxSize?: number): Recorder {
  return new RecorderImpl(maxSize);
}
