import { defineModule } from '@omnitron-dev/aether/di';
import { TerminalService } from './services/terminal.service';
import { ShellService } from './services/shell.service';
import { CommandService } from './services/command.service';
import { HistoryService } from './services/history.service';

/**
 * Terminal Module
 *
 * Integrated terminal emulator module
 */
export const TerminalModule = defineModule({
  id: 'terminal',
  version: '1.0.0',

  providers: [TerminalService, ShellService, CommandService, HistoryService],

  stores: [() => import('./stores/terminal.store')],

  routes: [
    {
      path: '/terminal',
      component: () => import('./components/TerminalView'),
      meta: { title: 'Terminal - Omnitron' },
    },
  ],

  exportProviders: [TerminalService],

  exportStores: ['terminal'],

  metadata: {
    name: 'Terminal Module',
    description: 'Integrated terminal emulator',
    author: 'Omnitron Team',
  },

  optimization: {
    lazyBoundary: true,
    splitChunk: true,
  },
});
