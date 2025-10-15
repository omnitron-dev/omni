import { Injectable, inject } from '@omnitron-dev/aether/di';
import { TerminalService } from './terminal.service';

/**
 * Command Service
 *
 * Handles command execution and processing
 */
@Injectable({ scope: 'module' })
export class CommandService {
  private terminalService = inject(TerminalService);

  /**
   * Execute a command and update history
   */
  async execute(command: string): Promise<void> {
    if (!command.trim()) return;

    const trimmedCommand = command.trim();

    // Check for special commands
    if (trimmedCommand === 'clear') {
      this.terminalService.clearHistory();
      this.terminalService.addOutput('', 'Terminal cleared');
      return;
    }

    // Execute command and get output
    const output = this.terminalService.executeCommand(trimmedCommand);

    // Add to history
    this.terminalService.addOutput(trimmedCommand, output);
  }

  /**
   * Get command suggestions based on partial input
   */
  getSuggestions(partial: string): string[] {
    const commands = [
      'help',
      'clear',
      'pwd',
      'ls',
      'cd',
      'echo',
      'date',
      'version',
      'exit',
    ];

    return commands.filter(cmd => cmd.startsWith(partial.toLowerCase()));
  }
}
