/**
 * AdvancedEditor - Main editor component
 *
 * Aether component that wraps the EditorBridge and provides a reactive editor
 */

import { defineComponent } from '../../core/component/define.js';
import { onMount, onCleanup } from '../../core/component/lifecycle.js';
import { signal } from '../../core/reactivity/signal.js';
import { EditorBridge } from './core/EditorBridge.js';
import type { EditorProps, EditorInstance } from './core/types.js';

/**
 * AdvancedEditor component
 *
 * A ProseMirror-based rich text editor with Aether signal integration
 *
 * @example
 * ```typescript
 * const MyEditor = () => {
 *   return jsx(AdvancedEditor, {
 *     content: 'Hello world',
 *     contentType: 'text',
 *     onUpdate: ({ editor }) => {
 *       console.log('Content:', editor.getText());
 *     }
 *   });
 * };
 * ```
 */
export const AdvancedEditor = defineComponent<EditorProps>((props) => {
  // Signal to hold the editor instance
  const editorInstance = signal<EditorInstance | null>(null);

  // Signal for the container element
  const container = signal<HTMLDivElement | null>(null);

  // Initialize editor on mount
  onMount(() => {
    const containerEl = container();
    if (!containerEl) {
      console.error('AdvancedEditor: Container element not found');
      return;
    }

    try {
      // Create editor bridge
      const editor = new EditorBridge(containerEl, props);
      editorInstance.set(editor);

      // Cleanup on unmount
      onCleanup(() => {
        const ed = editorInstance();
        if (ed) {
          ed.destroy();
          editorInstance.set(null);
        }
      });
    } catch (error) {
      console.error('AdvancedEditor: Failed to create editor:', error);
    }
  });

  // Render function
  return () => {
    // Create the editor container
    const editorDiv = document.createElement('div');
    editorDiv.className = props.editorClass || 'prosemirror-editor';

    // Store reference
    container.set(editorDiv);

    // Wrap in a container if class is provided
    if (props.class) {
      const wrapper = document.createElement('div');
      wrapper.className = props.class;
      wrapper.appendChild(editorDiv);
      return wrapper;
    }

    return editorDiv;
  };
}, 'AdvancedEditor');
