import { Injectable } from '@omnitron-dev/aether/di';
import { signal } from '@omnitron-dev/aether';

/**
 * History Service
 *
 * Manages command history navigation
 */
@Injectable({ scope: 'module' })
export class HistoryService {
  private history = signal<string[]>([]);
  private historyIndex = signal(-1);

  /**
   * Add command to history
   */
  addCommand(command: string) {
    if (!command.trim()) return;

    this.history.update(h => [...h, command]);
    this.historyIndex.set(-1);
  }

  /**
   * Get previous command from history
   */
  getPrevious(): string | null {
    const history = this.history();
    const currentIndex = this.historyIndex();

    if (history.length === 0) return null;

    let newIndex = currentIndex;
    if (currentIndex === -1) {
      newIndex = history.length - 1;
    } else if (currentIndex > 0) {
      newIndex = currentIndex - 1;
    }

    this.historyIndex.set(newIndex);
    return history[newIndex] || null;
  }

  /**
   * Get next command from history
   */
  getNext(): string | null {
    const history = this.history();
    const currentIndex = this.historyIndex();

    if (currentIndex === -1) return null;

    let newIndex = currentIndex + 1;
    if (newIndex >= history.length) {
      newIndex = -1;
      this.historyIndex.set(newIndex);
      return '';
    }

    this.historyIndex.set(newIndex);
    return history[newIndex];
  }

  /**
   * Reset history navigation
   */
  reset() {
    this.historyIndex.set(-1);
  }

  /**
   * Clear all history
   */
  clearHistory() {
    this.history.set([]);
    this.historyIndex.set(-1);
  }

  /**
   * Get all history
   */
  getHistory(): string[] {
    return this.history();
  }
}
