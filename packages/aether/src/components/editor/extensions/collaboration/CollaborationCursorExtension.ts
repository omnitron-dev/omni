/**
 * CollaborationCursorExtension - Render other users' cursors and selections
 *
 * Depends on: collaboration
 *
 * This extension renders cursors and selections for other users in a
 * collaborative editing session.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import { Extension } from '../../core/Extension.js';
import type { CollaborationExtension } from './CollaborationExtension.js';
import type { User } from './types.js';

export interface CollaborationCursorOptions {
  cursorBuilder?: (user: User) => HTMLElement;
  selectionBuilder?: (user: User) => HTMLElement;
}

/**
 * Collaboration cursor extension
 *
 * Renders cursors and selections for other users in a collaborative
 * editing session. Depends on the CollaborationExtension.
 *
 * @example
 * ```typescript
 * const cursor = new CollaborationCursorExtension({
 *   cursorBuilder: (user) => {
 *     const el = document.createElement('span');
 *     el.className = 'collaboration-cursor';
 *     el.style.borderColor = user.color;
 *     el.textContent = user.name;
 *     return el;
 *   },
 * });
 * editor.registerExtension(cursor);
 * ```
 */
export class CollaborationCursorExtension extends Extension<CollaborationCursorOptions> {
  readonly name = 'collaboration_cursor';
  readonly type = 'behavior' as const;

  get dependencies(): string[] {
    return ['collaboration'];
  }

  private collaborationExtension?: CollaborationExtension;

  protected defaultOptions(): CollaborationCursorOptions {
    return {
      cursorBuilder: this.defaultCursorBuilder.bind(this),
      selectionBuilder: this.defaultSelectionBuilder.bind(this),
    };
  }

  /**
   * Default cursor builder
   */
  private defaultCursorBuilder(user: User): HTMLElement {
    const cursor = document.createElement('span');
    cursor.className = 'collaboration-cursor';
    cursor.style.cssText = `
      position: absolute;
      border-left: 2px solid ${user.color};
      border-right: 2px solid ${user.color};
      margin-left: -1px;
      margin-right: -1px;
      pointer-events: none;
      height: 1.2em;
      z-index: 10;
    `;

    const label = document.createElement('span');
    label.className = 'collaboration-cursor-label';
    label.textContent = user.name;
    label.style.cssText = `
      position: absolute;
      top: -1.8em;
      left: -1px;
      font-size: 12px;
      background-color: ${user.color};
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;
      pointer-events: none;
    `;

    cursor.appendChild(label);
    return cursor;
  }

  /**
   * Default selection builder
   */
  private defaultSelectionBuilder(user: User): HTMLElement {
    const selection = document.createElement('span');
    selection.className = 'collaboration-selection';
    selection.style.cssText = `
      background-color: ${user.color};
      opacity: 0.3;
      pointer-events: none;
    `;
    return selection;
  }

  /**
   * Initialize and get reference to collaboration extension
   */
  onCreate() {
    // Get the collaboration extension
    if (this.editor) {
      this.collaborationExtension = this.editor.extensionManager?.getExtension<CollaborationExtension>(
        'collaboration',
      );
    }
  }

  /**
   * Get plugins
   */
  getPlugins(): Plugin[] {
    const pluginKey = new PluginKey('collaborationCursor');

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: () => this.getDecorations(null),
          apply: (tr, oldSet, oldState, newState) => {
            // Only update if awareness state changed or document changed
            if (!tr.docChanged && !tr.getMeta('awarenessUpdate')) {
              return oldSet.map(tr.mapping, tr.doc);
            }

            return this.getDecorations(newState);
          },
        },
        props: {
          decorations: (state) => pluginKey.getState(state),
        },
      }),
    ];
  }

  /**
   * Get decorations for cursors and selections
   */
  private getDecorations(state: EditorState | null): DecorationSet {
    if (!state || !this.collaborationExtension) {
      return DecorationSet.empty;
    }

    const decorations: Decoration[] = [];
    const awareness = this.collaborationExtension.getAwareness();

    if (!awareness) {
      return DecorationSet.empty;
    }

    const localClientId = awareness.clientID;
    const states = awareness.getStates();

    states.forEach((awarenessState: any, clientId: number) => {
      // Skip local user
      if (clientId === localClientId) {
        return;
      }

      const user = awarenessState.user;
      const cursor = awarenessState.cursor;

      if (!user || !cursor) {
        return;
      }

      const userObj: User = {
        id: clientId.toString(),
        name: user.name,
        color: user.color,
        cursor,
      };

      // Create cursor decoration
      if (cursor.anchor !== undefined && cursor.anchor >= 0 && cursor.anchor <= state.doc.content.size) {
        const cursorEl = this.options.cursorBuilder!(userObj);
        decorations.push(
          Decoration.widget(cursor.anchor, cursorEl, {
            side: -1,
            key: `cursor-${clientId}`,
          }),
        );
      }

      // Create selection decoration
      if (
        cursor.anchor !== undefined &&
        cursor.head !== undefined &&
        cursor.anchor !== cursor.head
      ) {
        const from = Math.min(cursor.anchor, cursor.head);
        const to = Math.max(cursor.anchor, cursor.head);

        if (from >= 0 && to <= state.doc.content.size && from < to) {
          const selectionEl = this.options.selectionBuilder!(userObj);
          decorations.push(
            Decoration.inline(from, to, {
              class: selectionEl.className,
              style: selectionEl.style.cssText,
            }),
          );
        }
      }
    });

    return DecorationSet.create(state.doc, decorations);
  }

  /**
   * Clean up
   */
  onDestroy() {
    this.collaborationExtension = undefined;
  }
}

export type { CollaborationCursorOptions };
