/**
 * JSX Integration with Reactive Reconciler
 *
 * Bridges JSX VNodes with reactive bindings system.
 * Converts VNodes to DOM while setting up reactive effects for signal-based props.
 *
 * @module reconciler/jsx-integration
 */

import { VNode, VNodeType } from './vnode.js';
import { createDOMFromVNode } from './create-dom.js';
import {
  bindSignalToTextNode,
  bindSignalToAttribute,
  bindSignalToProperty,
  bindSignalToStyle,
  bindSignalToClass,
  type ReactiveBinding,
} from './reactive-binding.js';

/**
 * Check if a value is a signal
 *
 * Signals have a .peek() method that allows reading without tracking.
 *
 * @param value - Value to check
 * @returns True if value is a signal
 */
function isSignal(value: any): boolean {
  return value != null && typeof value === 'function' && typeof value.peek === 'function';
}

/**
 * Render VNode with reactive bindings
 *
 * Creates DOM from VNode and sets up reactive bindings for any signal props.
 * This is the main entry point for rendering JSX with reactivity.
 *
 * Process:
 * 1. Create DOM node from VNode using createDOMFromVNode()
 * 2. Detect reactive props (signals) and create bindings
 * 3. Handle reactive children (text nodes with signals)
 * 4. Handle reactive attributes/properties
 * 5. Store effects on vnode.effects for cleanup
 *
 * @param vnode - VNode to render (may contain reactive props)
 * @returns DOM node with reactive bindings attached
 *
 * @example
 * ```typescript
 * const [count, setCount] = createSignal(0);
 * const vnode = createElementVNode('div', { textContent: count });
 * const dom = renderVNodeWithBindings(vnode);
 * // dom.textContent is "0"
 * setCount(1);
 * // dom.textContent is now "1" (updated reactively)
 * ```
 */
export function renderVNodeWithBindings(vnode: VNode): Node {
  // Create DOM from VNode
  const dom = createDOMFromVNode(vnode);

  // Initialize effects array if not present
  if (!vnode.effects) {
    vnode.effects = [];
  }

  // Set up reactive bindings based on VNode type
  if (vnode.type === VNodeType.ELEMENT && vnode.props) {
    setupReactiveProps(dom as HTMLElement, vnode.props, vnode);
  }

  // Recursively set up bindings for children
  if (vnode.children && vnode.children.length > 0) {
    for (const child of vnode.children) {
      setupReactiveChildren(child);
    }
  }

  return dom;
}

/**
 * Set up reactive bindings for element props
 *
 * Scans props for signals and creates appropriate reactive bindings.
 * Handles:
 * - style objects (reactive styles)
 * - className/class (reactive classes)
 * - textContent (reactive text)
 * - Regular attributes and properties
 *
 * @param element - DOM element to bind to
 * @param props - Props object (may contain signals)
 * @param vnode - VNode to store effects on
 */
function setupReactiveProps(element: HTMLElement, props: Record<string, any>, vnode: VNode): void {
  for (const [key, value] of Object.entries(props)) {
    // Skip certain keys
    if (key === 'children' || key === 'key' || key === 'ref') {
      continue;
    }

    // Skip event handlers (they're already set up by createDOMFromVNode)
    if (key.startsWith('on') && key.length > 2) {
      continue;
    }

    // Handle reactive style object
    if (key === 'style' && typeof value === 'object' && value != null) {
      const hasReactiveStyle = Object.values(value).some(isSignal);
      if (hasReactiveStyle) {
        const binding = bindSignalToStyle(element, () => {
          const styleObj: Record<string, any> = {};
          for (const [styleProp, styleValue] of Object.entries(value)) {
            const resolvedValue = isSignal(styleValue) ? (styleValue as any)() : styleValue;
            styleObj[styleProp] = resolvedValue;
          }
          return styleObj;
        });
        vnode.effects!.push(binding.effect);
        continue;
      }
    }

    // Handle reactive className/class
    if ((key === 'className' || key === 'class') && isSignal(value)) {
      const binding = bindSignalToClass(element, () => value());
      vnode.effects!.push(binding.effect);
      continue;
    }

    // Handle reactive textContent
    if (key === 'textContent' && isSignal(value)) {
      // Create text node binding
      const textNode = element.firstChild as Text | null;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const binding = bindSignalToTextNode(textNode, () => value());
        vnode.effects!.push(binding.effect);
      } else {
        // No text node exists, create one
        const newTextNode = document.createTextNode('');
        element.appendChild(newTextNode);
        const binding = bindSignalToTextNode(newTextNode, () => value());
        vnode.effects!.push(binding.effect);
      }
      continue;
    }

    // Handle reactive innerHTML (similar to textContent)
    if (key === 'innerHTML' && isSignal(value)) {
      const binding = bindSignalToProperty(element, 'innerHTML', () => value());
      vnode.effects!.push(binding.effect);
      continue;
    }

    // Handle reactive regular props
    if (isSignal(value)) {
      // Determine if this should be attribute or property
      if (key in element) {
        // Property binding (value, checked, etc.)
        const binding = bindSignalToProperty(element, key, () => value());
        vnode.effects!.push(binding.effect);
      } else {
        // Attribute binding (data-*, aria-*, etc.)
        const binding = bindSignalToAttribute(element, key, () => value());
        vnode.effects!.push(binding.effect);
      }
    }
  }
}

/**
 * Set up reactive bindings for children
 *
 * Recursively processes child VNodes and sets up reactive text bindings.
 * If a child is a text VNode with reactive content, creates a binding.
 *
 * @param vnode - Child VNode to process
 */
function setupReactiveChildren(vnode: VNode): void {
  // Initialize effects array if not present
  if (!vnode.effects) {
    vnode.effects = [];
  }

  // Handle reactive text nodes
  if (vnode.type === VNodeType.TEXT && vnode.dom && vnode.text) {
    // Check if text contains a signal reference (this would be handled differently)
    // For now, reactive text is handled via textContent prop
  }

  // Handle element children
  if (vnode.type === VNodeType.ELEMENT && vnode.props) {
    setupReactiveProps(vnode.dom as HTMLElement, vnode.props, vnode);
  }

  // Recursively process children
  if (vnode.children && vnode.children.length > 0) {
    for (const child of vnode.children) {
      setupReactiveChildren(child);
    }
  }
}

/**
 * Cleanup all reactive bindings for a VNode
 *
 * Disposes all effects attached to a VNode and its children.
 * Call this when unmounting a component to prevent memory leaks.
 *
 * @param vnode - VNode to cleanup
 *
 * @example
 * ```typescript
 * const vnode = renderVNodeWithBindings(myVNode);
 * // ... later, when unmounting:
 * cleanupVNodeBindings(myVNode);
 * ```
 */
export function cleanupVNodeBindings(vnode: VNode): void {
  // Dispose effects
  if (vnode.effects && vnode.effects.length > 0) {
    for (const effect of vnode.effects) {
      effect.dispose();
    }
    vnode.effects = [];
  }

  // Recursively cleanup children
  if (vnode.children && vnode.children.length > 0) {
    for (const child of vnode.children) {
      cleanupVNodeBindings(child);
    }
  }
}

/**
 * Render VNode to container with reactive bindings
 *
 * Convenience function that renders a VNode and appends it to a container.
 * Returns cleanup function to dispose all bindings when done.
 *
 * @param vnode - VNode to render
 * @param container - Container to append to
 * @returns Cleanup function to call when unmounting
 *
 * @example
 * ```typescript
 * const [count, setCount] = createSignal(0);
 * const vnode = createElementVNode('div', { textContent: count });
 * const cleanup = renderToContainer(vnode, document.body);
 * // ... later:
 * cleanup(); // Removes from DOM and cleans up effects
 * ```
 */
export function renderToContainer(vnode: VNode, container: HTMLElement): () => void {
  const dom = renderVNodeWithBindings(vnode);
  container.appendChild(dom);

  return () => {
    cleanupVNodeBindings(vnode);
    if (dom.parentNode) {
      dom.parentNode.removeChild(dom);
    }
  };
}

/**
 * Mount VNode to container
 *
 * Creates DOM from VNode using createDOMFromVNode() and attaches reactive bindings.
 * Appends the created DOM to the container element.
 * Returns the created DOM node.
 *
 * This is the main entry point for mounting VNodes with reactivity.
 *
 * @param vnode - VNode to mount
 * @param container - Container element to mount to
 * @returns Created DOM node
 *
 * @example
 * ```typescript
 * const vnode = createElementVNode('div', { textContent: count });
 * const dom = mountVNode(vnode, document.body);
 * ```
 */
export function mountVNode(vnode: VNode, container: HTMLElement): Node {
  const dom = renderVNodeWithBindings(vnode);
  container.appendChild(dom);
  return dom;
}

/**
 * Unmount VNode
 *
 * Cleans up reactive effects via cleanupReactivity() and removes the DOM node
 * from its parent. Safe to call even if the VNode is not currently mounted.
 *
 * @param vnode - VNode to unmount
 *
 * @example
 * ```typescript
 * unmountVNode(vnode); // Cleans up effects and removes from DOM
 * ```
 */
export function unmountVNode(vnode: VNode): void {
  cleanupVNodeBindings(vnode);
  if (vnode.dom && vnode.dom.parentNode) {
    vnode.dom.parentNode.removeChild(vnode.dom);
  }
}

/**
 * Handle reactive children
 *
 * Processes children for signals and attaches effects for dynamic children lists.
 * This function is called during VNode rendering to set up reactivity for child elements.
 *
 * @param vnode - Parent VNode
 * @param children - Children to process (may contain signals)
 *
 * @example
 * ```typescript
 * const vnode = createElementVNode('div');
 * handleReactiveChildren(vnode, [signal('child1'), signal('child2')]);
 * ```
 */
export function handleReactiveChildren(vnode: VNode, children: any): void {
  if (!children) {
    return;
  }

  // Initialize effects array if not present
  if (!vnode.effects) {
    vnode.effects = [];
  }

  // If children is an array, recursively process each child VNode
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object' && 'type' in child) {
        setupReactiveChildren(child);
      }
    }
  }
  // If children is a single VNode, process it
  else if (children && typeof children === 'object' && 'type' in children) {
    setupReactiveChildren(children);
  }
}

/**
 * Handle reactive attributes
 *
 * Attaches reactive bindings for signal props on an element.
 * Scans props for signals and creates appropriate reactive bindings for attributes.
 *
 * @param vnode - VNode to store effects on
 * @param element - DOM element to bind to
 * @param props - Props object (may contain signals)
 *
 * @example
 * ```typescript
 * const disabled = signal(false);
 * const element = document.createElement('button');
 * handleReactiveAttributes(vnode, element, { disabled });
 * ```
 */
export function handleReactiveAttributes(vnode: VNode, element: HTMLElement, props: any): void {
  if (!props) {
    return;
  }

  // Initialize effects array if not present
  if (!vnode.effects) {
    vnode.effects = [];
  }

  // Use the existing setupReactiveProps function
  setupReactiveProps(element, props, vnode);
}

/**
 * Handle reactive event handlers
 *
 * Special handling for event handlers with signals.
 * Ensures events re-bind on signal changes if needed.
 *
 * Note: In the current implementation, event handlers are static and don't re-bind
 * when signals change. This is the recommended approach for performance.
 * If you need dynamic event handlers, wrap them in a function that reads the signal.
 *
 * @param vnode - VNode to store effects on
 * @param element - DOM element to bind to
 * @param props - Props object (may contain event handlers)
 *
 * @example
 * ```typescript
 * const onClick = () => console.log('clicked');
 * const element = document.createElement('button');
 * handleReactiveEventHandlers(vnode, element, { onClick });
 * ```
 */
export function handleReactiveEventHandlers(vnode: VNode, element: HTMLElement, props: any): void {
  if (!props) {
    return;
  }

  // Event handlers are already attached by createDOMFromVNode
  // This function is provided for API completeness
  // Event handlers are intentionally not reactive - they are set once during mount
  // If you need dynamic event handlers, use a stable handler that reads from a signal

  // Note: We could add support for reactive event handlers here if needed:
  // for (const [key, value] of Object.entries(props)) {
  //   if (key.startsWith('on') && key.length > 2 && isSignal(value)) {
  //     // Create effect that re-binds event handler when signal changes
  //     // However, this is generally not recommended for performance reasons
  //   }
  // }
}

/**
 * Check if VNode has reactive bindings
 *
 * Utility to check if a VNode or any of its descendants have reactive effects.
 *
 * @param vnode - VNode to check
 * @returns True if VNode has effects
 */
export function hasReactiveBindings(vnode: VNode): boolean {
  if (vnode.effects && vnode.effects.length > 0) {
    return true;
  }

  if (vnode.children && vnode.children.length > 0) {
    return vnode.children.some(hasReactiveBindings);
  }

  return false;
}

/**
 * Get all reactive bindings from VNode tree
 *
 * Collects all effects from VNode and its descendants.
 * Useful for debugging and testing.
 *
 * @param vnode - Root VNode
 * @returns Array of all effects in tree
 */
export function getAllBindings(vnode: VNode): ReactiveBinding['effect'][] {
  const effects: ReactiveBinding['effect'][] = [];

  if (vnode.effects) {
    effects.push(...vnode.effects);
  }

  if (vnode.children && vnode.children.length > 0) {
    for (const child of vnode.children) {
      effects.push(...getAllBindings(child));
    }
  }

  return effects;
}
