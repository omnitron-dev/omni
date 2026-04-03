/**
 * High-performance double-ended queue (Deque) implementation
 * O(1) amortized for push/pop operations at both ends
 */
export class Deque<T> {
  private items: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(initialCapacity = 16) {
    this.items = new Array(initialCapacity);
  }

  get length(): number {
    return this.count;
  }

  push(item: T): void {
    if (this.count === this.items.length) {
      this.resize();
    }
    this.items[this.tail] = item;
    this.tail = (this.tail + 1) % this.items.length;
    this.count++;
  }

  shift(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.items[this.head];
    this.items[this.head] = undefined; // Allow GC
    this.head = (this.head + 1) % this.items.length;
    this.count--;
    return item;
  }

  unshift(item: T): void {
    if (this.count === this.items.length) {
      this.resize();
    }
    this.head = (this.head - 1 + this.items.length) % this.items.length;
    this.items[this.head] = item;
    this.count++;
  }

  clear(): void {
    this.items = new Array(16);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Find index of item in the deque
   * @returns Index or -1 if not found
   */
  indexOf(item: T): number {
    for (let i = 0; i < this.count; i++) {
      if (this.items[(this.head + i) % this.items.length] === item) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Remove items starting at index
   * @returns Array of removed items
   */
  splice(start: number, deleteCount: number): T[] {
    if (start < 0 || start >= this.count || deleteCount <= 0) {
      return [];
    }

    const removed: T[] = [];
    const actualDelete = Math.min(deleteCount, this.count - start);

    // Convert to array, splice, and rebuild
    const arr: T[] = [];
    for (let i = 0; i < this.count; i++) {
      arr.push(this.items[(this.head + i) % this.items.length] as T);
    }

    removed.push(...arr.splice(start, actualDelete));

    // Rebuild deque from array
    this.items = new Array(Math.max(16, arr.length * 2));
    this.head = 0;
    this.tail = arr.length;
    this.count = arr.length;
    for (let i = 0; i < arr.length; i++) {
      this.items[i] = arr[i];
    }

    return removed;
  }

  private resize(): void {
    const newCapacity = this.items.length * 2;
    const newItems: (T | undefined)[] = new Array(newCapacity);

    for (let i = 0; i < this.count; i++) {
      newItems[i] = this.items[(this.head + i) % this.items.length];
    }

    this.items = newItems;
    this.head = 0;
    this.tail = this.count;
  }

  /** Iterator for draining operations */
  *drain(): Generator<T> {
    while (this.count > 0) {
      yield this.shift()!;
    }
  }
}
