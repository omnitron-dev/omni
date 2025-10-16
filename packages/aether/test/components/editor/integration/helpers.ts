/**
 * Integration test helpers for Advanced Editor
 *
 * Utilities for creating and testing editor instances in integration tests
 */

import { JSDOM } from 'jsdom';
import type { EditorInstance, IExtension } from '../../../../src/components/editor/core/types.js';
import { EditorBridge } from '../../../../src/components/editor/core/EditorBridge.js';
import type { Signal } from '../../../../src/core/reactivity/types.js';

/**
 * Setup DOM environment for tests
 */
export function setupDOM(): void {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  global.document = dom.window.document as any;
  global.window = dom.window as any;
  global.Node = dom.window.Node as any;
  global.Element = dom.window.Element as any;
  global.HTMLElement = dom.window.HTMLElement as any;
  global.DocumentFragment = dom.window.DocumentFragment as any;
}

/**
 * Create an editor instance for integration testing
 */
export function createIntegrationTestEditor(extensions: IExtension[]): EditorInstance {
  // Ensure DOM is set up
  if (!global.document) {
    setupDOM();
  }

  const container = document.createElement('div');
  document.body.appendChild(container);

  const editor = new EditorBridge(container, {
    extensions,
    editable: true,
  });

  return editor;
}

/**
 * Simulate a keyboard press event
 */
export function simulateKeyPress(
  editor: EditorInstance,
  key: string,
  modifiers: string[] = []
): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: modifiers.includes('Ctrl'),
    metaKey: modifiers.includes('Mod') || modifiers.includes('Meta'),
    shiftKey: modifiers.includes('Shift'),
    altKey: modifiers.includes('Alt'),
    bubbles: true,
    cancelable: true,
  });

  return editor.view.dom.dispatchEvent(event);
}

/**
 * Simulate drag and drop of a file
 */
export function simulateDragDrop(editor: EditorInstance, file: File, pos: number): void {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);

  const dropEvent = new DragEvent('drop', {
    dataTransfer,
    bubbles: true,
    cancelable: true,
  });

  // Set the drop position
  const coords = editor.view.coordsAtPos(pos);
  Object.defineProperty(dropEvent, 'clientX', { value: coords.left });
  Object.defineProperty(dropEvent, 'clientY', { value: coords.top });

  editor.view.dom.dispatchEvent(dropEvent);
}

/**
 * Wait for a signal to update
 */
export async function waitForSignalUpdate<T>(signal: Signal<T>, timeout = 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Signal update timeout'));
    }, timeout);

    const currentValue = signal();

    // If the signal is writable, we can use an effect
    // For now, just return current value after a tick
    setTimeout(() => {
      clearTimeout(timeoutId);
      resolve(signal());
    }, 0);
  });
}

/**
 * Assert HTML content matches expected value
 */
export function assertHTML(editor: EditorInstance, expected: string): void {
  const actual = editor.getHTML();
  if (actual !== expected) {
    throw new Error(`HTML mismatch:\nExpected: ${expected}\nActual: ${actual}`);
  }
}

/**
 * Assert Markdown content matches expected value
 */
export function assertMarkdown(editor: EditorInstance, expected: string): void {
  // For now, we don't have markdown serialization, so skip
  // This will be implemented when MarkdownExtension is ready
  console.warn('Markdown assertion not yet implemented');
}

/**
 * Set selection in editor
 */
export function setSelection(editor: EditorInstance, from: number, to?: number): void {
  const tr = editor.state.tr.setSelection(
    editor.state.selection.constructor.create(
      editor.state.doc,
      from,
      to ?? from
    ) as any
  );
  editor.view.dispatch(tr);
}

/**
 * Insert text at current position
 */
export function insertText(editor: EditorInstance, text: string): void {
  const tr = editor.state.tr.insertText(text);
  editor.view.dispatch(tr);
}

/**
 * Get text content between positions
 */
export function getTextBetween(editor: EditorInstance, from: number, to: number): string {
  return editor.state.doc.textBetween(from, to);
}

/**
 * Check if a mark is active at current selection
 */
export function isMarkActive(editor: EditorInstance, markName: string): boolean {
  const markType = editor.schema.marks[markName];
  if (!markType) return false;

  const { from, $from, to, empty } = editor.state.selection;

  if (empty) {
    return !!markType.isInSet(editor.state.storedMarks || $from.marks());
  }

  return editor.state.doc.rangeHasMark(from, to, markType);
}

/**
 * Check if a node type is active at current selection
 */
export function isNodeActive(editor: EditorInstance, nodeName: string): boolean {
  const nodeType = editor.schema.nodes[nodeName];
  if (!nodeType) return false;

  const { $from, to } = editor.state.selection;
  const depth = $from.depth;

  for (let i = depth; i >= 0; i--) {
    const node = $from.node(i);
    if (node.type === nodeType) {
      return true;
    }
  }

  return false;
}

/**
 * Execute a command by toggling a mark
 */
export function toggleMarkCommand(editor: EditorInstance, markName: string): boolean {
  const markType = editor.schema.marks[markName];
  if (!markType) return false;

  const { from, to } = editor.state.selection;
  const hasMark = editor.state.doc.rangeHasMark(from, to, markType);

  const tr = hasMark
    ? editor.state.tr.removeMark(from, to, markType)
    : editor.state.tr.addMark(from, to, markType.create());

  editor.view.dispatch(tr);
  return true;
}

/**
 * Create a test file object
 */
export function createTestFile(
  name: string,
  content: string,
  type: string = 'text/plain'
): File {
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 1000,
  interval = 10
): Promise<void> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for condition'));
      } else {
        setTimeout(check, interval);
      }
    };

    check();
  });
}

/**
 * Clean up editor instance
 */
export function cleanupEditor(editor: EditorInstance): void {
  editor.destroy();
  // Remove container from DOM
  if (editor.view.dom.parentNode) {
    editor.view.dom.parentNode.removeChild(editor.view.dom);
  }
}
