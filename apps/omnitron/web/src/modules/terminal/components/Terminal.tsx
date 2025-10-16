import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { inject } from '@omnitron-dev/aether/di';
import { For } from '@omnitron-dev/aether/control-flow';
import { TerminalService } from '../services/terminal.service';
import { CommandService } from '../services/command.service';
import { HistoryService } from '../services/history.service';

/**
 * Terminal Component
 *
 * Main terminal component with command input and output
 */
export const Terminal = defineComponent(() => {
  const terminalService = inject(TerminalService);
  const commandService = inject(CommandService);
  const historyService = inject(HistoryService);

  const currentCommand = signal('');

  onMount(() => {
    // Add welcome message
    terminalService.addOutput(
      '',
      `Omnitron Terminal v1.0.0
Type 'help' for available commands
`
    );
  });

  const executeCommand = async () => {
    const command = currentCommand();
    if (!command.trim()) return;

    // Add to history
    historyService.addCommand(command);

    // Execute command
    await commandService.execute(command);

    // Clear input
    currentCommand.set('');
    historyService.reset();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = historyService.getPrevious();
      if (prev !== null) {
        currentCommand.set(prev);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = historyService.getNext();
      if (next !== null) {
        currentCommand.set(next);
      }
    }
  };

  return () => (
    <div class="terminal-container">
      <div class="terminal-output">
        <For each={() => terminalService.getCommandHistory()}>
          {(entry) => (
            <div class="terminal-entry">
              {entry().command && (
                <div class="terminal-command">
                  <span class="prompt">{terminalService.getCwd()} $</span>
                  <span class="command-text">{entry().command}</span>
                </div>
              )}
              <div class="terminal-response">
                <pre>{entry().output}</pre>
              </div>
            </div>
          )}
        </For>
        <div class="terminal-input-line">
          <span class="prompt">{terminalService.getCwd()} $</span>
          <input
            type="text"
            class="terminal-input"
            value={currentCommand()}
            onInput={(e) => currentCommand.set(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type command..."
            autofocus
          />
          <span class="cursor">▊</span>
        </div>
      </div>
    </div>
  );
});
