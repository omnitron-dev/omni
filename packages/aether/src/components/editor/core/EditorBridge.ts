/**
 * EditorBridge - Bridge between ProseMirror and Aether signals
 *
 * This class wraps ProseMirror's EditorView and syncs its state with Aether signals,
 * enabling reactive UI updates
 */

import { EditorState, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Schema } from 'prosemirror-model';
import type { EditorInstance, EditorProps, EditorSignals, JSONContent, ContentType } from './types.js';
import { ExtensionManager } from './ExtensionManager.js';
import { createEditorSignals, updateEditorSignals } from '../signals/editorSignals.js';
import { computeDerivedState } from '../signals/derivedSignals.js';
import {
  parseContent,
  serializeHTML,
  serializeJSON,
  serializeText,
  createEmptyDoc,
} from '../utils/content.js';

/**
 * EditorBridge class
 *
 * Manages the ProseMirror EditorView and syncs state with Aether signals
 */
export class EditorBridge implements EditorInstance {
  // ProseMirror internals
  public view: EditorView;
  public state: EditorState;
  public schema: Schema;

  // Aether signals
  public signals: EditorSignals;

  // Extension manager
  private extensionManager: ExtensionManager;

  // Props
  private props: EditorProps;

  // Cleanup flag
  private destroyed = false;

  constructor(container: HTMLElement, props: EditorProps) {
    this.props = props;

    // Create extension manager
    this.extensionManager = new ExtensionManager(props.extensions || []);
    this.schema = this.extensionManager.getSchema();

    // Parse initial content
    const initialDoc = props.content
      ? parseContent(props.content, this.schema, props.contentType)
      : createEmptyDoc(this.schema);

    // Create editor state
    this.state = EditorState.create({
      doc: initialDoc,
      plugins: this.extensionManager.getPlugins(),
    });

    // Create signals
    this.signals = createEditorSignals(this.state.doc, this.state.selection);

    // Update initial derived state
    this.updateSignalsFromState(this.state);

    // Set editable state from props
    if (props.editable !== undefined) {
      this.signals.isEditable.set(props.editable);
    }

    // Create editor view
    this.view = new EditorView(container, {
      state: this.state,
      dispatchTransaction: this.dispatchTransaction.bind(this),
      editable: () => this.signals.isEditable(),
      handleDOMEvents: {
        focus: this.handleFocus.bind(this),
        blur: this.handleBlur.bind(this),
      },
    });

    // Initialize extensions with editor instance
    for (const ext of this.extensionManager.getExtensions()) {
      if ('setEditor' in ext && typeof ext.setEditor === 'function') {
        ext.setEditor(this);
      }
    }

    // Handle autofocus
    if (props.autofocus) {
      this.focus(typeof props.autofocus === 'boolean' ? 'start' : props.autofocus);
    }

    // Call onCreate callback
    this.props.onCreate?.(this);
  }

  /**
   * Dispatch transaction and update signals
   */
  private dispatchTransaction(tr: Transaction): void {
    if (this.destroyed) return;

    // Apply transaction
    const newState = this.state.apply(tr);
    this.state = newState;

    // Update view
    this.view.updateState(newState);

    // Update signals if document or selection changed
    if (tr.docChanged || tr.selectionSet) {
      this.updateSignalsFromState(newState);
    }

    // Call update callbacks
    if (tr.docChanged) {
      this.props.onUpdate?.({ editor: this });
    }

    if (tr.selectionSet) {
      this.props.onSelectionUpdate?.({ editor: this });
    }

    this.props.onTransaction?.({ editor: this, transaction: tr });
  }

  /**
   * Update Aether signals from ProseMirror state
   */
  private updateSignalsFromState(state: EditorState): void {
    const derived = computeDerivedState(state);

    updateEditorSignals(this.signals, {
      doc: state.doc,
      selection: state.selection,
      ...derived,
    });
  }

  /**
   * Handle focus event
   */
  private handleFocus(view: EditorView, event: Event): boolean {
    this.signals.isFocused.set(true);
    this.props.onFocus?.({ editor: this, event: event as FocusEvent });
    return false;
  }

  /**
   * Handle blur event
   */
  private handleBlur(view: EditorView, event: Event): boolean {
    this.signals.isFocused.set(false);
    this.props.onBlur?.({ editor: this, event: event as FocusEvent });
    return false;
  }

  /**
   * Get HTML content
   */
  getHTML(): string {
    return serializeHTML(this.state.doc);
  }

  /**
   * Get JSON content
   */
  getJSON(): JSONContent {
    return serializeJSON(this.state.doc);
  }

  /**
   * Get plain text content
   */
  getText(): string {
    return serializeText(this.state.doc);
  }

  /**
   * Set content
   */
  setContent(content: string | JSONContent, type?: ContentType): void {
    const doc = parseContent(content, this.schema, type);
    const tr = this.state.tr.replaceWith(0, this.state.doc.content.size, doc.content);
    this.view.dispatch(tr);
  }

  /**
   * Clear content
   */
  clearContent(): void {
    const doc = createEmptyDoc(this.schema);
    const tr = this.state.tr.replaceWith(0, this.state.doc.content.size, doc.content);
    this.view.dispatch(tr);
  }

  /**
   * Focus the editor
   */
  focus(position?: 'start' | 'end' | number): void {
    this.view.focus();

    if (position === 'start') {
      const tr = this.state.tr.setSelection(
        this.state.selection.constructor.atStart(this.state.doc) as any
      );
      this.view.dispatch(tr);
    } else if (position === 'end') {
      const tr = this.state.tr.setSelection(
        this.state.selection.constructor.atEnd(this.state.doc) as any
      );
      this.view.dispatch(tr);
    } else if (typeof position === 'number') {
      const tr = this.state.tr.setSelection(
        this.state.selection.constructor.near(this.state.doc.resolve(position)) as any
      );
      this.view.dispatch(tr);
    }
  }

  /**
   * Blur the editor
   */
  blur(): void {
    (this.view.dom as HTMLElement).blur();
  }

  /**
   * Check if document is empty
   */
  isEmpty(): boolean {
    return this.signals.isEmpty();
  }

  /**
   * Check if editor is focused
   */
  isFocused(): boolean {
    return this.signals.isFocused();
  }

  /**
   * Check if editor is editable
   */
  isEditable(): boolean {
    return this.signals.isEditable();
  }

  /**
   * Destroy the editor
   */
  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;

    // Call extension cleanup
    for (const ext of this.extensionManager.getExtensions()) {
      if ('destroy' in ext && typeof ext.destroy === 'function') {
        ext.destroy();
      }
    }

    // Destroy extension manager
    this.extensionManager.destroy();

    // Destroy view
    this.view.destroy();

    // Call onDestroy callback
    this.props.onDestroy?.();
  }
}
