import { defineComponent } from '@omnitron-dev/aether';
import { inject } from '@omnitron-dev/aether/di';
import { Terminal } from './Terminal';
import { TerminalService } from '../services/terminal.service';

/**
 * Terminal View
 *
 * Main terminal view container
 */
export default defineComponent(() => {
  const terminalService = inject(TerminalService);

  const handleClear = () => {
    terminalService.clearHistory();
    terminalService.addOutput('', 'Terminal cleared');
  };

  return () => (
    <div class="view terminal-view">
      <div class="view-header">
        <h2>Terminal</h2>
        <div class="terminal-actions">
          <button class="tool-button" onClick={handleClear}>
            Clear
          </button>
          <button class="tool-button">Split</button>
          <button class="tool-button">+</button>
        </div>
      </div>

      <div class="view-content">
        <Terminal />
      </div>
    </div>
  );
});
