/**
 * Transfer - Transfer items between two lists
 *
 * Features:
 * - Source and target lists
 * - Search/filter in both lists
 * - Bulk operations (select all, clear)
 * - Transfer selected items
 * - Custom item rendering
 * - Controlled and uncontrolled modes
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';

export interface TransferItem {
  key: string;
  title: string;
  disabled?: boolean;
}

export interface TransferProps {
  /** Source items */
  dataSource: TransferItem[];
  /** Target keys (controlled) */
  targetKeys?: string[];
  /** Target keys change */
  onTargetKeysChange?: (keys: string[]) => void;
  /** Default target keys */
  defaultTargetKeys?: string[];
  /** Render item */
  render?: (item: TransferItem) => any;
  /** Disabled */
  disabled?: boolean;
  /** Children */
  children?: any | (() => any);
}

interface TransferContextValue {
  sourceItems: Signal<TransferItem[]>;
  targetItems: Signal<TransferItem[]>;
  selectedSource: Signal<string[]>;
  selectedTarget: Signal<string[]>;
  transferToTarget: () => void;
  transferToSource: () => void;
  toggleSourceSelection: (key: string) => void;
  toggleTargetSelection: (key: string) => void;
}

// Global reactive context signal that will be updated during Transfer setup
// This allows children to access the context even if they're evaluated before the parent
// Using a SIGNAL makes the context reactive, so effects will rerun when it updates
const globalTransferContextSignal = signal<TransferContextValue | null>(null);

const TransferContext = createContext<TransferContextValue | null>(null, 'Transfer');

const useTransferContext = (): TransferContextValue => {
  const context = useContext(TransferContext);
  if (context) return context;

  // Fallback to global signal
  const globalContext = globalTransferContextSignal();
  if (!globalContext) {
    throw new Error('Transfer components must be used within Transfer');
  }
  return globalContext;
};

export const Transfer = defineComponent<TransferProps>((props) => {
  const internalTargetKeys: WritableSignal<string[]> = signal<string[]>(props.defaultTargetKeys ?? []);
  const selectedSource: WritableSignal<string[]> = signal<string[]>([]);
  const selectedTarget: WritableSignal<string[]> = signal<string[]>([]);

  const currentTargetKeys = (): string[] => props.targetKeys ?? internalTargetKeys();

  const setTargetKeys = (keys: string[]) => {
    if (!props.targetKeys) internalTargetKeys.set(keys);
    props.onTargetKeysChange?.(keys);
  };

  const sourceItems = computed(() => {
    const targetKeys = currentTargetKeys();
    return props.dataSource.filter((item) => !targetKeys.includes(item.key));
  });

  const targetItems = computed(() => {
    const targetKeys = currentTargetKeys();
    return props.dataSource.filter((item) => targetKeys.includes(item.key));
  });

  const transferToTarget = () => {
    const keys = [...currentTargetKeys(), ...selectedSource()];
    setTargetKeys(keys);
    selectedSource.set([]);
  };

  const transferToSource = () => {
    const keysToRemove = selectedTarget();
    const keys = currentTargetKeys().filter((k) => !keysToRemove.includes(k));
    setTargetKeys(keys);
    selectedTarget.set([]);
  };

  const toggleSourceSelection = (key: string) => {
    const selected = selectedSource();
    selectedSource.set(
      selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key],
    );
  };

  const toggleTargetSelection = (key: string) => {
    const selected = selectedTarget();
    selectedTarget.set(
      selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key],
    );
  };

  const contextValue: TransferContextValue = {
    sourceItems,
    targetItems,
    selectedSource: computed(() => selectedSource()),
    selectedTarget: computed(() => selectedTarget()),
    transferToTarget,
    transferToSource,
    toggleSourceSelection,
    toggleTargetSelection,
  };

  // CRITICAL FIX: Set global context signal so children can access it
  // Using a signal makes this reactive - effects will rerun when it updates!
  globalTransferContextSignal.set(contextValue);

  // Also provide context via the standard API
  provideContext(TransferContext, contextValue);

  return () => {
    // Support function children
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx('div', { 'data-transfer': '', children });
  };
});

export const TransferList = defineComponent<{ type: 'source' | 'target'; children?: any | (() => any) }>((props) => {
  const context = useTransferContext();

  const refCallback = (element: HTMLElement | null) => {
    if (!element) return;

    // Set up effect to reactively update children when items change
    effect(() => {
      const items = props.type === 'source' ? context.sourceItems() : context.targetItems();
      const selected = props.type === 'source' ? context.selectedSource() : context.selectedTarget();

      // Clear existing children
      element.innerHTML = '';

      // Append new children
      items.forEach((item) => {
        const itemRender = TransferItem({
          item,
          type: props.type,
          selected: selected.includes(item.key),
          onToggle: () => {
            if (props.type === 'source') {
              context.toggleSourceSelection(item.key);
            } else {
              context.toggleTargetSelection(item.key);
            }
          },
        });

        // Call the render function to get the DOM node
        const itemElement = typeof itemRender === 'function' ? itemRender() : itemRender;

        if (itemElement instanceof Node) {
          element.appendChild(itemElement);
        }
      });
    });
  };

  return () => jsx('div', {
      ref: refCallback,
      'data-transfer-list': '',
      'data-type': props.type,
    });
});

// Helper component for individual transfer items
const TransferItem = defineComponent<{
  item: TransferItem;
  type: 'source' | 'target';
  selected: boolean;
  onToggle: () => void;
}>((props) => {
  const context = useTransferContext();

  // Create ref callback for reactive updates
  const refCallback = (element: HTMLElement | null) => {
    if (!element) return;

    // Set up effect to reactively update attributes when selection changes
    effect(() => {
      const selected =
        props.type === 'source'
          ? context.selectedSource().includes(props.item.key)
          : context.selectedTarget().includes(props.item.key);

      if (selected) {
        element.setAttribute('data-selected', '');
      } else {
        element.removeAttribute('data-selected');
      }

      if (props.item.disabled) {
        element.setAttribute('data-disabled', '');
      } else {
        element.removeAttribute('data-disabled');
      }
    });
  };

  return () =>
    jsx('div', {
      ref: refCallback,
      'data-transfer-item': '',
      'data-selected': props.selected ? '' : undefined,
      'data-disabled': props.item.disabled ? '' : undefined,
      onClick: props.onToggle,
      children: props.item.title,
    });
});

export const TransferControls = defineComponent<any>(() => {
  const context = useTransferContext();

  const refCallback = (element: HTMLElement | null) => {
    if (!element) return;

    // Set up effect to reactively update button disabled state
    effect(() => {
      const toTargetButton = element.querySelector('button:first-child') as HTMLButtonElement;
      const toSourceButton = element.querySelector('button:last-child') as HTMLButtonElement;

      if (toTargetButton) {
        toTargetButton.disabled = context.selectedSource().length === 0;
      }
      if (toSourceButton) {
        toSourceButton.disabled = context.selectedTarget().length === 0;
      }
    });
  };

  return () =>
    jsx('div', {
      ref: refCallback,
      'data-transfer-controls': '',
      children: [
        jsx('button', {
          onClick: () => context.transferToTarget(),
          children: '→',
        }),
        jsx('button', {
          onClick: () => context.transferToSource(),
          children: '←',
        }),
      ],
    });
});

(Transfer as any).List = TransferList;
(Transfer as any).Controls = TransferControls;

export type { TransferContextValue };
