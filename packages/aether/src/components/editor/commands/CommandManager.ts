import type { EditorState, Transaction, Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export class CommandManager {
  private commands: Map<string, Command> = new Map();
  private view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
  }

  /**
   * Register a named command
   */
  register(name: string, command: Command): void {
    this.commands.set(name, command);
  }

  /**
   * Execute a command by name
   */
  execute(name: string, ...args: any[]): boolean {
    const command = this.commands.get(name);
    if (!command) {
      console.warn(`Command "${name}" not found`);
      return false;
    }

    const { state, dispatch } = this.view;
    return command(state, dispatch, this.view, ...args);
  }

  /**
   * Check if a command can be executed
   */
  can(name: string, ...args: any[]): boolean {
    const command = this.commands.get(name);
    if (!command) {
      return false;
    }

    const { state } = this.view;
    // Commands return true if they can execute
    return command(state, undefined, this.view, ...args);
  }

  /**
   * Start a command chain
   */
  chain(): ChainedCommands {
    return new ChainedCommands(this.view);
  }

  /**
   * Get all registered command names
   */
  getCommandNames(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * Clear all commands
   */
  clear(): void {
    this.commands.clear();
  }
}

export class ChainedCommands {
  private commands: Array<(state: EditorState, dispatch?: (tr: Transaction) => void) => boolean> = [];
  private view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
  }

  /**
   * Add a command to the chain
   */
  private addCommand(command: Command): this {
    this.commands.push(command);
    return this;
  }

  /**
   * Execute all commands in the chain
   * Stops at the first command that returns false
   */
  run(): boolean {
    const { state, dispatch } = this.view;
    let currentState = state;
    let hasChanges = false;

    for (const command of this.commands) {
      let tr: Transaction | undefined;
      const captureDispatch = (transaction: Transaction) => {
        tr = transaction;
      };

      const result = command(currentState, captureDispatch, this.view);

      if (!result) {
        return false;
      }

      if (tr) {
        currentState = currentState.apply(tr);
        hasChanges = true;
      }
    }

    // Only dispatch if there were changes
    if (hasChanges && dispatch) {
      // Update the view state directly with the accumulated changes
      this.view.updateState(currentState);
    }

    return true;
  }

  /**
   * Check if all commands in the chain can execute
   */
  can(): boolean {
    const { state } = this.view;

    for (const command of this.commands) {
      if (!command(state, undefined, this.view)) {
        return false;
      }
    }

    return true;
  }

  // Placeholder methods for extensibility
  // These will be populated by extensions via commands

  /**
   * Add a focus command (placeholder for extension implementation)
   */
  focus(position?: 'start' | 'end' | number): this {
    // This would be implemented by a FocusExtension
    return this;
  }

  /**
   * Add a setContent command (placeholder)
   */
  setContent(content: string): this {
    // This would be implemented by extensions
    return this;
  }
}
