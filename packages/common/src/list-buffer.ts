// Start of Selection
/**
 * A generic ListBuffer class that implements a simple linked list structure.
 * This class allows adding elements to the end of the list and removing elements from the start.
 *
 * @template T - The type of elements stored in the buffer.
 */
export class ListBuffer<T> {
  private head: ListNode<T> | null = null;
  private tail: ListNode<T> | null = null;
  private size: number = 0;

  /**
   * Adds a new element to the end of the list.
   *
   * @param {T} value - The value to be added to the list.
   */
  push(value: T): void {
    const node: ListNode<T> = { value, next: null };
    if (!this.tail) {
      this.head = this.tail = node;
    } else {
      this.tail.next = node;
      this.tail = node;
    }
    this.size++;
  }

  /**
   * Removes and returns the first element from the list.
   *
   * @returns {T | undefined} - The value of the removed element, or undefined if the list is empty.
   */
  shift(): T | undefined {
    if (!this.head) return undefined;
    const value = this.head.value;
    this.head = this.head.next;
    if (!this.head) this.tail = null;
    this.size--;
    return value;
  }

  /**
   * Gets the current number of elements in the list.
   *
   * @returns {number} - The number of elements in the list.
   */
  get length(): number {
    return this.size;
  }

  /**
   * Clears the list.
   */
  clear(): void {
    this.head = this.tail = null;
    this.size = 0;
  }
}

/**
 * A node in the linked list.
 *
 * @template T - The type of the value stored in the node.
 */
interface ListNode<T> {
  value: T;
  next: ListNode<T> | null;
}
