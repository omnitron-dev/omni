/**
 * Editor Signals - Reactive state for the editor
 *
 * Exposes ProseMirror state as Aether signals for reactive UI updates
 */

import { signal, type WritableSignal } from '../../../core/reactivity/signal.js';
import type { Signal } from '../../../core/reactivity/types.js';
import type { Node as PMNode, Mark, NodeType } from 'prosemirror-model';
import type { Selection } from 'prosemirror-state';
import type { EditorSignals } from '../core/types.js';

/**
 * Create editor signals
 *
 * These signals are updated by the EditorBridge whenever the ProseMirror state changes
 */
export function createEditorSignals(initialDoc: PMNode, initialSelection: Selection): EditorSignals {
  // Direct state signals
  const doc = signal<PMNode>(initialDoc);
  const selection = signal<Selection>(initialSelection);
  const isFocused = signal(false);
  const isEditable = signal(true);

  // These will be computed in derivedSignals.ts
  // For now, create placeholder signals
  const isEmpty = signal(true);
  const wordCount = signal(0);
  const charCount = signal(0);
  const canUndo = signal(false);
  const canRedo = signal(false);
  const activeMarks = signal<Mark[]>([]);
  const currentNodeType = signal<NodeType | null>(null);
  const selectedText = signal('');

  return {
    doc: doc as Signal<PMNode>,
    selection: selection as Signal<Selection>,
    isFocused,
    isEditable,
    isEmpty: isEmpty as Signal<boolean>,
    wordCount: wordCount as Signal<number>,
    charCount: charCount as Signal<number>,
    canUndo: canUndo as Signal<boolean>,
    canRedo: canRedo as Signal<boolean>,
    activeMarks: activeMarks as Signal<Mark[]>,
    currentNodeType: currentNodeType as Signal<NodeType | null>,
    selectedText: selectedText as Signal<string>,
  };
}

/**
 * Update editor signals from ProseMirror state
 *
 * Called by EditorBridge on every transaction
 */
export function updateEditorSignals(
  signals: EditorSignals,
  updates: {
    doc?: PMNode;
    selection?: Selection;
    isFocused?: boolean;
    isEditable?: boolean;
    isEmpty?: boolean;
    wordCount?: number;
    charCount?: number;
    canUndo?: boolean;
    canRedo?: boolean;
    activeMarks?: Mark[];
    currentNodeType?: NodeType | null;
    selectedText?: string;
  }
): void {
  if (updates.doc !== undefined) {
    (signals.doc as WritableSignal<PMNode>).set(updates.doc);
  }
  if (updates.selection !== undefined) {
    (signals.selection as WritableSignal<Selection>).set(updates.selection);
  }
  if (updates.isFocused !== undefined) {
    signals.isFocused.set(updates.isFocused);
  }
  if (updates.isEditable !== undefined) {
    signals.isEditable.set(updates.isEditable);
  }
  if (updates.isEmpty !== undefined) {
    (signals.isEmpty as WritableSignal<boolean>).set(updates.isEmpty);
  }
  if (updates.wordCount !== undefined) {
    (signals.wordCount as WritableSignal<number>).set(updates.wordCount);
  }
  if (updates.charCount !== undefined) {
    (signals.charCount as WritableSignal<number>).set(updates.charCount);
  }
  if (updates.canUndo !== undefined) {
    (signals.canUndo as WritableSignal<boolean>).set(updates.canUndo);
  }
  if (updates.canRedo !== undefined) {
    (signals.canRedo as WritableSignal<boolean>).set(updates.canRedo);
  }
  if (updates.activeMarks !== undefined) {
    (signals.activeMarks as WritableSignal<Mark[]>).set(updates.activeMarks);
  }
  if (updates.currentNodeType !== undefined) {
    (signals.currentNodeType as WritableSignal<NodeType | null>).set(updates.currentNodeType);
  }
  if (updates.selectedText !== undefined) {
    (signals.selectedText as WritableSignal<string>).set(updates.selectedText);
  }
}
