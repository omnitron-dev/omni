import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { For } from '@omnitron-dev/aether/control-flow';

/**
 * Terminal View
 *
 * Terminal emulator for command execution
 */
export default defineComponent(() => {
  const commandHistory = signal<Array<{ id: string; command: string; output: string; timestamp: Date }>>([]);
  const currentCommand = signal('');
  const cwd = signal('/home/omnitron');

  onMount(() => {
    // Add welcome message
    addOutput('', `Omnitron Terminal v1.0.0
Type 'help' for available commands
`);
  });

  const addOutput = (command: string, output: string) => {
    commandHistory.update(history => [...history, {
      id: Date.now().toString(),
      command,
      output,
      timestamp: new Date()
    }]);
  };

  const executeCommand = (command: string) => {
    if (!command.trim()) return;

    // Add command to history
    const trimmedCommand = command.trim();
    const parts = trimmedCommand.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    // Simple command simulation
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

      case 'clear':
        commandHistory.set([]);
        currentCommand.set('');
        return;

      case 'pwd':
        output = cwd();
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
            const path = cwd().split('/');
            path.pop();
            cwd.set(path.join('/') || '/');
          } else if (args[0].startsWith('/')) {
            cwd.set(args[0]);
          } else {
            cwd.set(`${cwd()}/${args[0]}`);
          }
          output = `Changed directory to ${cwd()}`;
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
        // Could navigate away or close terminal
        break;

      default:
        output = `Command not found: ${cmd}
Type 'help' for available commands`;
    }

    addOutput(trimmedCommand, output);
    currentCommand.set('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeCommand(currentCommand());
    }
  };

  return () => (
    <div class="view terminal-view">
      <div class="view-header">
        <h2>Terminal</h2>
        <div class="terminal-actions">
          <button class="tool-button" onClick={() => {
            commandHistory.set([]);
            addOutput('', 'Terminal cleared');
          }}>Clear</button>
          <button class="tool-button">Split</button>
          <button class="tool-button">+</button>
        </div>
      </div>

      <div class="view-content">
        <div class="terminal-container">
          <div class="terminal-output">
            <For each={commandHistory}>
              {(entry) => (
                <div class="terminal-entry">
                  {entry().command && (
                    <div class="terminal-command">
                      <span class="prompt">{cwd()} $</span>
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
              <span class="prompt">{cwd()} $</span>
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
      </div>
    </div>
  );
});