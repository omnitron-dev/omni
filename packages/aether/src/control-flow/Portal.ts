/**
 * Portal - Render children into a different part of the DOM
 *
 * Useful for modals, tooltips, dropdowns that need to escape parent overflow/positioning
 */

import { defineComponent } from '../core/component/define.js';
import { onCleanup } from '../core/reactivity/context.js';

export interface PortalProps {
  /**
   * Target DOM node to render into
   * @default document.body
   */
  target?: HTMLElement;

  /**
   * Children to render
   */
  children: any;
}

/**
 * Portal component
 *
 * Renders children into a target element (default: document.body)
 *
 * @example
 * ```tsx
 * <Portal>
 *   <div class="modal">Modal content</div>
 * </Portal>
 * ```
 *
 * @example
 * ```tsx
 * const modalRoot = document.getElementById('modal-root');
 * <Portal target={modalRoot}>
 *   <div class="modal">Modal content</div>
 * </Portal>
 * ```
 */
export const Portal = defineComponent<PortalProps>((props) => {
  // Container to hold portal content
  const container = document.createElement('div');
  container.className = 'aether-portal';

  // Get target (default to document.body)
  const getTarget = () => props.target || document.body;

  // Append container to target
  const target = getTarget();
  target.appendChild(container);

  // Cleanup: remove container when component unmounts
  onCleanup(() => {
    const currentTarget = getTarget();
    if (currentTarget.contains(container)) {
      currentTarget.removeChild(container);
    }
  });

  // Render function
  return () => {
    // Clear container
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Render children into container
    const children = props.children;

    if (children == null) {
      return null;
    }

    // Handle different children types
    if (Array.isArray(children)) {
      children.forEach((child) => {
        if (child instanceof Node) {
          container.appendChild(child);
        } else if (child != null) {
          container.appendChild(document.createTextNode(String(child)));
        }
      });
    } else if (children instanceof Node) {
      container.appendChild(children);
    } else if (children != null) {
      container.appendChild(document.createTextNode(String(children)));
    }

    // Return null since we're rendering elsewhere
    return null;
  };
});
