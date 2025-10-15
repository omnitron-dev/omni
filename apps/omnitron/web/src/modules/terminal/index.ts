/**
 * Terminal Module
 *
 * Exports for the terminal module
 */

export { TerminalModule } from './terminal.module';
export { Terminal } from './components/Terminal';
export { TerminalService } from './services/terminal.service';
export { ShellService } from './services/shell.service';
export { CommandService } from './services/command.service';
export { HistoryService } from './services/history.service';
export { useTerminalStore } from './stores/terminal.store';
export type { CommandEntry } from './services/terminal.service';
export type { ShellSession } from './services/shell.service';
