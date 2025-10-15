/**
 * Derived Signals - Computed values from editor state
 *
 * Provides utility functions to compute derived state from ProseMirror
 */

import type { Node as PMNode, Mark, NodeType } from 'prosemirror-model';
import type { EditorState, Selection } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';

/**
 * Check if the document is empty
 */
export function isDocumentEmpty(doc: PMNode): boolean {
  // A document is empty if it has only one child (paragraph) with no content
  if (doc.childCount === 0) return true;
  if (doc.childCount > 1) return false;

  const firstChild = doc.firstChild;
  if (!firstChild) return true;

  // Check if it's an empty text block
  return firstChild.isTextblock && firstChild.content.size === 0;
}

/**
 * Count words in the document
 */
export function countWords(doc: PMNode): number {
  const text = doc.textContent;
  if (!text || text.trim().length === 0) return 0;

  // Split by whitespace and filter empty strings
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  return words.length;
}

/**
 * Count characters in the document
 */
export function countCharacters(doc: PMNode): number {
  return doc.textContent.length;
}

/**
 * Check if undo is available
 */
export function canUndoCommand(state: EditorState): boolean {
  return undo(state);
}

/**
 * Check if redo is available
 */
export function canRedoCommand(state: EditorState): boolean {
  return redo(state);
}

/**
 * Get active marks at current selection
 */
export function getActiveMarks(state: EditorState): Mark[] {
  const { $from, empty } = state.selection;

  if (empty) {
    // For empty selections, get stored marks or marks at cursor position
    return state.storedMarks || $from.marks();
  }

  // For range selections, get marks that apply to the entire range
  const marks: Mark[] = [];
  const { from, to } = state.selection;

  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) {
      for (const mark of node.marks) {
        if (!marks.some((m) => m.eq(mark))) {
          marks.push(mark);
        }
      }
    }
  });

  return marks;
}

/**
 * Get the current node type at selection
 */
export function getCurrentNodeType(selection: Selection): NodeType | null {
  const { $from } = selection;
  const node = $from.parent;
  return node ? node.type : null;
}

/**
 * Get selected text
 */
export function getSelectedText(state: EditorState): string {
  const { from, to } = state.selection;
  if (from === to) return '';

  return state.doc.textBetween(from, to, ' ');
}

/**
 * Compute all derived values at once
 * This is more efficient than computing them separately
 */
export function computeDerivedState(state: EditorState) {
  const { doc, selection } = state;

  return {
    isEmpty: isDocumentEmpty(doc),
    wordCount: countWords(doc),
    charCount: countCharacters(doc),
    canUndo: canUndoCommand(state),
    canRedo: canRedoCommand(state),
    activeMarks: getActiveMarks(state),
    currentNodeType: getCurrentNodeType(selection),
    selectedText: getSelectedText(state),
  };
}
