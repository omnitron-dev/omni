/**
 * Selection utilities - Helper functions for working with selections
 */

import type { EditorState, Transaction } from 'prosemirror-state';
import { Selection, TextSelection, AllSelection } from 'prosemirror-state';

/**
 * Set selection to a specific position or range
 */
export function setSelection(tr: Transaction, from: number, to?: number): Transaction {
  const resolvedFrom = tr.doc.resolve(from);
  const resolvedTo = to !== undefined ? tr.doc.resolve(to) : resolvedFrom;

  const selection = TextSelection.between(resolvedFrom, resolvedTo);
  return tr.setSelection(selection);
}

/**
 * Select all content in the document
 */
export function selectAll(state: EditorState): Transaction {
  return state.tr.setSelection(new AllSelection(state.doc));
}

/**
 * Move selection to the start of the document
 */
export function selectStart(state: EditorState): Transaction {
  return state.tr.setSelection(Selection.atStart(state.doc));
}

/**
 * Move selection to the end of the document
 */
export function selectEnd(state: EditorState): Transaction {
  return state.tr.setSelection(Selection.atEnd(state.doc));
}

/**
 * Get the position at the start of the current selection
 */
export function getSelectionStart(state: EditorState): number {
  return state.selection.from;
}

/**
 * Get the position at the end of the current selection
 */
export function getSelectionEnd(state: EditorState): number {
  return state.selection.to;
}

/**
 * Check if the current selection is empty (cursor)
 */
export function isSelectionEmpty(state: EditorState): boolean {
  return state.selection.empty;
}

/**
 * Get the text content of the current selection
 */
export function getSelectionText(state: EditorState): string {
  const { from, to } = state.selection;
  return state.doc.textBetween(from, to, ' ');
}

/**
 * Check if selection spans multiple blocks
 */
export function isMultiBlockSelection(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return $from.depth > 0 && $to.depth > 0 && $from.parent !== $to.parent;
}

/**
 * Get the depth of the current selection
 */
export function getSelectionDepth(state: EditorState): number {
  return state.selection.$from.depth;
}
