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
 * Time Travel Options
 */
export interface TimeTravelOptions {
  maxSnapshots?: number;
  maxActions?: number;
  snapshotInterval?: number;
  recordArguments?: boolean;
  recordResults?: boolean;
  recordErrors?: boolean;
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
      ...options
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
      metadata
    };

    this.snapshots.push(snapshot);
    this.addToTimeline('state', snapshot);

    // Trim old snapshots
    if (this.snapshots.length > this.options.maxSnapshots!) {
      this.snapshots.shift();
    }

    this.emit('snapshot:recorded', snapshot);
  }

  /**
   * Record an action
   */
  recordAction(
    action: string,
    args: any[],
    execute: () => any
  ): any {
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
      duration: 0
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
      const index = this.timeline.findIndex(
        event => event.id === closestSnapshot.id
      );
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
  async startReplay(
    fromTimestamp?: number,
    toTimestamp?: number,
    speed = 1
  ): Promise<void> {
    this.replaying = true;
    this.emit('replay:started');

    const events = this.timeline.filter(event => {
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
  getSnapshots(
    fromTimestamp?: number,
    toTimestamp?: number
  ): StateSnapshot[] {
    return this.snapshots.filter(snapshot => {
      if (fromTimestamp && snapshot.timestamp < fromTimestamp) return false;
      if (toTimestamp && snapshot.timestamp > toTimestamp) return false;
      return true;
    });
  }

  /**
   * Get actions in time range
   */
  getActions(
    fromTimestamp?: number,
    toTimestamp?: number
  ): ActionRecord[] {
    return this.actions.filter(action => {
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
        options: this.options
      }
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
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  private addToTimeline(type: TimelineEvent['type'], data: any): void {
    const event: TimelineEvent = {
      id: data.id || this.generateId(),
      timestamp: data.timestamp || Date.now(),
      type,
      data
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private estimateMemoryUsage(): number {
    const jsonStr = JSON.stringify({
      snapshots: this.snapshots,
      actions: this.actions,
      timeline: this.timeline
    });
    return new Blob([jsonStr]).size;
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
        return function(this: any, ...args: any[]) {
          return ttDebugger.recordAction(
            String(prop),
            args,
            () => value.apply(this, args)
          );
        };
      }

      if (options.recordGetters) {
        ttDebugger.recordAction(
          `get:${String(prop)}`,
          [],
          () => value
        );
      }

      return value;
    },

    set(obj, prop, value, receiver) {
      return ttDebugger.recordAction(
        `set:${String(prop)}`,
        [value],
        () => Reflect.set(obj, prop, value, receiver)
      );
    }
  });
}

/**
 * Decorator for time-travel debugging
 */
export function TimeTravel(options: TimeTravelOptions = {}) {
  return function(target: any, propertyKey?: string, descriptor?: PropertyDescriptor) {
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

      descriptor.value = function(...args: any[]) {
        const ttDebugger = (this as any).__debugger;
        if (!ttDebugger) {
          return originalMethod.apply(this, args);
        }

        return ttDebugger.recordAction(
          propertyKey,
          args,
          () => originalMethod.apply(this, args)
        );
      };

      return descriptor;
    }
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
  createDebugger(
    processId: string,
    options?: TimeTravelOptions
  ): TimeTravelDebugger {
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
    this.debuggers.forEach(ttDebugger => ttDebugger.startRecording());
  }

  /**
   * Stop recording for all debuggers
   */
  stopRecordingAll(): void {
    this.debuggers.forEach(ttDebugger => ttDebugger.stopRecording());
  }

  /**
   * Export all timelines
   */
  exportAll(): any[] {
    return Array.from(this.debuggers.values()).map(
      ttDebugger => ttDebugger.exportTimeline()
    );
  }

  /**
   * Get global statistics
   */
  getGlobalStats(): any {
    const stats = Array.from(this.debuggers.values()).map(
      ttDebugger => ttDebugger.getStats()
    );

    return {
      debuggerCount: this.debuggers.size,
      totalSnapshots: stats.reduce((sum, s) => sum + s.snapshotCount, 0),
      totalActions: stats.reduce((sum, s) => sum + s.actionCount, 0),
      totalMemory: stats.reduce((sum, s) => sum + s.memoryUsage, 0),
      debuggers: stats
    };
  }
}