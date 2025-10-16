/**
 * AriaLive Component
 *
 * Provides screen reader announcements for editor state changes and user actions.
 * Implements WCAG 2.1 guidelines for status messages and live regions.
 *
 * @module components/editor/accessibility
 */

import { defineComponent, signal, onMount, onCleanup, type Signal } from '../../../core/index.js';
import { jsx } from '../../../jsxruntime/runtime.js';
import type { EditorInstance } from '../core/types.js';

export interface AriaLiveProps {
  editor: Signal<EditorInstance | null>;
  maxMessages?: number;
  messageTimeout?: number;
}

export type AriaLivePoliteness = 'polite' | 'assertive';

export interface AriaLiveMessage {
  id: string;
  text: string;
  politeness: AriaLivePoliteness;
  timestamp: number;
}

export interface AriaLiveOptions {
  maxMessages?: number;
  messageTimeout?: number;
  defaultPoliteness?: AriaLivePoliteness;
}

/**
 * AriaLive component for screen reader announcements
 *
 * Features:
 * - Polite and assertive announcement modes
 * - Message queue management with auto-clearing
 * - Editor state change announcements
 * - Formatting change announcements
 * - Search result announcements
 * - Collaboration event announcements
 *
 * @example
 * ```tsx
 * <AriaLive editor={editorSignal} maxMessages={5} messageTimeout={5000} />
 * ```
 */
export const AriaLive = defineComponent<AriaLiveProps>((props) => {
  const politeMessages = signal<AriaLiveMessage[]>([]);
  const assertiveMessages = signal<AriaLiveMessage[]>([]);
  const messageCounter = signal(0);

  const maxMessages = props.maxMessages || 5;
  const messageTimeout = props.messageTimeout || 5000;

  // Add a new message to the queue
  const announce = (text: string, politeness: AriaLivePoliteness = 'polite') => {
    const id = `aria-msg-${messageCounter()}`;
    messageCounter.set(messageCounter() + 1);

    const message: AriaLiveMessage = {
      id,
      text,
      politeness,
      timestamp: Date.now(),
    };

    if (politeness === 'polite') {
      const current = politeMessages();
      politeMessages.set([...current, message]);

      // Limit queue size
      if (politeMessages().length > maxMessages) {
        politeMessages.set(politeMessages().slice(-maxMessages));
      }
    } else {
      const current = assertiveMessages();
      assertiveMessages.set([...current, message]);

      // Limit queue size
      if (assertiveMessages().length > maxMessages) {
        assertiveMessages.set(assertiveMessages().slice(-maxMessages));
      }
    }

    // Auto-clear message after timeout
    setTimeout(() => {
      clearMessage(id, politeness);
    }, messageTimeout);
  };

  // Clear a specific message
  const clearMessage = (id: string, politeness: AriaLivePoliteness) => {
    if (politeness === 'polite') {
      politeMessages.set(politeMessages().filter((m) => m.id !== id));
    } else {
      assertiveMessages.set(assertiveMessages().filter((m) => m.id !== id));
    }
  };

  // Clear all messages
  const clearAll = () => {
    politeMessages.set([]);
    assertiveMessages.set([]);
  };

  // Announce formatting changes
  const announceFormatting = (format: string, active: boolean) => {
    const action = active ? 'applied' : 'removed';
    announce(`${format} formatting ${action}`, 'polite');
  };

  // Announce editor state changes
  const announceEditorState = (state: string) => {
    announce(state, 'polite');
  };

  // Announce search results
  const announceSearchResults = (current: number, total: number) => {
    if (total === 0) {
      announce('No search results found', 'polite');
    } else {
      announce(`Search result ${current} of ${total}`, 'polite');
    }
  };

  // Announce collaboration events
  const announceCollaboration = (event: string, userName?: string) => {
    const message = userName ? `${userName} ${event}` : event;
    announce(message, 'polite');
  };

  // Announce errors
  const announceError = (error: string) => {
    announce(`Error: ${error}`, 'assertive');
  };

  // Announce success messages
  const announceSuccess = (message: string) => {
    announce(message, 'polite');
  };

  // Announce content changes
  const announceContentChange = (change: string) => {
    announce(change, 'polite');
  };

  // Announce selection changes
  const announceSelection = (text: string) => {
    if (text.length > 0) {
      const preview = text.length > 50 ? `${text.substring(0, 50)}...` : text;
      announce(`Selected: ${preview}`, 'polite');
    }
  };

  // Announce table navigation
  const announceTableNav = (row: number, col: number) => {
    announce(`Cell row ${row}, column ${col}`, 'polite');
  };

  // Announce heading navigation
  const announceHeading = (level: number, text: string) => {
    const preview = text.length > 30 ? `${text.substring(0, 30)}...` : text;
    announce(`Heading level ${level}: ${preview}`, 'polite');
  };

  // Announce list item navigation
  const announceListItem = (index: number, total: number) => {
    announce(`List item ${index} of ${total}`, 'polite');
  };

  // Announce undo/redo
  const announceUndoRedo = (action: 'undo' | 'redo') => {
    announce(`${action === 'undo' ? 'Undone' : 'Redone'} last action`, 'polite');
  };

  // Listen to editor events
  onMount(() => {
    const editor = props.editor();
    if (!editor) return;

    // Listen for selection changes
    editor.signals.selection.subscribe((selection) => {
      const text = editor.view.state.doc.textBetween(selection.from, selection.to, ' ');
      if (text && text.length > 0 && selection.from !== selection.to) {
        announceSelection(text);
      }
    });

    // Listen for content changes
    let lastDocSize = editor.view.state.doc.content.size;
    editor.signals.content.subscribe((content) => {
      const currentSize = editor.view.state.doc.content.size;
      const diff = currentSize - lastDocSize;

      if (diff > 0) {
        announceContentChange(`${diff} character${diff === 1 ? '' : 's'} added`);
      } else if (diff < 0) {
        announceContentChange(`${Math.abs(diff)} character${diff === -1 ? '' : 's'} deleted`);
      }

      lastDocSize = currentSize;
    });

    // Listen for focus changes
    editor.signals.focused.subscribe((focused) => {
      if (focused) {
        announceEditorState('Editor focused');
      }
    });

    // Expose announce methods to editor instance
    if (editor.accessibility) {
      editor.accessibility.announce = announce;
      editor.accessibility.announceFormatting = announceFormatting;
      editor.accessibility.announceSearchResults = announceSearchResults;
      editor.accessibility.announceCollaboration = announceCollaboration;
      editor.accessibility.announceError = announceError;
      editor.accessibility.announceSuccess = announceSuccess;
      editor.accessibility.announceUndoRedo = announceUndoRedo;
      editor.accessibility.announceTableNav = announceTableNav;
      editor.accessibility.announceHeading = announceHeading;
      editor.accessibility.announceListItem = announceListItem;
    }
  });

  // Cleanup on destroy
  onCleanup(() => {
    clearAll();
  });

  return () => {
    const polite = politeMessages();
    const assertive = assertiveMessages();

    return jsx('div', {
      class: 'aria-live-container',
      children: [
        // Polite announcements
        jsx('div', {
          role: 'status',
          'aria-live': 'polite',
          'aria-atomic': 'true',
          class: 'sr-only',
          children: polite.map((msg) =>
            jsx('div', {
              key: msg.id,
              children: msg.text,
            })
          ),
        }),
        // Assertive announcements
        jsx('div', {
          role: 'alert',
          'aria-live': 'assertive',
          'aria-atomic': 'true',
          class: 'sr-only',
          children: assertive.map((msg) =>
            jsx('div', {
              key: msg.id,
              children: msg.text,
            })
          ),
        }),
      ],
    }) as Node;
  };
}, 'AriaLive');

/**
 * Create an AriaLive announcer utility for standalone use
 */
export function createAriaLiveAnnouncer(options: AriaLiveOptions = {}): {
  announce: (text: string, politeness?: AriaLivePoliteness) => void;
  destroy: () => void;
} {
  const container = document.createElement('div');
  container.className = 'aria-live-announcer';
  container.style.cssText = `
    position: absolute;
    left: -10000px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  `;

  const politeRegion = document.createElement('div');
  politeRegion.setAttribute('role', 'status');
  politeRegion.setAttribute('aria-live', 'polite');
  politeRegion.setAttribute('aria-atomic', 'true');

  const assertiveRegion = document.createElement('div');
  assertiveRegion.setAttribute('role', 'alert');
  assertiveRegion.setAttribute('aria-live', 'assertive');
  assertiveRegion.setAttribute('aria-atomic', 'true');

  container.appendChild(politeRegion);
  container.appendChild(assertiveRegion);
  document.body.appendChild(container);

  const messages: AriaLiveMessage[] = [];
  let messageId = 0;

  const maxMessages = options.maxMessages || 5;
  const messageTimeout = options.messageTimeout || 5000;

  const announce = (text: string, politeness: AriaLivePoliteness = 'polite') => {
    const id = `msg-${messageId++}`;
    const message: AriaLiveMessage = {
      id,
      text,
      politeness,
      timestamp: Date.now(),
    };

    messages.push(message);

    const region = politeness === 'polite' ? politeRegion : assertiveRegion;
    const msgElement = document.createElement('div');
    msgElement.textContent = text;
    msgElement.setAttribute('data-id', id);
    region.appendChild(msgElement);

    // Clean up old messages
    while (messages.length > maxMessages) {
      const old = messages.shift();
      if (old) {
        const oldElement = region.querySelector(`[data-id="${old.id}"]`);
        if (oldElement) {
          oldElement.remove();
        }
      }
    }

    // Auto-remove after timeout
    setTimeout(() => {
      const idx = messages.findIndex((m) => m.id === id);
      if (idx !== -1) {
        messages.splice(idx, 1);
        msgElement.remove();
      }
    }, messageTimeout);
  };

  const destroy = () => {
    container.remove();
    messages.length = 0;
  };

  return { announce, destroy };
}
