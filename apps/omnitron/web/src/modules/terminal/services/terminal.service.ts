import { Injectable } from '@omnitron-dev/aether/di';
import { signal } from '@omnitron-dev/aether';

export interface CommandEntry {
  id: string;
  command: string;
  output: string;
  timestamp: Date;
}

/**
 * Terminal Service
 *
 * Manages terminal state and command execution
 */
@Injectable({ scope: 'module' })
export class TerminalService {
  private commandHistory = signal<CommandEntry[]>([]);
  private cwd = signal('/home/omnitron');

  /**
   * Get command history
   */
  getCommandHistory() {
    return this.commandHistory();
  }

  /**
   * Get current working directory
   */
  getCwd() {
    return this.cwd();
  }

  /**
   * Set current working directory
   */
  setCwd(path: string) {
    this.cwd.set(path);
  }

  /**
   * Add output to history
   */
  addOutput(command: string, output: string) {
    this.commandHistory.update((history) => [
      ...history,
      {
        id: Date.now().toString(),
        command,
        output,
        timestamp: new Date(),
      },
    ]);
  }

  /**
   * Clear command history
   */
  clearHistory() {
    this.commandHistory.set([]);
  }

  /**
   * Execute a command
   */
  executeCommand(command: string): string {
    const trimmedCommand = command.trim();
    const parts = trimmedCommand.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    let output = '';

    switch (cmd) {
      case 'help':
        output = `Available commands:
  help    - Show this help message
  clear   - Clear terminal
  pwd     - Print working directory
  ls      - List files
  cd      - Change directory
  echo    - Print text
  date    - Show current date
  version - Show version info
  exit    - Close terminal`;
        break;

      case 'pwd':
        output = this.cwd();
        break;

      case 'ls':
        output = `flows/
modules/
config/
README.md
package.json`;
        break;

      case 'cd':
        if (args[0]) {
          if (args[0] === '..') {
            const path = this.cwd().split('/');
            path.pop();
            this.setCwd(path.join('/') || '/');
          } else if (args[0].startsWith('/')) {
            this.setCwd(args[0]);
          } else {
            this.setCwd(`${this.cwd()}/${args[0]}`);
          }
          output = `Changed directory to ${this.cwd()}`;
        } else {
          output = 'cd: missing operand';
        }
        break;

      case 'echo':
        output = args.join(' ');
        break;

      case 'date':
        output = new Date().toString();
        break;

      case 'version':
        output = `Omnitron Terminal v1.0.0
Aether Framework v0.1.0
Node.js v22.19.0`;
        break;

      case 'exit':
        output = 'Goodbye!';
        break;

      default:
        output = `Command not found: ${cmd}
Type 'help' for available commands`;
    }

    return output;
  }
}
