/**
 * Vector Clock Implementation
 * Used for tracking causality in distributed systems
 */

export interface VectorClock {
  [nodeId: string]: number;
}

export class VectorClockManager {
  private clock: VectorClock;
  private readonly nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    this.clock = { [nodeId]: 0 };
  }

  /**
   * Increment the local clock
   */
  increment(): VectorClock {
    this.clock[this.nodeId] = (this.clock[this.nodeId] || 0) + 1;
    return { ...this.clock };
  }

  /**
   * Update clock with received vector clock (merge)
   */
  merge(other: VectorClock): VectorClock {
    const allNodes = new Set([...Object.keys(this.clock), ...Object.keys(other)]);

    for (const node of allNodes) {
      const localValue = this.clock[node] || 0;
      const otherValue = other[node] || 0;
      this.clock[node] = Math.max(localValue, otherValue);
    }

    // Increment local after merge
    this.clock[this.nodeId]++;
    return { ...this.clock };
  }

  /**
   * Compare two vector clocks
   * Returns: 'before' | 'after' | 'concurrent' | 'equal'
   */
  static compare(a: VectorClock, b: VectorClock): 'before' | 'after' | 'concurrent' | 'equal' {
    const allNodes = new Set([...Object.keys(a), ...Object.keys(b)]);

    let aGreater = false;
    let bGreater = false;

    for (const node of allNodes) {
      const aValue = a[node] || 0;
      const bValue = b[node] || 0;

      if (aValue > bValue) {
        aGreater = true;
      } else if (bValue > aValue) {
        bGreater = true;
      }
    }

    if (aGreater && bGreater) return 'concurrent';
    if (aGreater) return 'after';
    if (bGreater) return 'before';
    return 'equal';
  }

  /**
   * Check if clock A happened before clock B
   */
  static happenedBefore(a: VectorClock, b: VectorClock): boolean {
    return this.compare(a, b) === 'before';
  }

  /**
   * Check if clocks are concurrent
   */
  static isConcurrent(a: VectorClock, b: VectorClock): boolean {
    return this.compare(a, b) === 'concurrent';
  }

  /**
   * Get current clock snapshot
   */
  getClock(): VectorClock {
    return { ...this.clock };
  }

  /**
   * Set clock from snapshot (for testing/recovery)
   */
  setClock(clock: VectorClock): void {
    this.clock = { ...clock };
  }
}
