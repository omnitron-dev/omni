/**
 * Base Extension class for the Advanced Editor
 *
 * All editor extensions inherit from this base class
 */

import type { Plugin, Command } from 'prosemirror-state';
import type { InputRule } from 'prosemirror-inputrules';
import type {
  IExtension,
  ExtensionType,
  ExtensionOptions,
  SchemaContribution,
  EditorInstance,
} from './types.js';

/**
 * Abstract base class for editor extensions
 *
 * Extensions can contribute:
 * - Schema (nodes and marks)
 * - Plugins
 * - Input rules (markdown-style shortcuts)
 * - Keyboard shortcuts
 *
 * @example
 * ```typescript
 * class BoldExtension extends Extension<{ HTMLAttributes: Record<string, any> }> {
 *   get name() { return 'bold'; }
 *   get type() { return 'mark' as const; }
 *
 *   defaultOptions() {
 *     return { HTMLAttributes: {} };
 *   }
 *
 *   getSchema() {
 *     return {
 *       marks: {
 *         bold: {
 *           parseDOM: [{ tag: 'strong' }],
 *           toDOM: () => ['strong', this.options.HTMLAttributes, 0],
 *         },
 *       },
 *     };
 *   }
 * }
 * ```
 */
export abstract class Extension<Options extends ExtensionOptions = any> implements IExtension<Options> {
  /**
   * Extension name - must be unique
   */
  abstract readonly name: string;

  /**
   * Extension type
   */
  abstract readonly type: ExtensionType;

  /**
   * Extension dependencies (other extensions that must be loaded first)
   */
  get dependencies(): string[] | undefined {
    return undefined;
  }

  /**
   * Extension options
   */
  protected options: Options;

  /**
   * Reference to editor instance (set during onCreate)
   */
  protected editor?: EditorInstance;

  constructor(options?: Partial<Options>) {
    this.options = { ...this.defaultOptions(), ...options } as Options;
  }

  /**
   * Default options for this extension
   * Override this to provide defaults
   */
  protected defaultOptions(): Options {
    return {} as Options;
  }

  /**
   * Configure the extension with new options
   */
  configure(options: Partial<Options>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current options
   */
  getOptions(): Options {
    return this.options;
  }

  /**
   * Get schema contribution
   * Override to add nodes or marks to the editor schema
   */
  getSchema?(): SchemaContribution;

  /**
   * Get ProseMirror plugins
   * Override to add custom plugins
   */
  getPlugins?(): Plugin[];

  /**
   * Get input rules (e.g., markdown shortcuts)
   * Override to add custom input rules
   *
   * @example
   * ```typescript
   * getInputRules() {
 *   return [
   *     markInputRule(/\*\*([^*]+)\*\*$/, this.schema.marks.bold),
   *   ];
   * }
   * ```
   */
  getInputRules?(): InputRule[];

  /**
   * Get keyboard shortcuts
   * Override to add custom keyboard shortcuts
   *
   * @example
   * ```typescript
   * getKeyboardShortcuts() {
   *   return {
   *     'Mod-b': toggleMark(this.schema.marks.bold),
   *   };
   * }
   * ```
   */
  getKeyboardShortcuts?(): Record<string, Command>;

  /**
   * Called when the extension is created
   * Override to perform initialization
   */
  onCreate?(instance: EditorInstance): void;

  /**
   * Called when the extension is destroyed
   * Override to perform cleanup
   */
  onDestroy?(): void;

  /**
   * Store editor instance reference
   * @internal
   */
  setEditor(instance: EditorInstance): void {
    this.editor = instance;
    this.onCreate?.(instance);
  }

  /**
   * Clean up extension
   * @internal
   */
  destroy(): void {
    this.onDestroy?.();
    this.editor = undefined;
  }
}
