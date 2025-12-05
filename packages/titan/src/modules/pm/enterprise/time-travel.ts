/**
 * Time-Travel Debugging Implementation
 *
 * Provides state recording, replay, and time-travel debugging capabilities
 */

import { EventEmitter } from 'events';

/**
 * State Snapshot
 */
export interface StateSnapshot<T = any> {
  id: string;
  timestamp: number;
  processId: string;
  state: T;
  metadata: Record<string, any>;
}

/**
 * Action Record
 */
export interface ActionRecord {
  id: string;
  timestamp: number;
  processId: string;
  action: string;
  args: any[];
  result?: any;
  error?: Error;
  duration: number;
}

/**
 * Timeline Event
 */
export interface TimelineEvent {
  id: string;
  timestamp: number;
  type: 'action' | 'state' | 'message' | 'error';
  data: any;
}

/**
 * State Change
 */
export interface StateChange {
  type: 'added' | 'modified' | 'deleted';
  path: string;
  oldValue?: any;
  newValue?: any;
}

/**
 * State Diff
 */
export interface StateDiff {
  fromSnapshot: string;
  toSnapshot: string;
  fromTimestamp: number;
  toTimestamp: number;
  duration: number;
  changes: StateChange[];
}

/**
 * Snapshot Cleanup Policy
 */
export type CleanupPolicy = 'lru' | 'fifo' | 'ttl' | 'none';

/**
 * Time Travel Options
 */
export interface TimeTravelOptions {
  maxSnapshots?: number;
  maxActions?: number;
  snapshotInterval?: number;
  recordArguments?: boolean;
  recordResults?: boolean;
  recordErrors?: boolean;
  cleanupPolicy?: CleanupPolicy;
  snapshotTTL?: number; // milliseconds
}

/**
 * Time Travel Debugger
 */
export class TimeTravelDebugger extends EventEmitter {
  private snapshots: StateSnapshot[] = [];
  private actions: ActionRecord[] = [];
  private timeline: TimelineEvent[] = [];
  private currentIndex = -1;
  private recording = false;
  private replaying = false;

  constructor(
    private processId: string,
    private options: TimeTravelOptions = {}
  ) {
    super();
    this.options = {
      maxSnapshots: 100,
      maxActions: 1000,
      snapshotInterval: 10,
      recordArguments: true,
      recordResults: true,
      recordErrors: true,
      cleanupPolicy: 'lru',
      snapshotTTL: 3600000, // 1 hour default
      ...options,
    };
  }

  /**
   * Start recording
   */
  startRecording(): void {
    this.recording = true;
    this.emit('recording:started');
  }

  /**
   * Stop recording
   */
  stopRecording(): void {
    this.recording = false;
    this.emit('recording:stopped');
  }

  /**
   * Record a state snapshot
   */
  recordSnapshot<T>(state: T, metadata: Record<string, any> = {}): void {
    if (!this.recording) return;

    const snapshot: StateSnapshot<T> = {
      id: this.generateId(),
      timestamp: Date.now(),
      processId: this.processId,
      state: this.deepClone(state),
      metadata,
    };

    this.snapshots.push(snapshot);
    this.addToTimeline('state', snapshot);

    // Apply cleanup policy
    this.applyCleanupPolicy();

    this.emit('snapshot:recorded', snapshot);
  }

  /**
   * Record an action
   */
  recordAction(action: string, args: any[], execute: () => any): any {
    if (!this.recording) {
      return execute();
    }

    const startTime = Date.now();
    const record: ActionRecord = {
      id: this.generateId(),
      timestamp: startTime,
      processId: this.processId,
      action,
      args: this.options.recordArguments ? this.deepClone(args) : [],
      duration: 0,
    };

    try {
      const result = execute();

      record.duration = Date.now() - startTime;
      if (this.options.recordResults) {
        record.result = this.deepClone(result);
      }

      this.actions.push(record);
      this.addToTimeline('action', record);

      // Trim old actions
      if (this.actions.length > this.options.maxActions!) {
        this.actions.shift();
      }

      this.emit('action:recorded', record);
      return result;
    } catch (error) {
      record.duration = Date.now() - startTime;
      if (this.options.recordErrors) {
        record.error = error as Error;
      }

      this.actions.push(record);
      this.addToTimeline('error', { ...record, error });

      this.emit('action:error', record);
      throw error;
    }
  }

  /**
   * Travel to a specific point in time
   */
  travelTo(timestamp: number): StateSnapshot | undefined {
    // Find the closest snapshot before the timestamp
    let closestSnapshot: StateSnapshot | undefined;

    for (const snapshot of this.snapshots) {
      if (snapshot.timestamp <= timestamp) {
        closestSnapshot = snapshot;
      } else {
        break;
      }
    }

    if (closestSnapshot) {
      // Find index in timeline
      const index = this.timeline.findIndex((event) => event.id === closestSnapshot.id);
      if (index !== -1) {
        this.currentIndex = index;
      }

      this.emit('travel:to', closestSnapshot);
      return closestSnapshot;
    }

    return undefined;
  }

  /**
   * Step forward in timeline
   */
  stepForward(): TimelineEvent | undefined {
    if (this.currentIndex < this.timeline.length - 1) {
      this.currentIndex++;
      const event = this.timeline[this.currentIndex];
      this.emit('step:forward', event);
      return event;
    }
    return undefined;
  }

  /**
   * Step backward in timeline
   */
  stepBackward(): TimelineEvent | undefined {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      const event = this.timeline[this.currentIndex];
      this.emit('step:backward', event);
      return event;
    }
    return undefined;
  }

  /**
   * Jump to start
   */
  jumpToStart(): void {
    this.currentIndex = 0;
    if (this.timeline.length > 0) {
      this.emit('jump:start', this.timeline[0]);
    }
  }

  /**
   * Jump to end
   */
  jumpToEnd(): void {
    this.currentIndex = this.timeline.length - 1;
    if (this.timeline.length > 0) {
      this.emit('jump:end', this.timeline[this.currentIndex]);
    }
  }

  /**
   * Start replay
   */
  async startReplay(fromTimestamp?: number, toTimestamp?: number, speed = 1): Promise<void> {
    this.replaying = true;
    this.emit('replay:started');

    const events = this.timeline.filter((event) => {
      if (fromTimestamp && event.timestamp < fromTimestamp) return false;
      if (toTimestamp && event.timestamp > toTimestamp) return false;
      return true;
    });

    for (const event of events) {
      if (!this.replaying) break;

      this.emit('replay:event', event);

      // Wait based on speed
      const eventIndex = events.indexOf(event);
      if (eventIndex < events.length - 1) {
        const nextEvent = events[eventIndex + 1];
        if (nextEvent) {
          const delay = (nextEvent.timestamp - event.timestamp) / speed;
          await this.delay(delay);
        }
      }
    }

    this.replaying = false;
    this.emit('replay:completed');
  }

  /**
   * Stop replay
   */
  stopReplay(): void {
    this.replaying = false;
    this.emit('replay:stopped');
  }

  /**
   * Get snapshots in time range
   */
  getSnapshots(fromTimestamp?: number, toTimestamp?: number): StateSnapshot[] {
    return this.snapshots.filter((snapshot) => {
      if (fromTimestamp && snapshot.timestamp < fromTimestamp) return false;
      if (toTimestamp && snapshot.timestamp > toTimestamp) return false;
      return true;
    });
  }

  /**
   * Get actions in time range
   */
  getActions(fromTimestamp?: number, toTimestamp?: number): ActionRecord[] {
    return this.actions.filter((action) => {
      if (fromTimestamp && action.timestamp < fromTimestamp) return false;
      if (toTimestamp && action.timestamp > toTimestamp) return false;
      return true;
    });
  }

  /**
   * Export timeline data
   */
  exportTimeline(): any {
    return {
      processId: this.processId,
      snapshots: this.snapshots,
      actions: this.actions,
      timeline: this.timeline,
      metadata: {
        recordedAt: Date.now(),
        options: this.options,
      },
    };
  }

  /**
   * Import timeline data
   */
  importTimeline(data: any): void {
    this.snapshots = data.snapshots || [];
    this.actions = data.actions || [];
    this.timeline = data.timeline || [];
    this.currentIndex = -1;
    this.emit('timeline:imported', data);
  }

  /**
   * Clear all recorded data
   */
  clear(): void {
    this.snapshots = [];
    this.actions = [];
    this.timeline = [];
    this.currentIndex = -1;
    this.emit('cleared');
  }

  /**
   * Get statistics
   */
  getStats(): any {
    return {
      snapshotCount: this.snapshots.length,
      actionCount: this.actions.length,
      timelineLength: this.timeline.length,
      currentIndex: this.currentIndex,
      recording: this.recording,
      replaying: this.replaying,
      memoryUsage: this.estimateMemoryUsage(),
      options: this.options,
    };
  }

  /**
   * Compare two snapshots and generate a diff
   */
  diffSnapshots(snapshot1Id: string, snapshot2Id: string): StateDiff | null {
    const snap1 = this.snapshots.find((s) => s.id === snapshot1Id);
    const snap2 = this.snapshots.find((s) => s.id === snapshot2Id);

    if (!snap1 || !snap2) {
      return null;
    }

    const diff = this.computeDiff(snap1.state, snap2.state);

    return {
      fromSnapshot: snapshot1Id,
      toSnapshot: snapshot2Id,
      fromTimestamp: snap1.timestamp,
      toTimestamp: snap2.timestamp,
      duration: snap2.timestamp - snap1.timestamp,
      changes: diff,
    };
  }

  /**
   * Get diff between current state and a snapshot
   */
  diffFromSnapshot<T>(snapshotId: string, currentState: T): StateDiff | null {
    const snapshot = this.snapshots.find((s) => s.id === snapshotId);

    if (!snapshot) {
      return null;
    }

    const diff = this.computeDiff(snapshot.state, currentState);

    return {
      fromSnapshot: snapshotId,
      toSnapshot: 'current',
      fromTimestamp: snapshot.timestamp,
      toTimestamp: Date.now(),
      duration: Date.now() - snapshot.timestamp,
      changes: diff,
    };
  }

  /**
   * Visualize state diff
   */
  visualizeDiff(diff: StateDiff): string {
    const lines: string[] = [];
    lines.push(`Diff from ${diff.fromSnapshot} to ${diff.toSnapshot}`);
    lines.push(`Duration: ${diff.duration}ms`);
    lines.push('');

    for (const change of diff.changes) {
      switch (change.type) {
        case 'added':
          lines.push(`+ ${change.path}: ${JSON.stringify(change.newValue)}`);
          break;
        case 'modified':
          lines.push(`~ ${change.path}:`);
          lines.push(`  - ${JSON.stringify(change.oldValue)}`);
          lines.push(`  + ${JSON.stringify(change.newValue)}`);
          break;
        case 'deleted':
          lines.push(`- ${change.path}: ${JSON.stringify(change.oldValue)}`);
          break;
      }
    }

    return lines.join('\n');
  }

  /**
   * Clean up old snapshots based on TTL
   */
  cleanupByTTL(): number {
    const now = Date.now();
    const ttl = this.options.snapshotTTL!;
    const before = this.snapshots.length;

    this.snapshots = this.snapshots.filter((snapshot) => now - snapshot.timestamp <= ttl);

    const removed = before - this.snapshots.length;
    if (removed > 0) {
      this.emit('snapshots:cleaned', { removed, policy: 'ttl' });
    }

    return removed;
  }

  /**
   * Get snapshot by ID
   */
  getSnapshot(snapshotId: string): StateSnapshot | undefined {
    return this.snapshots.find((s) => s.id === snapshotId);
  }

  /**
   * Get action by ID
   */
  getAction(actionId: string): ActionRecord | undefined {
    return this.actions.find((a) => a.id === actionId);
  }

  /**
   * Get timeline event by ID
   */
  getTimelineEvent(eventId: string): TimelineEvent | undefined {
    return this.timeline.find((e) => e.id === eventId);
  }

  private addToTimeline(type: TimelineEvent['type'], data: any): void {
    const event: TimelineEvent = {
      id: data.id || this.generateId(),
      timestamp: data.timestamp || Date.now(),
      type,
      data,
    };

    this.timeline.push(event);

    // Keep timeline bounded
    const maxTimeline = (this.options.maxSnapshots! + this.options.maxActions!) * 2;
    if (this.timeline.length > maxTimeline) {
      this.timeline.shift();
      if (this.currentIndex > 0) {
        this.currentIndex--;
      }
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private deepClone<T>(obj: T): T {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      // Fallback for non-serializable objects
      return obj;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private estimateMemoryUsage(): number {
    const jsonStr = JSON.stringify({
      snapshots: this.snapshots,
      actions: this.actions,
      timeline: this.timeline,
    });
    // Estimate based on character count (UTF-8 encoding)
    return Buffer.byteLength(jsonStr, 'utf8');
  }

  private applyCleanupPolicy(): void {
    const policy = this.options.cleanupPolicy!;

    switch (policy) {
      case 'lru':
        // Keep most recently accessed (in this case, most recent)
        if (this.snapshots.length > this.options.maxSnapshots!) {
          this.snapshots.shift();
        }
        break;

      case 'fifo':
        // First in, first out - same as LRU in this context
        if (this.snapshots.length > this.options.maxSnapshots!) {
          this.snapshots.shift();
        }
        break;

      case 'ttl':
        // Time-to-live based cleanup
        this.cleanupByTTL();
        break;

      case 'none':
        // No cleanup
        break;
    }
  }

  private computeDiff(oldState: any, newState: any, path = ''): StateChange[] {
    const changes: StateChange[] = [];

    // Handle null/undefined
    if (oldState === null || oldState === undefined) {
      if (newState !== null && newState !== undefined) {
        changes.push({
          type: 'added',
          path: path || 'root',
          newValue: newState,
        });
      }
      return changes;
    }

    if (newState === null || newState === undefined) {
      changes.push({
        type: 'deleted',
        path: path || 'root',
        oldValue: oldState,
      });
      return changes;
    }

    // Handle primitives
    if (typeof oldState !== 'object' || typeof newState !== 'object') {
      if (oldState !== newState) {
        changes.push({
          type: 'modified',
          path: path || 'root',
          oldValue: oldState,
          newValue: newState,
        });
      }
      return changes;
    }

    // Handle arrays
    if (Array.isArray(oldState) || Array.isArray(newState)) {
      if (JSON.stringify(oldState) !== JSON.stringify(newState)) {
        changes.push({
          type: 'modified',
          path: path || 'root',
          oldValue: oldState,
          newValue: newState,
        });
      }
      return changes;
    }

    // Handle objects
    const allKeys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);

    for (const key of allKeys) {
      const newPath = path ? `${path}.${key}` : key;
      const oldValue = oldState[key];
      const newValue = newState[key];

      if (!(key in oldState)) {
        changes.push({
          type: 'added',
          path: newPath,
          newValue,
        });
      } else if (!(key in newState)) {
        changes.push({
          type: 'deleted',
          path: newPath,
          oldValue,
        });
      } else if (typeof oldValue === 'object' && typeof newValue === 'object') {
        changes.push(...this.computeDiff(oldValue, newValue, newPath));
      } else if (oldValue !== newValue) {
        changes.push({
          type: 'modified',
          path: newPath,
          oldValue,
          newValue,
        });
      }
    }

    return changes;
  }
}

/**
 * Time Travel Proxy
 * Automatically records all method calls on a target object
 */
export function createTimeTravelProxy<T extends object>(
  target: T,
  ttDebugger: TimeTravelDebugger,
  options: { recordGetters?: boolean } = {}
): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);

      if (typeof value === 'function') {
        return function (this: any, ...args: any[]) {
          return ttDebugger.recordAction(String(prop), args, () => value.apply(this, args));
        };
      }

      if (options.recordGetters) {
        ttDebugger.recordAction(`get:${String(prop)}`, [], () => value);
      }

      return value;
    },

    set(obj, prop, value, receiver) {
      return ttDebugger.recordAction(`set:${String(prop)}`, [value], () => Reflect.set(obj, prop, value, receiver));
    },
  });
}

/**
 * Decorator for time-travel debugging
 */
export function TimeTravel(options: TimeTravelOptions = {}) {
  return function timeTravelDecorator(target: any, propertyKey?: string, descriptor?: PropertyDescriptor) {
    // Class decorator
    if (!propertyKey) {
      const originalConstructor = target;

      function newConstructor(...args: any[]) {
        const instance = new originalConstructor(...args);
        const ttDebugger = new TimeTravelDebugger(instance.constructor.name, options);
        ttDebugger.startRecording();
        (instance as any).__debugger = ttDebugger;
        return createTimeTravelProxy(instance, ttDebugger);
      }

      newConstructor.prototype = originalConstructor.prototype;
      return newConstructor as any;
    }

    // Method decorator
    if (descriptor) {
      const originalMethod = descriptor.value;

      descriptor.value = function (...args: any[]) {
        const ttDebugger = (this as any).__debugger;
        if (!ttDebugger) {
          return originalMethod.apply(this, args);
        }

        return ttDebugger.recordAction(propertyKey, args, () => originalMethod.apply(this, args));
      };

      return descriptor;
    }

    // Property decorator (no-op for now)
    return target;
  };
}

/**
 * Time Travel Manager
 * Manages multiple debuggers across processes
 */
export class TimeTravelManager {
  private debuggers = new Map<string, TimeTravelDebugger>();

  /**
   * Create a debugger for a process
   */
  createDebugger(processId: string, options?: TimeTravelOptions): TimeTravelDebugger {
    const ttDebugger = new TimeTravelDebugger(processId, options);
    this.debuggers.set(processId, ttDebugger);
    return ttDebugger;
  }

  /**
   * Get debugger for process
   */
  getDebugger(processId: string): TimeTravelDebugger | undefined {
    return this.debuggers.get(processId);
  }

  /**
   * Remove debugger
   */
  removeDebugger(processId: string): void {
    this.debuggers.delete(processId);
  }

  /**
   * Start recording for all debuggers
   */
  startRecordingAll(): void {
    this.debuggers.forEach((ttDebugger) => ttDebugger.startRecording());
  }

  /**
   * Stop recording for all debuggers
   */
  stopRecordingAll(): void {
    this.debuggers.forEach((ttDebugger) => ttDebugger.stopRecording());
  }

  /**
   * Export all timelines
   */
  exportAll(): any[] {
    return Array.from(this.debuggers.values()).map((ttDebugger) => ttDebugger.exportTimeline());
  }

  /**
   * Get global statistics
   */
  getGlobalStats(): any {
    const stats = Array.from(this.debuggers.values()).map((ttDebugger) => ttDebugger.getStats());

    return {
      debuggerCount: this.debuggers.size,
      totalSnapshots: stats.reduce((sum, s) => sum + s.snapshotCount, 0),
      totalActions: stats.reduce((sum, s) => sum + s.actionCount, 0),
      totalMemory: stats.reduce((sum, s) => sum + s.memoryUsage, 0),
      debuggers: stats,
    };
  }
}
