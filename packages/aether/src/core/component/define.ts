/**
 * Component Definition
 *
 * Core component creation and management
 */

import { getOwner, onCleanup, context, OwnerImpl } from '../reactivity/context.js';
import { triggerMount, cleanupComponentContext, handleComponentError } from './lifecycle.js';
import { reactiveProps } from './props.js';
import type { ComponentSetup, Component, RenderFunction } from './types.js';
import type { VNode } from '../../reconciler/vnode.js';
import { effect } from '../reactivity/effect.js';
import { renderVNodeWithBindings } from '../../reconciler/jsx-integration.js';
import { createDOMFromVNode } from '../../reconciler/create-dom.js';
import { isSignal } from '../reactivity/signal.js';

/**
 * Check if running in SSR mode
 * @internal
 */
function isSSR(): boolean {
  return typeof window === 'undefined';
}

/**
 * Feature flag to enable template caching
 * When enabled, components that return VNodes will have their templates cached
 * @default false (will be enabled when reconciliation engine is complete)
 */
export const ENABLE_TEMPLATE_CACHE = false;

/**
 * WeakMap to track owners associated with DOM nodes
 * When a DOM node is removed, we can dispose its associated owner
 */
const nodeOwners = new WeakMap<Node, any>();

/**
 * Attach an owner to a DOM node for lifecycle management
 * @internal
 */
function attachOwnerToNode(node: Node, owner: any): void {
  nodeOwners.set(node, owner);
}

/**
 * Dispose the owner associated with a DOM node and its children
 * @internal
 */
function disposeNodeOwner(node: Node): void {
  const owner = nodeOwners.get(node);
  if (owner) {
    try {
      owner.dispose();
    } catch (error) {
      console.error('Error disposing node owner:', error);
    }
    nodeOwners.delete(node);
  }

  // Recursively dispose children
  if (node.childNodes) {
    for (const child of Array.from(node.childNodes)) {
      disposeNodeOwner(child);
    }
  }
}

/**
 * Check if a value is a VNode
 * @internal
 */
function isVNode(value: any): value is VNode {
  return value != null && typeof value === 'object' && 'type' in value && 'dom' in value;
}

/**
 * Check if a VNode has reactive props (signals)
 * @internal
 */
function hasReactivePropsInVNode(vnode: VNode): boolean {
  if (!vnode.props) return false;

  for (const [key, value] of Object.entries(vnode.props)) {
    // Skip internal props
    if (key.startsWith('__')) continue;

    if (isSignal(value)) return true;

    // Check nested values in style object
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Node)) {
      for (const nestedValue of Object.values(value)) {
        if (isSignal(nestedValue)) return true;
      }
    }

    // Check array values
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isSignal(item)) return true;
      }
    }
  }

  return false;
}

/**
 * Update existing DOM node to match new node without replacing it
 * This preserves element references and event listeners
 * @internal
 */
function updateDOM(oldNode: Node, newNode: Node): void {
  // If both are text nodes, just update content
  if (oldNode.nodeType === Node.TEXT_NODE && newNode.nodeType === Node.TEXT_NODE) {
    if (oldNode.textContent !== newNode.textContent) {
      oldNode.textContent = newNode.textContent;
    }
    return;
  }

  // If both are elements
  if (oldNode.nodeType === Node.ELEMENT_NODE && newNode.nodeType === Node.ELEMENT_NODE) {
    const oldEl = oldNode as Element;
    const newEl = newNode as Element;

    // If tag names differ, we have to replace the whole element
    if (oldEl.tagName !== newEl.tagName) {
      if (oldNode.parentNode) {
        // Dispose owner before replacing
        disposeNodeOwner(oldNode);
        oldNode.parentNode.replaceChild(newNode, oldNode);
      }
      return;
    }

    // Update attributes
    // Remove old attributes that don't exist in new element
    Array.from(oldEl.attributes).forEach((attr) => {
      if (!newEl.hasAttribute(attr.name)) {
        oldEl.removeAttribute(attr.name);
      }
    });

    // Set new/updated attributes
    Array.from(newEl.attributes).forEach((attr) => {
      const oldValue = oldEl.getAttribute(attr.name);
      if (oldValue !== attr.value) {
        // Special handling for class attribute - use className for better performance
        if (attr.name === 'class') {
          oldEl.className = attr.value;
        } else {
          oldEl.setAttribute(attr.name, attr.value);
        }
      }
    });

    // IMPORTANT: Copy event listeners from new element to old element
    // Event listeners are not stored as attributes, so we need to check for them
    // on the new element and transfer them to the old element
    // We store a mapping of event names to handlers on the element itself
    const newEventMap = (newEl as any).__eventListeners;
    if (newEventMap) {
      // Remove old event listeners
      const oldEventMap = (oldEl as any).__eventListeners;
      if (oldEventMap) {
        for (const [eventName, handler] of Object.entries(oldEventMap)) {
          oldEl.removeEventListener(eventName, handler as EventListener);
        }
      }

      // Add new event listeners
      const newListenerMap: Record<string, EventListener> = {};
      for (const [eventName, handler] of Object.entries(newEventMap)) {
        oldEl.addEventListener(eventName, handler as EventListener);
        newListenerMap[eventName] = handler as EventListener;
      }
      (oldEl as any).__eventListeners = newListenerMap;
    }

    // Update children
    const oldChildren = Array.from(oldNode.childNodes);
    const newChildren = Array.from(newNode.childNodes);

    // Simple algorithm: update existing children, add new ones, remove extras
    const maxLength = Math.max(oldChildren.length, newChildren.length);

    for (let i = 0; i < maxLength; i++) {
      const oldChild = oldChildren[i];
      const newChild = newChildren[i];

      if (!oldChild && newChild) {
        // Add new child - use the actual node, not a clone
        // This preserves event listeners that were attached during creation
        oldNode.appendChild(newChild);
      } else if (oldChild && !newChild) {
        // Remove old child - dispose owner first
        disposeNodeOwner(oldChild);
        oldNode.removeChild(oldChild);
      } else if (oldChild && newChild) {
        // Update existing child recursively
        updateDOM(oldChild, newChild);
      }
    }

    return;
  }

  // Different node types - have to replace
  if (oldNode.parentNode) {
    // Dispose owner before replacing
    disposeNodeOwner(oldNode);
    oldNode.parentNode.replaceChild(newNode, oldNode);
  }
}

/**
 * Define a component from a setup function
 *
 * @param setup - Setup function that returns a render function
 * @param name - Optional component name for debugging
 * @returns Component function
 *
 * @example
 * ```typescript
 * const Counter = defineComponent(() => {
 *   const count = signal(0);
 *
 *   return () => (
 *     <button on:click={() => count.set(count() + 1)}>
 *       {count()}
 *     </button>
 *   );
 * });
 * ```
 */
export function defineComponent<P = {}>(setup: ComponentSetup<P>, name?: string): Component<P> {
  // Create component function - each call creates a new instance
  const comp: Component<P> = (props: P): any => {
    let render: RenderFunction | undefined;

    // Wrap props in reactive proxy
    const reactivePropsInstance = reactiveProps(props as Record<string, any>);

    // Create owner with parent link (important for error boundaries)
    const parentOwner = getOwner();
    const owner = new OwnerImpl(parentOwner);

    // Set component name for debugging
    if (name && owner) {
      (owner as any).name = name;
    }

    // Run setup in component's owner context
    // Outer try-catch needed because handleComponentError may re-throw
    try {
      context.runWithOwner(owner, () => {
        try {
          // Run setup function with reactive props
          // Cast to P since reactiveProps adds internal methods
          render = setup(reactivePropsInstance as P);
        } catch (err) {
          // If it's a Promise (from lazy component/Suspense), re-throw
          if (err instanceof Promise) {
            throw err;
          }
          // Handle setup errors
          handleComponentError(owner, err as Error);
          // Don't throw - error was handled
        }

        // Register cleanup
        onCleanup(() => {
          cleanupComponentContext(owner);
          // Note: Don't call owner.dispose() here as it would cause infinite recursion
          // The owner dispose is triggered by the cleanup chain from disposeNodeOwner
        });
      });
    } catch (_setupError) {
      // If it's a Promise, re-throw for Suspense
      if (_setupError instanceof Promise) {
        throw _setupError;
      }
      // If handleComponentError re-threw (no error boundary found),
      // catch it here and return null to prevent component from rendering
      return null;
    }

    // Trigger mount lifecycle
    triggerMount(owner);

    // Return render result with error handling
    // Run render in owner context so children have correct parent

    // If render is undefined (setup failed), return null
    if (!render) {
      return null;
    }

    // SSR Mode: Return VNode directly without converting to DOM
    // This allows the SSR renderer to traverse the component tree
    if (isSSR()) {
      try {
        return context.runWithOwner(owner, () => render!());
      } catch (err) {
        // Handle render errors in SSR
        if (err instanceof Promise) {
          throw err;
        }
        handleComponentError(owner, err as Error);
        return null;
      }
    }

    // Client Mode: Convert to DOM with reactivity
    // Outer try-catch for render phase errors
    try {
      return context.runWithOwner(owner, () => {
        try {
          // We need to detect if the render function reads any signals
          // If it does, we wrap it in an effect to make it reactive
          // If it doesn't, we just render it once

          let rootElement: Node | null = null;

          // Create an effect that wraps the render function
          // This tracks signal dependencies automatically
          effect(() => {
            try {
              // Execute render function with owner context so child components
              // created during render have correct parent owner for context access
              const result = context.runWithOwner(owner, () => render!());

              // Convert result to DOM if needed
              let newNode: Node;

              if (result === null || result === undefined) {
                newNode = document.createTextNode('');
              } else if (result instanceof Node) {
                newNode = result;
              } else if (isVNode(result)) {
                // Check if VNode has reactive props
                const hasReactiveProps = hasReactivePropsInVNode(result);
                if (hasReactiveProps) {
                  newNode = renderVNodeWithBindings(result);
                } else {
                  newNode = createDOMFromVNode(result);
                }
              } else {
                // Fallback: convert to text
                newNode = document.createTextNode(String(result));
              }

              if (!rootElement) {
                // First render - just set the root and attach owner (if not already attached)
                rootElement = newNode;
                // Only attach owner if the node doesn't already have one (from a child component)
                if (!nodeOwners.has(rootElement)) {
                  attachOwnerToNode(rootElement, owner);
                }
              } else {
                // Subsequent render - update existing element
                // Check if we need to replace the element
                const needsReplace =
                  // Different node types
                  rootElement.nodeType !== newNode.nodeType ||
                  // Different element tags
                  (rootElement.nodeType === Node.ELEMENT_NODE &&
                    (rootElement as Element).tagName !== (newNode as Element).tagName) ||
                  // Root has an owner from a child component (means it's from a different component)
                  (nodeOwners.has(rootElement) && nodeOwners.get(rootElement) !== owner);

                if (needsReplace) {
                  // Must replace the element
                  if (rootElement.parentNode) {
                    // Dispose old root's children (but not root itself, as it's managed by this component's owner)
                    if (rootElement.childNodes) {
                      for (const child of Array.from(rootElement.childNodes)) {
                        disposeNodeOwner(child);
                      }
                    }
                    // Dispose the old root's owner if it has one (could be from a child component)
                    disposeNodeOwner(rootElement);
                    rootElement.parentNode.replaceChild(newNode, rootElement);
                    rootElement = newNode;
                    // Only attach owner if the new node doesn't already have one
                    if (!nodeOwners.has(rootElement)) {
                      attachOwnerToNode(rootElement, owner);
                    }
                  }
                } else {
                  // Same type and same owner - update in place
                  updateDOM(rootElement, newNode);
                }
              }
            } catch (err) {
              // If it's a Promise (from lazy component/Suspense), re-throw it
              // so it can be caught by Suspense boundary
              if (err instanceof Promise) {
                throw err;
              }
              // Handle actual render errors
              handleComponentError(owner, err as Error);
            }
          });

          // Return the root element (effect runs immediately so it's already set)
          return rootElement;
        } catch (err) {
          // If it's a Promise, re-throw for Suspense
          if (err instanceof Promise) {
            throw err;
          }
          // Handle render errors
          handleComponentError(owner, err as Error);
          // Return fallback or null on render error
          return null;
        }
      });
    } catch (_renderError) {
      // If it's a Promise, re-throw for Suspense
      if (_renderError instanceof Promise) {
        throw _renderError;
      }
      // If handleComponentError re-threw during render (no error boundary found),
      // catch it here and return null
      return null;
    }
  };

  // Set display name
  if (name) {
    comp.displayName = name;
  }

  return comp;
}

/**
 * Create a component with explicit name
 *
 * @example
 * ```typescript
 * const Counter = component('Counter', () => {
 *   const count = signal(0);
 *   return () => <div>{count()}</div>;
 * });
 * ```
 */
export function component<P = {}>(name: string, setup: ComponentSetup<P>): Component<P> {
  return defineComponent(setup, name);
}
