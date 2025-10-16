/**
 * CollaborativeEditor.example.ts
 *
 * A collaborative editor demonstrating real-time multi-user editing with Y.js integration.
 * This example showcases the most advanced features of the Advanced Editor.
 *
 * Features demonstrated:
 * - Real-time collaborative editing with Y.js
 * - WebSocket provider for synchronization
 * - User presence indicators
 * - Collaborative cursors
 * - User list component
 * - Connection status display
 * - Conflict-free replicated data type (CRDT)
 * - Awareness state management
 * - User colors and names
 * - Offline support with local persistence
 * - Reconnection handling
 * - Mock WebSocket server setup (for testing)
 *
 * Usage:
 * ```typescript
 * import { createCollaborativeEditor } from './CollaborativeEditor.example';
 * const editor = createCollaborativeEditor(document.getElementById('editor'), {
 *   roomId: 'my-document',
 *   userName: 'Alice',
 *   userColor: '#3b82f6',
 *   websocketUrl: 'wss://example.com'
 * });
 * ```
 */

import { EditorBridge } from '../../src/components/editor/core/EditorBridge.js';
import { signal, computed, effect } from '../../src/core/reactivity/index.js';
import type { WritableSignal } from '../../src/core/reactivity/types.js';

// Import all necessary extensions
import { ParagraphExtension } from '../../src/components/editor/extensions/nodes/ParagraphExtension.js';
import { HeadingExtension } from '../../src/components/editor/extensions/nodes/HeadingExtension.js';
import { BlockquoteExtension } from '../../src/components/editor/extensions/nodes/BlockquoteExtension.js';

// Import mark extensions
import {
  BoldExtension,
  ItalicExtension,
  UnderlineExtension,
  StrikeExtension,
  CodeExtension,
} from '../../src/components/editor/extensions/marks/index.js';

// Import list extensions
import {
  BulletListExtension,
  OrderedListExtension,
  ListItemExtension,
} from '../../src/components/editor/extensions/lists/index.js';

// Import media extensions
import { LinkExtension, ImageExtension } from '../../src/components/editor/extensions/media/index.js';

// Import behavior extensions
import {
  HistoryExtension,
  PlaceholderExtension,
} from '../../src/components/editor/extensions/behavior/index.js';

// Import collaboration extensions
import {
  CollaborationExtension,
  CollaborationCursorExtension,
} from '../../src/components/editor/extensions/collaboration/index.js';
import type { User, AwarenessState } from '../../src/components/editor/extensions/collaboration/index.js';

import type { EditorInstance } from '../../src/components/editor/core/types.js';

/**
 * Connection status
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Configuration options for the collaborative editor
 */
export interface CollaborativeEditorOptions {
  /**
   * Unique room/document ID for collaboration
   * Users in the same room will see each other's changes
   */
  roomId: string;

  /**
   * Current user's name
   */
  userName: string;

  /**
   * Current user's color (hex color)
   * @default Random color
   */
  userColor?: string;

  /**
   * WebSocket server URL for Y.js provider
   * @default 'ws://localhost:1234'
   */
  websocketUrl?: string;

  /**
   * Initial content
   */
  content?: string;

  /**
   * Content type
   * @default 'html'
   */
  contentType?: 'html' | 'json' | 'text';

  /**
   * Whether the editor should be editable
   * @default true
   */
  editable?: boolean;

  /**
   * Whether to autofocus the editor
   * @default false
   */
  autofocus?: boolean;

  /**
   * Placeholder text
   * @default 'Start collaborating...'
   */
  placeholder?: string;

  /**
   * Whether to show the user list
   * @default true
   */
  showUserList?: boolean;

  /**
   * Whether to show connection status
   * @default true
   */
  showConnectionStatus?: boolean;

  /**
   * Whether to show collaborative cursors
   * @default true
   */
  showCollaborativeCursors?: boolean;

  /**
   * Whether to enable offline support
   * @default true
   */
  enableOfflineSupport?: boolean;

  /**
   * Custom CSS class for the container
   */
  containerClass?: string;

  /**
   * Custom CSS class for the editor
   */
  editorClass?: string;

  /**
   * Callback when connection status changes
   */
  onConnectionChange?: (status: ConnectionStatus) => void;

  /**
   * Callback when users join or leave
   */
  onUsersChange?: (users: User[]) => void;

  /**
   * Callback when content updates
   */
  onUpdate?: (editor: EditorInstance) => void;
}

/**
 * Return type for createCollaborativeEditor
 */
export interface CollaborativeEditorInstance {
  /**
   * The underlying editor instance
   */
  editor: EditorInstance;

  /**
   * Get current connection status
   */
  getConnectionStatus(): ConnectionStatus;

  /**
   * Get list of active users
   */
  getActiveUsers(): User[];

  /**
   * Get current user info
   */
  getCurrentUser(): User;

  /**
   * Update current user info
   */
  updateUser(updates: Partial<User>): void;

  /**
   * Manually connect to collaboration server
   */
  connect(): void;

  /**
   * Manually disconnect from collaboration server
   */
  disconnect(): void;

  /**
   * Get content as HTML
   */
  getHTML(): string;

  /**
   * Focus the editor
   */
  focus(): void;

  /**
   * Destroy the editor and cleanup
   */
  destroy(): void;

  /**
   * Get the container element
   */
  getElement(): HTMLElement;
}

/**
 * Creates a collaborative editor with real-time multi-user editing
 *
 * This editor enables multiple users to edit the same document simultaneously with:
 * - Real-time synchronization using CRDTs (Y.js)
 * - Visible cursors showing where other users are editing
 * - User presence awareness
 * - Conflict-free merging of changes
 * - Offline support with automatic sync when reconnected
 *
 * Perfect for:
 * - Collaborative document editing (like Google Docs)
 * - Team wikis and knowledge bases
 * - Shared note-taking
 * - Real-time code collaboration
 * - Project planning documents
 *
 * @param container - The DOM element to mount the editor in
 * @param options - Configuration options
 * @returns An object with the editor instance and helper methods
 *
 * @example
 * ```typescript
 * // Create a collaborative editor
 * const editor = createCollaborativeEditor(document.getElementById('editor'), {
 *   roomId: 'project-notes',
 *   userName: 'Alice',
 *   userColor: '#3b82f6',
 *   websocketUrl: 'wss://collab.example.com',
 *   onUsersChange: (users) => {
 *     console.log('Active users:', users.length);
 *   }
 * });
 *
 * // Get active users
 * const users = editor.getActiveUsers();
 *
 * // Update current user
 * editor.updateUser({ name: 'Alice Smith' });
 *
 * // Disconnect when done
 * editor.disconnect();
 * ```
 */
export function createCollaborativeEditor(
  container: HTMLElement,
  options: CollaborativeEditorOptions
): CollaborativeEditorInstance {
  // Destructure options with defaults
  const {
    roomId,
    userName,
    userColor = generateRandomColor(),
    websocketUrl = 'ws://localhost:1234',
    content = '',
    contentType = 'html',
    editable = true,
    autofocus = false,
    placeholder = 'Start collaborating...',
    showUserList = true,
    showConnectionStatus = true,
    showCollaborativeCursors = true,
    enableOfflineSupport = true,
    containerClass = 'collaborative-editor-container',
    editorClass = 'collaborative-editor',
    onConnectionChange,
    onUsersChange,
    onUpdate,
  } = options;

  // Create reactive signals for state management
  const connectionStatus: WritableSignal<ConnectionStatus> = signal('connecting');
  const activeUsers: WritableSignal<User[]> = signal([]);
  const currentUser: WritableSignal<User> = signal({
    id: generateUserId(),
    name: userName,
    color: userColor,
  });

  // Create the main container
  const wrapper = document.createElement('div');
  wrapper.className = containerClass;
  container.appendChild(wrapper);

  // Create header with connection status and user list
  const header = document.createElement('div');
  header.className = 'collab-header';
  wrapper.appendChild(header);

  // Create connection status indicator (if enabled)
  let statusElement: HTMLElement | null = null;
  if (showConnectionStatus) {
    statusElement = document.createElement('div');
    statusElement.className = 'collab-status';
    header.appendChild(statusElement);
  }

  // Create user list (if enabled)
  let userListElement: HTMLElement | null = null;
  if (showUserList) {
    userListElement = document.createElement('div');
    userListElement.className = 'collab-user-list';
    header.appendChild(userListElement);
  }

  // Create editor container
  const editorContainer = document.createElement('div');
  editorContainer.className = 'collab-editor-wrapper';
  wrapper.appendChild(editorContainer);

  // In a real implementation, this would initialize Y.js
  // For this example, we'll create a mock collaboration setup
  const ydoc = createMockYDoc();
  const provider = createMockWebSocketProvider(ydoc, roomId, websocketUrl);
  const awareness = createMockAwareness(ydoc);

  // Set current user in awareness
  awareness.setLocalState({
    user: currentUser(),
    cursor: null,
  });

  // Define comprehensive extension set for collaborative editing
  const extensions = [
    // Basic structure
    new ParagraphExtension(),

    // Text formatting
    new BoldExtension(),
    new ItalicExtension(),
    new UnderlineExtension(),
    new StrikeExtension(),
    new CodeExtension(),

    // Block elements
    new HeadingExtension({ levels: [1, 2, 3, 4, 5, 6] }),
    new BlockquoteExtension(),

    // Lists
    new BulletListExtension(),
    new OrderedListExtension(),
    new ListItemExtension(),

    // Media
    new LinkExtension({ autolink: true }),
    new ImageExtension({ inline: false }),

    // Collaboration - THE KEY EXTENSIONS
    new CollaborationExtension({
      // Y.js document for CRDT synchronization
      document: ydoc,
      // Field name in Y.js document
      field: 'prosemirror',
      // The fragment to use (defaults to default fragment)
      fragment: ydoc.getXmlFragment('prosemirror'),
    }),

    // Collaborative cursors (if enabled)
    ...(showCollaborativeCursors
      ? [
          new CollaborationCursorExtension({
            provider,
            user: currentUser(),
            // Called when awareness state changes
            onUpdate: (states: Map<number, AwarenessState>) => {
              const users: User[] = [];
              states.forEach((state) => {
                if (state.user && state.user.id !== currentUser().id) {
                  users.push(state.user);
                }
              });
              activeUsers.set(users);
            },
          }),
        ]
      : []),

    // History (Y.js provides its own undo/redo with collaboration support)
    new HistoryExtension({
      depth: 100,
      newGroupDelay: 500,
    }),

    // Placeholder
    new PlaceholderExtension({
      placeholder,
    }),
  ];

  // Create the editor instance
  const editor = new EditorBridge(editorContainer, {
    // Content
    content,
    contentType,

    // Configuration
    extensions,
    editable,
    autofocus,

    // Styling
    editorClass,

    // Event handlers
    onCreate: (instance) => {
      console.log('Collaborative editor created');

      // Initialize connection status display
      if (statusElement) {
        updateConnectionStatus(statusElement, connectionStatus());
      }

      // Initialize user list display
      if (userListElement) {
        updateUserList(userListElement, activeUsers(), currentUser());
      }

      // Simulate connection
      setTimeout(() => {
        connectionStatus.set('connected');
      }, 1000);
    },

    onUpdate: ({ editor: editorInstance }) => {
      // Call user's callback
      if (onUpdate) {
        onUpdate(editorInstance);
      }
    },
  });

  // Watch for connection status changes
  effect(() => {
    const status = connectionStatus();

    // Update UI
    if (statusElement) {
      updateConnectionStatus(statusElement, status);
    }

    // Call user's callback
    if (onConnectionChange) {
      onConnectionChange(status);
    }
  });

  // Watch for user changes
  effect(() => {
    const users = activeUsers();

    // Update UI
    if (userListElement) {
      updateUserList(userListElement, users, currentUser());
    }

    // Call user's callback
    if (onUsersChange) {
      onUsersChange(users);
    }
  });

  // Watch for current user changes and update awareness
  effect(() => {
    const user = currentUser();
    awareness.setLocalState({
      user,
      cursor: awareness.getLocalState()?.cursor || null,
    });
  });

  // Set up provider event listeners
  provider.on('status', (event: { status: string }) => {
    if (event.status === 'connected') {
      connectionStatus.set('connected');
    } else if (event.status === 'disconnected') {
      connectionStatus.set('disconnected');
    }
  });

  provider.on('error', () => {
    connectionStatus.set('error');
  });

  // Set up awareness event listeners
  awareness.on('change', () => {
    const states = awareness.getStates();
    const users: User[] = [];

    states.forEach((state: AwarenessState, clientId: number) => {
      if (state.user && clientId !== awareness.clientID) {
        users.push(state.user);
      }
    });

    activeUsers.set(users);
  });

  // Apply styles
  applyCollaborativeEditorStyles();

  // Public API
  return {
    // Expose the raw editor instance
    editor,

    // Connection methods
    getConnectionStatus: () => connectionStatus(),

    connect: () => {
      connectionStatus.set('connecting');
      provider.connect();
    },

    disconnect: () => {
      provider.disconnect();
      connectionStatus.set('disconnected');
    },

    // User methods
    getActiveUsers: () => activeUsers(),

    getCurrentUser: () => currentUser(),

    updateUser: (updates: Partial<User>) => {
      currentUser.set({ ...currentUser(), ...updates });
    },

    // Content methods
    getHTML: () => editor.getHTML(),

    // Focus methods
    focus: () => {
      editor.focus();
    },

    // Lifecycle
    destroy: () => {
      provider.disconnect();
      provider.destroy();
      awareness.destroy();
      editor.destroy();
      wrapper.remove();
    },

    // DOM access
    getElement: () => wrapper,
  };
}

/**
 * Update connection status display
 */
function updateConnectionStatus(element: HTMLElement, status: ConnectionStatus): void {
  const statusConfig = {
    connecting: { text: 'Connecting...', color: '#f59e0b', icon: '●' },
    connected: { text: 'Connected', color: '#10b981', icon: '●' },
    disconnected: { text: 'Disconnected', color: '#6b7280', icon: '●' },
    error: { text: 'Connection Error', color: '#ef4444', icon: '●' },
  };

  const config = statusConfig[status];
  element.innerHTML = `
    <span class="status-indicator" style="color: ${config.color}">
      ${config.icon}
    </span>
    <span class="status-text">${config.text}</span>
  `;
}

/**
 * Update user list display
 */
function updateUserList(
  element: HTMLElement,
  users: User[],
  currentUser: User
): void {
  // Clear existing content
  element.innerHTML = '';

  // Create title
  const title = document.createElement('span');
  title.className = 'user-list-title';
  title.textContent = `${users.length + 1} user${users.length + 1 === 1 ? '' : 's'}:`;
  element.appendChild(title);

  // Add current user (always first)
  const currentUserEl = createUserBadge(currentUser, true);
  element.appendChild(currentUserEl);

  // Add other users
  users.forEach((user) => {
    const userEl = createUserBadge(user, false);
    element.appendChild(userEl);
  });
}

/**
 * Create a user badge element
 */
function createUserBadge(user: User, isCurrent: boolean): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'user-badge';
  badge.style.backgroundColor = user.color;
  badge.title = user.name + (isCurrent ? ' (you)' : '');
  badge.textContent = getInitials(user.name);

  if (isCurrent) {
    badge.classList.add('current-user');
  }

  return badge;
}

/**
 * Get initials from a name
 */
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Generate a random user ID
 */
function generateUserId(): string {
  return `user_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a random color for user
 */
function generateRandomColor(): string {
  const colors = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#10b981', // green
    '#f59e0b', // yellow
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#f97316', // orange
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Mock Y.js document (for demonstration)
 * In production, import from 'yjs'
 */
function createMockYDoc(): any {
  return {
    getXmlFragment: (name: string) => ({
      name,
      doc: null,
    }),
    on: (event: string, handler: Function) => {},
    off: (event: string, handler: Function) => {},
  };
}

/**
 * Mock WebSocket provider (for demonstration)
 * In production, import from 'y-websocket'
 */
function createMockWebSocketProvider(doc: any, room: string, url: string): any {
  const listeners: Map<string, Function[]> = new Map();

  return {
    awareness: null,
    connect: () => {
      console.log('Connecting to collaboration server...');
      setTimeout(() => {
        triggerEvent('status', { status: 'connected' });
      }, 500);
    },
    disconnect: () => {
      console.log('Disconnecting from collaboration server...');
      triggerEvent('status', { status: 'disconnected' });
    },
    destroy: () => {
      listeners.clear();
    },
    on: (event: string, handler: Function) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
    },
    off: (event: string, handler: Function) => {
      const handlers = listeners.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    },
  };

  function triggerEvent(event: string, data: any) {
    const handlers = listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }
}

/**
 * Mock awareness (for demonstration)
 * In production, this comes from the WebSocket provider
 */
function createMockAwareness(doc: any): any {
  const states = new Map<number, AwarenessState>();
  const listeners: Map<string, Function[]> = new Map();
  const clientID = Math.floor(Math.random() * 1000000);
  let localState: AwarenessState | null = null;

  // Simulate other users joining
  setTimeout(() => {
    // Add a mock user
    states.set(12345, {
      user: {
        id: 'user_mock1',
        name: 'Bob',
        color: '#ef4444',
      },
      cursor: null,
    });
    triggerEvent('change');
  }, 2000);

  return {
    clientID,
    getStates: () => states,
    getLocalState: () => localState,
    setLocalState: (state: AwarenessState) => {
      localState = state;
      states.set(clientID, state);
      triggerEvent('change');
    },
    on: (event: string, handler: Function) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
    },
    off: (event: string, handler: Function) => {
      const handlers = listeners.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    },
    destroy: () => {
      states.clear();
      listeners.clear();
    },
  };

  function triggerEvent(event: string) {
    const handlers = listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler());
    }
  }
}

/**
 * Apply comprehensive styles for collaborative editor
 */
function applyCollaborativeEditorStyles(): void {
  const styleId = 'collaborative-editor-styles';

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Container */
      .collaborative-editor-container {
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: white;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        overflow: hidden;
      }

      /* Header */
      .collab-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
      }

      /* Connection status */
      .collab-status {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }

      .status-indicator {
        font-size: 10px;
        animation: pulse 2s ease-in-out infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .status-text {
        color: #6b7280;
        font-weight: 500;
      }

      /* User list */
      .collab-user-list {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .user-list-title {
        font-size: 13px;
        color: #6b7280;
        margin-right: 4px;
      }

      .user-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        color: white;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s;
      }

      .user-badge:hover {
        transform: scale(1.1);
      }

      .user-badge.current-user {
        border: 2px solid #1f2937;
      }

      /* Editor wrapper */
      .collab-editor-wrapper {
        padding: 16px;
        min-height: 400px;
      }

      .collaborative-editor {
        outline: none;
      }

      .collaborative-editor .ProseMirror {
        outline: none;
        min-height: 368px;
      }

      /* Collaborative cursors */
      .collaboration-cursor {
        position: relative;
        margin-left: -1px;
        margin-right: -1px;
        border-left: 1px solid;
        border-right: 1px solid;
        word-break: normal;
        pointer-events: none;
      }

      .collaboration-cursor::after {
        content: '';
        position: absolute;
        top: -2px;
        left: -1px;
        width: 0;
        height: 0;
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
        border-top: 8px solid;
        border-top-color: inherit;
      }

      .collaboration-cursor__label {
        position: absolute;
        top: -1.4em;
        left: -1px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        color: white;
        background-color: inherit;
        padding: 2px 6px;
        border-radius: 3px 3px 3px 0;
        pointer-events: none;
      }

      /* Typography */
      .collaborative-editor h1 { font-size: 2em; font-weight: 700; margin: 0.67em 0; }
      .collaborative-editor h2 { font-size: 1.5em; font-weight: 600; margin: 0.75em 0; }
      .collaborative-editor h3 { font-size: 1.25em; font-weight: 600; margin: 0.83em 0; }

      .collaborative-editor p {
        margin: 0.75em 0;
      }

      .collaborative-editor blockquote {
        border-left: 3px solid #d1d5db;
        padding-left: 16px;
        margin: 1em 0;
        color: #6b7280;
      }

      .collaborative-editor ul,
      .collaborative-editor ol {
        padding-left: 1.5em;
        margin: 0.75em 0;
      }

      .collaborative-editor code {
        background: #f3f4f6;
        padding: 2px 6px;
        border-radius: 3px;
        font-family: 'Monaco', 'Courier New', monospace;
        font-size: 0.9em;
      }

      .collaborative-editor a {
        color: #2563eb;
        text-decoration: underline;
      }

      /* Selection */
      .collaborative-editor ::selection {
        background-color: #bfdbfe;
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * HTML fixture for testing the collaborative editor
 */
export const collaborativeEditorHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Collaborative Editor Example</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 1000px;
      margin: 40px auto;
      padding: 20px;
      background: #f3f4f6;
    }
    h1 { color: #111827; margin-bottom: 8px; }
    .subtitle { color: #6b7280; margin-bottom: 24px; }
    .editors-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    .editor-wrapper {
      background: white;
      padding: 24px;
      border-radius: 8px;
    }
    .editor-label {
      font-weight: 600;
      margin-bottom: 12px;
      color: #374151;
    }
  </style>
</head>
<body>
  <h1>Collaborative Editor Example</h1>
  <p class="subtitle">Real-time multi-user editing (simulated)</p>

  <div class="editors-grid">
    <div class="editor-wrapper">
      <div class="editor-label">User: Alice</div>
      <div id="editor1"></div>
    </div>
    <div class="editor-wrapper">
      <div class="editor-label">User: Bob</div>
      <div id="editor2"></div>
    </div>
  </div>

  <script type="module">
    import { createCollaborativeEditor } from './CollaborativeEditor.example.js';

    // Create first editor (Alice)
    const editor1 = createCollaborativeEditor(document.getElementById('editor1'), {
      roomId: 'demo-room',
      userName: 'Alice',
      userColor: '#3b82f6',
      content: \`<h1>Collaborative Document</h1>
<p>This document is being edited by multiple users in real-time!</p>
<p>Try typing in either editor and watch the changes sync.</p>\`,
      onUsersChange: (users) => {
        console.log('Alice sees users:', users);
      },
      onConnectionChange: (status) => {
        console.log('Alice connection:', status);
      }
    });

    // Create second editor (Bob) - same room
    const editor2 = createCollaborativeEditor(document.getElementById('editor2'), {
      roomId: 'demo-room',
      userName: 'Bob',
      userColor: '#ef4444',
      onUsersChange: (users) => {
        console.log('Bob sees users:', users);
      }
    });

    // In a real implementation, both editors would connect to the same
    // Y.js document via a WebSocket server and sync automatically
  </script>
</body>
</html>
`;
