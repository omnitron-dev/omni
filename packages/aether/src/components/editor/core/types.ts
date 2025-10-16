/**
 * Type definitions for the Advanced Editor
 *
 * Core types for the ProseMirror-based editor with Aether integration
 */

import type { Schema, Node as PMNode, Mark, NodeSpec, MarkSpec, NodeType } from 'prosemirror-model';
import type { EditorState, Transaction, Selection, Plugin, Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { InputRule } from 'prosemirror-inputrules';
import type { Signal, WritableSignal } from '../../../core/reactivity/types.js';

/**
 * Extension types
 */
export type ExtensionType = 'node' | 'mark' | 'behavior';

/**
 * Extension configuration options
 */
export interface ExtensionOptions {
  [key: string]: any;
}

/**
 * Schema contribution from an extension
 */
export interface SchemaContribution {
  nodes?: Record<string, NodeSpec>;
  marks?: Record<string, MarkSpec>;
}

/**
 * Base extension interface
 */
export interface IExtension<Options = any> {
  // Metadata
  readonly name: string;
  readonly type: ExtensionType;
  readonly dependencies?: string[];

  // Configuration
  configure(options: Partial<Options>): void;
  getOptions(): Options;

  // Schema contribution
  getSchema?(): SchemaContribution;

  // Plugin contribution
  getPlugins?(): Plugin[];

  // Input rules (schema passed to avoid needing this.editor before initialization)
  getInputRules?(schema: Schema): InputRule[];

  // Keyboard shortcuts
  getKeyboardShortcuts?(): Record<string, Command>;

  // Lifecycle
  onCreate?(instance: EditorInstance): void;
  onDestroy?(): void;
}

/**
 * Editor instance signals
 */
export interface EditorSignals {
  // Document state
  doc: Signal<PMNode>;
  selection: Signal<Selection>;

  // Editor state
  isFocused: WritableSignal<boolean>;
  isEditable: WritableSignal<boolean>;

  // Derived state
  isEmpty: Signal<boolean>;
  wordCount: Signal<number>;
  charCount: Signal<number>;
  canUndo: Signal<boolean>;
  canRedo: Signal<boolean>;

  // Active formatting
  activeMarks: Signal<Mark[]>;
  currentNodeType: Signal<NodeType | null>;

  // Selection state
  selectedText: Signal<string>;
}

/**
 * Content types
 */
export type ContentType = 'html' | 'json' | 'text' | 'markdown';

/**
 * JSON content structure
 */
export interface JSONContent {
  type: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: Array<{
    type: string;
    attrs?: Record<string, any>;
  }>;
  text?: string;
}

/**
 * Editor instance API
 */
export interface EditorInstance {
  // ProseMirror internals
  state: EditorState;
  view: EditorView;
  schema: Schema;

  // Signals (Aether integration)
  signals: EditorSignals;

  // Commands (for toolbar integration)
  commands?: {
    execute(name: string, ...args: any[]): boolean;
    can(name: string, ...args: any[]): boolean;
    chain(): any;
  };

  // Content methods
  getHTML(): string;
  getJSON(): JSONContent;
  getText(): string;
  setContent(content: string | JSONContent, type?: ContentType): void;
  clearContent(): void;

  // Selection methods
  focus(position?: 'start' | 'end' | number): void;
  blur(): void;

  // State getters
  isEmpty(): boolean;
  isFocused(): boolean;
  isEditable(): boolean;

  // Lifecycle
  destroy(): void;
}

/**
 * Editor props
 */
export interface EditorProps {
  // Content
  content?: string | JSONContent;
  contentType?: ContentType;

  // Configuration
  extensions?: IExtension[];
  editable?: boolean;
  autofocus?: boolean | 'start' | 'end' | number;

  // Styling
  class?: string;
  editorClass?: string;

  // Events
  onCreate?: (instance: EditorInstance) => void;
  onUpdate?: (props: { editor: EditorInstance }) => void;
  onSelectionUpdate?: (props: { editor: EditorInstance }) => void;
  onTransaction?: (props: { editor: EditorInstance; transaction: Transaction }) => void;
  onFocus?: (props: { editor: EditorInstance; event: FocusEvent }) => void;
  onBlur?: (props: { editor: EditorInstance; event: FocusEvent }) => void;
  onDestroy?: () => void;
}

/**
 * Parse options
 */
export interface ParseOptions {
  preserveWhitespace?: boolean | 'full';
}

/**
 * Serialize options
 */
export interface SerializeOptions {
  pretty?: boolean;
}
