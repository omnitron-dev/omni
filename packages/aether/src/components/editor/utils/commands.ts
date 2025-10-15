/**
 * Command utilities - Helper functions for editor commands
 *
 * Basic command utilities for Phase 1
 * More advanced commands will be added in Phase 2 with formatting extensions
 */

import type { EditorState, Transaction, Command } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';

/**
 * Check if a command can be executed without actually executing it
 */
export function canExecuteCommand(command: Command, state: EditorState): boolean {
  // Create a no-op dispatch function that just returns true
  const canRun = command(state, undefined);
  return canRun === true;
}

/**
 * Execute a command and return the new state
 */
export function executeCommand(command: Command, state: EditorState): EditorState | null {
  let newState: EditorState | null = null;

  // Create a dispatch function that captures the transaction
  const dispatch = (tr: Transaction) => {
    newState = state.apply(tr);
  };

  // Try to execute the command
  const success = command(state, dispatch);

  // Return the new state if successful, null otherwise
  return success ? newState : null;
}

/**
 * Undo command wrapper
 */
export function undoCommand(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  return undo(state, dispatch);
}

/**
 * Redo command wrapper
 */
export function redoCommand(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  return redo(state, dispatch);
}

/**
 * Insert text at the current selection
 */
export function insertText(text: string): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const { from, to } = state.selection;
      const tr = state.tr.insertText(text, from, to);
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Delete the current selection or character before cursor
 */
export function deleteSelection(): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr.deleteSelection();
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Insert a node at the current position
 */
export function insertNode(nodeType: string, attrs?: Record<string, any>): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes[nodeType];
    if (!type) return false;

    if (dispatch) {
      const node = type.create(attrs);
      const tr = state.tr.replaceSelectionWith(node);
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Select all content
 */
export function selectAllCommand(): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const { tr } = state;
      const sel = state.selection;
      const newSel = sel.constructor.create(state.doc, 0, state.doc.content.size);
      dispatch(tr.setSelection(newSel));
    }
    return true;
  };
}
