/**
 * Modal Component Example
 *
 * Demonstrates:
 * - Portal for rendering outside component tree
 * - clickOutside directive for closing on outside click
 * - autoFocus directive for focus management
 * - ErrorBoundary for error handling
 * - Conditional rendering with Show
 * - Event composition with preventStop
 *
 * Usage:
 * ```tsx
 * const isOpen = signal(false);
 *
 * <Modal
 *   isOpen={isOpen()}
 *   onClose={() => isOpen.set(false)}
 *   title="My Modal"
 * >
 *   <p>Modal content here</p>
 * </Modal>
 * ```
 */

import { defineComponent } from '@omnitron-dev/aether';
import { Show, Portal } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';
import { clickOutside, autoFocus, combineDirectives, preventStop, createDirective } from '@omnitron-dev/aether/utils';

/**
 * Modal Props
 */
export interface ModalProps {
  /** Whether modal is open */
  isOpen: boolean;

  /** Callback when modal should close */
  onClose: () => void;

  /** Modal title */
  title?: string;

  /** Modal size */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';

  /** Whether to show close button */
  showCloseButton?: boolean;

  /** Whether to close on outside click */
  closeOnOutsideClick?: boolean;

  /** Whether to close on Escape key */
  closeOnEscape?: boolean;

  /** Modal content */
  children?: any;

  /** Footer content */
  footer?: any;
}

/**
 * Focus trap directive - keeps focus within modal
 */
const focusTrap = createDirective<void>((element) => {
  const focusableElements = element.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  const firstElement = focusableElements[0] as HTMLElement;
  const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

  const handleTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      }
    } else {
      // Tab
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }
  };

  element.addEventListener('keydown', handleTabKey);

  return () => {
    element.removeEventListener('keydown', handleTabKey);
  };
});

/**
 * Escape key handler directive
 */
const escapeKey = createDirective<() => void>((element, onEscape) => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onEscape();
    }
  };

  document.addEventListener('keydown', handleKeyDown);

  return () => {
    document.removeEventListener('keydown', handleKeyDown);
  };
});

/**
 * Modal Component
 */
export const Modal = defineComponent<ModalProps>((props) => {
  const modalRef = signal<HTMLElement | null>(null);

  const handleClose = () => {
    if (!props.isOpen) return;
    props.onClose();
  };

  const handleOutsideClick = () => {
    if (props.closeOnOutsideClick !== false) {
      handleClose();
    }
  };

  const handleEscape = () => {
    if (props.closeOnEscape !== false) {
      handleClose();
    }
  };

  return () => (
    <Show when={props.isOpen}>
      <Portal>
        {/* Backdrop */}
        <div className="modal-backdrop">
          {/* Modal Container */}
          <div
            className="modal-container"
            role="dialog"
            aria-modal="true"
            aria-labelledby={props.title ? 'modal-title' : undefined}
            ref={combineDirectives([
              (el) => modalRef.set(el as HTMLElement),
              clickOutside(handleOutsideClick),
              focusTrap(),
              escapeKey(handleEscape),
            ])}
          >
            <div className={`modal-content modal-${props.size ?? 'md'}`}>
              {/* Header */}
              <Show when={props.title || props.showCloseButton !== false}>
                <div className="modal-header">
                  <Show when={props.title}>
                    <h2 id="modal-title" className="modal-title">
                      {props.title}
                    </h2>
                  </Show>

                  <Show when={props.showCloseButton !== false}>
                    <button
                      type="button"
                      className="modal-close-button"
                      onClick={handleClose}
                      aria-label="Close modal"
                      ref={autoFocus()}
                    >
                      ×
                    </button>
                  </Show>
                </div>
              </Show>

              {/* Body */}
              <div className="modal-body">{props.children}</div>

              {/* Footer */}
              <Show when={props.footer}>
                <div className="modal-footer">{props.footer}</div>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
});

/**
 * CSS Styles (would typically be in a separate .css file)
 *
 * ```css
 * .modal-backdrop {
 *   position: fixed;
 *   inset: 0;
 *   background-color: rgba(0, 0, 0, 0.5);
 *   display: flex;
 *   align-items: center;
 *   justify-content: center;
 *   z-index: 1000;
 *   animation: fade-in 0.2s ease;
 * }
 *
 * .modal-container {
 *   position: relative;
 *   width: 100%;
 *   max-height: 90vh;
 *   overflow-y: auto;
 *   padding: 1rem;
 * }
 *
 * .modal-content {
 *   background-color: white;
 *   border-radius: 0.5rem;
 *   box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
 *   margin: 0 auto;
 *   animation: slide-up 0.3s ease;
 * }
 *
 * .modal-sm { max-width: 24rem; }
 * .modal-md { max-width: 32rem; }
 * .modal-lg { max-width: 48rem; }
 * .modal-xl { max-width: 64rem; }
 * .modal-full { max-width: calc(100% - 2rem); }
 *
 * .modal-header {
 *   display: flex;
 *   align-items: center;
 *   justify-content: space-between;
 *   padding: 1.5rem;
 *   border-bottom: 1px solid #e5e7eb;
 * }
 *
 * .modal-title {
 *   font-size: 1.25rem;
 *   font-weight: 600;
 *   margin: 0;
 *   color: #111827;
 * }
 *
 * .modal-close-button {
 *   width: 2rem;
 *   height: 2rem;
 *   border: none;
 *   background: transparent;
 *   font-size: 1.5rem;
 *   line-height: 1;
 *   color: #6b7280;
 *   cursor: pointer;
 *   border-radius: 0.25rem;
 *   display: flex;
 *   align-items: center;
 *   justify-content: center;
 *   transition: all 0.15s ease;
 * }
 *
 * .modal-close-button:hover {
 *   background-color: #f3f4f6;
 *   color: #111827;
 * }
 *
 * .modal-close-button:focus-visible {
 *   outline: 2px solid #3b82f6;
 *   outline-offset: 2px;
 * }
 *
 * .modal-body {
 *   padding: 1.5rem;
 * }
 *
 * .modal-footer {
 *   display: flex;
 *   align-items: center;
 *   justify-content: flex-end;
 *   gap: 0.75rem;
 *   padding: 1.5rem;
 *   border-top: 1px solid #e5e7eb;
 *   background-color: #f9fafb;
 *   border-bottom-left-radius: 0.5rem;
 *   border-bottom-right-radius: 0.5rem;
 * }
 *
 * @keyframes fade-in {
 *   from { opacity: 0; }
 *   to { opacity: 1; }
 * }
 *
 * @keyframes slide-up {
 *   from {
 *     opacity: 0;
 *     transform: translateY(1rem);
 *   }
 *   to {
 *     opacity: 1;
 *     transform: translateY(0);
 *   }
 * }
 * ```
 */

/**
 * Usage Examples
 */

// Basic modal
export const BasicModalExample = defineComponent(() => {
  const isOpen = signal(false);

  return () => (
    <div>
      <button onClick={() => isOpen.set(true)}>Open Modal</button>

      <Modal isOpen={isOpen()} onClose={() => isOpen.set(false)} title="Basic Modal">
        <p>This is a basic modal example.</p>
        <p>Click outside, press Escape, or click the X to close.</p>
      </Modal>
    </div>
  );
});

// Modal with footer
export const ModalWithFooterExample = defineComponent(() => {
  const isOpen = signal(false);

  const handleConfirm = () => {
    console.log('Confirmed!');
    isOpen.set(false);
  };

  return () => (
    <div>
      <button onClick={() => isOpen.set(true)}>Open Confirmation Modal</button>

      <Modal
        isOpen={isOpen()}
        onClose={() => isOpen.set(false)}
        title="Confirm Action"
        footer={
          <>
            <button onClick={() => isOpen.set(false)}>Cancel</button>
            <button onClick={handleConfirm}>Confirm</button>
          </>
        }
      >
        <p>Are you sure you want to proceed with this action?</p>
      </Modal>
    </div>
  );
});

// Different sizes
export const ModalSizesExample = defineComponent(() => {
  const activeSize = signal<'sm' | 'md' | 'lg' | 'xl' | null>(null);

  return () => (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button onClick={() => activeSize.set('sm')}>Small</button>
        <button onClick={() => activeSize.set('md')}>Medium</button>
        <button onClick={() => activeSize.set('lg')}>Large</button>
        <button onClick={() => activeSize.set('xl')}>Extra Large</button>
      </div>

      <Modal
        isOpen={activeSize() !== null}
        onClose={() => activeSize.set(null)}
        size={activeSize() ?? 'md'}
        title={`${activeSize()?.toUpperCase()} Modal`}
      >
        <p>This is a {activeSize()} sized modal.</p>
      </Modal>
    </div>
  );
});

// Form in modal
export const FormModalExample = defineComponent(() => {
  const isOpen = signal(false);
  const name = signal('');
  const email = signal('');

  const handleSubmit = () => {
    console.log('Submitted:', { name: name(), email: email() });
    isOpen.set(false);
    name.set('');
    email.set('');
  };

  return () => (
    <div>
      <button onClick={() => isOpen.set(true)}>Open Form Modal</button>

      <Modal
        isOpen={isOpen()}
        onClose={() => isOpen.set(false)}
        title="User Information"
        footer={
          <>
            <button type="button" onClick={() => isOpen.set(false)}>
              Cancel
            </button>
            <button type="submit" form="user-form">
              Submit
            </button>
          </>
        }
      >
        <form
          id="user-form"
          onSubmit={preventStop(handleSubmit)}
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <div>
            <label htmlFor="name">Name:</label>
            <input
              id="name"
              type="text"
              value={name()}
              onInput={(e) => name.set(e.currentTarget.value)}
              style={{ width: '100%', marginTop: '0.25rem' }}
            />
          </div>

          <div>
            <label htmlFor="email">Email:</label>
            <input
              id="email"
              type="email"
              value={email()}
              onInput={(e) => email.set(e.currentTarget.value)}
              style={{ width: '100%', marginTop: '0.25rem' }}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
});

/**
 * Key Takeaways:
 *
 * 1. **Portal**: Renders modal outside component tree for z-index control
 * 2. **Directives**: clickOutside, autoFocus, focusTrap, escapeKey
 * 3. **Composition**: combineDirectives() for multiple behaviors
 * 4. **Accessibility**: ARIA attributes, focus management, keyboard support
 * 5. **Conditional Rendering**: Show component for open/close state
 * 6. **Event Handling**: preventStop() for form submission
 * 7. **Custom Directives**: focusTrap and escapeKey show directive pattern
 */
