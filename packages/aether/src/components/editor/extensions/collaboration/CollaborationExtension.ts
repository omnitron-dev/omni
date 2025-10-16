/**
 * CollaborationExtension - Y.js integration for collaborative editing
 *
 * This extension integrates Y.js (Yjs) for CRDT-based collaborative editing.
 * It uses y-prosemirror to sync ProseMirror state with a Yjs document.
 */

import type { Plugin } from 'prosemirror-state';
import * as Y from 'yjs';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin, undo, redo } from 'y-prosemirror';
import { WebsocketProvider } from 'y-websocket';
import { Extension } from '../../core/Extension.js';
import type { User } from './types.js';

export interface CollaborationOptions {
  document?: Y.Doc; // Yjs document (will be created if not provided)
  provider?: 'websocket' | 'webrtc' | 'custom'; // Provider type
  providerUrl?: string; // WebSocket URL for provider
  room?: string; // Room name for collaboration
  username?: string; // User's display name
  userColor?: string; // User's color
  showCursors?: boolean; // Show other users' cursors
  showSelections?: boolean; // Show other users' selections
  debounceMs?: number; // Debounce time for updates
  // Custom provider (when provider: 'custom')
  customProvider?: any;
}

/**
 * Collaboration extension using Y.js
 *
 * Provides CRDT-based collaborative editing with Y.js.
 * Supports multiple provider types (WebSocket, WebRTC, custom).
 *
 * @example
 * ```typescript
 * import * as Y from 'yjs';
 *
 * const ydoc = new Y.Doc();
 * const collab = new CollaborationExtension({
 *   document: ydoc,
 *   provider: 'websocket',
 *   providerUrl: 'ws://localhost:1234',
 *   room: 'my-document',
 *   username: 'Alice',
 *   userColor: '#ff0000',
 * });
 * editor.registerExtension(collab);
 * ```
 */
export class CollaborationExtension extends Extension<CollaborationOptions> {
  readonly name = 'collaboration';
  readonly type = 'behavior' as const;

  private ydoc!: Y.Doc;
  private yXmlFragment!: Y.XmlFragment;
  private provider?: WebsocketProvider | any;
  private awareness?: any;
  private initialized = false;

  protected defaultOptions(): CollaborationOptions {
    return {
      provider: 'websocket',
      showCursors: true,
      showSelections: true,
      debounceMs: 100,
      username: 'Anonymous',
      userColor: '#0066cc',
    };
  }

  /**
   * Ensure Y.js structures are initialized
   */
  private ensureInitialized(): void {
    if (this.initialized) {
      return;
    }

    // Use provided document or create new one
    this.ydoc = this.options.document || new Y.Doc();

    // Get or create XML fragment for ProseMirror content
    this.yXmlFragment = this.ydoc.getXmlFragment('prosemirror');

    this.initialized = true;
  }

  /**
   * Initialize Y.js document and provider
   */
  onCreate() {
    this.ensureInitialized();

    // Set up provider if specified
    if (this.options.provider === 'websocket' && this.options.providerUrl && this.options.room) {
      this.provider = new WebsocketProvider(this.options.providerUrl, this.options.room, this.ydoc);

      this.awareness = this.provider.awareness;

      // Set local user state
      this.awareness.setLocalState({
        user: {
          name: this.options.username,
          color: this.options.userColor,
        },
      });
    } else if (this.options.provider === 'custom' && this.options.customProvider) {
      this.provider = this.options.customProvider;
      this.awareness = this.provider.awareness;

      // Set local user state if awareness is available
      if (this.awareness) {
        this.awareness.setLocalState({
          user: {
            name: this.options.username,
            color: this.options.userColor,
          },
        });
      }
    }
  }

  /**
   * Get ProseMirror plugins
   */
  getPlugins(): Plugin[] {
    this.ensureInitialized();

    const plugins: Plugin[] = [];

    // Y.js sync plugin - syncs ProseMirror state with Yjs
    plugins.push(
      ySyncPlugin(this.yXmlFragment, {
        debounceWait: this.options.debounceMs,
      })
    );

    // Y.js cursor plugin - shows other users' cursors (handled by CollaborationCursorExtension)
    // We still include it here for awareness tracking
    if (this.awareness && (this.options.showCursors || this.options.showSelections)) {
      plugins.push(
        yCursorPlugin(this.awareness, {
          // Return null here, cursor rendering handled by CollaborationCursorExtension
          cursorBuilder: () => null as any,
          // Return null here, selection rendering handled by CollaborationCursorExtension
          selectionBuilder: () => null as any,
        })
      );
    }

    // Y.js undo plugin - replaces prosemirror-history when collaborating
    plugins.push(yUndoPlugin());

    return plugins;
  }

  /**
   * Get keyboard shortcuts
   * Override default undo/redo with Y.js versions
   */
  getKeyboardShortcuts() {
    return {
      'Mod-z': undo,
      'Mod-y': redo,
      'Shift-Mod-z': redo,
    };
  }

  /**
   * Get commands
   */
  getCommands() {
    return {
      updateUser: (name: string, color: string) => () => {
        if (this.awareness) {
          this.awareness.setLocalState({
            user: {
              name,
              color,
            },
          });
        }
        return true;
      },
      disconnect: () => () => {
        if (this.provider && typeof this.provider.disconnect === 'function') {
          this.provider.disconnect();
        }
        return true;
      },
      reconnect: () => () => {
        if (this.provider && typeof this.provider.connect === 'function') {
          this.provider.connect();
        }
        return true;
      },
    };
  }

  /**
   * Clean up on destroy
   */
  onDestroy() {
    // Disconnect provider
    if (this.provider && typeof this.provider.destroy === 'function') {
      this.provider.destroy();
    }

    // Destroy Y.js document if we created it
    if (!this.options.document && this.ydoc) {
      this.ydoc.destroy();
    }
  }

  /**
   * Get the Y.js document
   */
  getDocument(): Y.Doc {
    this.ensureInitialized();
    return this.ydoc;
  }

  /**
   * Get the Y.js XML fragment
   */
  getFragment(): Y.XmlFragment {
    this.ensureInitialized();
    return this.yXmlFragment;
  }

  /**
   * Get the provider
   */
  getProvider(): WebsocketProvider | any | undefined {
    return this.provider;
  }

  /**
   * Get awareness
   */
  getAwareness(): any | undefined {
    return this.awareness;
  }

  /**
   * Get all users (from awareness)
   */
  getUsers(): User[] {
    if (!this.awareness) {
      return [];
    }

    const users: User[] = [];
    const states = this.awareness.getStates();

    states.forEach((state: any, clientId: number) => {
      if (state.user) {
        users.push({
          id: clientId.toString(),
          name: state.user.name,
          color: state.user.color,
          cursor: state.cursor,
        });
      }
    });

    return users;
  }
}

export type { CollaborationOptions };
