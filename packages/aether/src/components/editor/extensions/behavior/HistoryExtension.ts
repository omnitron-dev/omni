import { history, undo, redo } from 'prosemirror-history';
import type { Plugin } from 'prosemirror-state';
import { Extension } from '../../core/Extension.js';

interface HistoryOptions {
  depth?: number; // Max undo steps (default: 100)
  newGroupDelay?: number; // Time to group changes (default: 500ms)
}

export class HistoryExtension extends Extension<HistoryOptions> {
  readonly name = 'history';
  readonly type = 'behavior' as const;

  protected defaultOptions(): HistoryOptions {
    return {
      depth: 100,
      newGroupDelay: 500,
    };
  }

  getPlugins(): Plugin[] {
    return [
      history({
        depth: this.options.depth,
        newGroupDelay: this.options.newGroupDelay,
      }),
    ];
  }

  getKeyboardShortcuts() {
    return {
      'Mod-z': (state, dispatch) => undo(state, dispatch),
      'Mod-y': (state, dispatch) => redo(state, dispatch),
      'Shift-Mod-z': (state, dispatch) => redo(state, dispatch),
    };
  }

  getCommands() {
    return {
      undo: () => (state, dispatch) => undo(state, dispatch),
      redo: () => (state, dispatch) => redo(state, dispatch),
    };
  }
}

export type { HistoryOptions };
