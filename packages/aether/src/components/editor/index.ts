/**
 * Advanced Editor Component
 *
 * A ProseMirror-based rich text editor with Aether signal integration
 *
 * @module components/editor
 */

// Main component
export { AdvancedEditor } from './AdvancedEditor.js';

// Core classes
export { Extension } from './core/Extension.js';
export { ExtensionManager } from './core/ExtensionManager.js';
export { SchemaBuilder } from './core/SchemaBuilder.js';
export { EditorBridge } from './core/EditorBridge.js';

// Types
export type {
  IExtension,
  ExtensionType,
  ExtensionOptions,
  SchemaContribution,
  EditorInstance,
  EditorSignals,
  EditorProps,
  ContentType,
  JSONContent,
  ParseOptions,
  SerializeOptions,
} from './core/types.js';

// Utilities
export {
  parseContent,
  serializeContent,
  serializeHTML,
  serializeJSON,
  serializeText,
  createEmptyDoc,
} from './utils/content.js';

export {
  setSelection,
  selectAll,
  selectStart,
  selectEnd,
  getSelectionStart,
  getSelectionEnd,
  isSelectionEmpty,
  getSelectionText,
  isMultiBlockSelection,
  getSelectionDepth,
} from './utils/selection.js';

export {
  canExecuteCommand,
  executeCommand,
  undoCommand,
  redoCommand,
  insertText,
  deleteSelection,
  insertNode,
  selectAllCommand,
} from './utils/commands.js';

// Signal utilities
export { createEditorSignals, updateEditorSignals } from './signals/editorSignals.js';

export {
  isDocumentEmpty,
  countWords,
  countCharacters,
  canUndoCommand,
  canRedoCommand,
  getActiveMarks,
  getCurrentNodeType,
  getSelectedText,
  computeDerivedState,
} from './signals/derivedSignals.js';

// Commands
export { CommandManager, ChainedCommands } from './commands/index.js';

// Components
export { Toolbar, ToolbarButton, getDefaultToolbarItems } from './components/index.js';
export type {
  ToolbarProps,
  ToolbarItem,
  ToolbarButtonConfig,
  ToolbarDropdown,
  ToolbarDivider,
  ToolbarGroup,
  ToolbarButtonProps,
} from './components/index.js';

// Behavior extensions
export { HistoryExtension } from './extensions/behavior/index.js';
export type { HistoryOptions } from './extensions/behavior/index.js';
