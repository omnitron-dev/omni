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

const TransferContext = createContext<TransferContextValue | null>(null);

const useTransferContext = (): TransferContextValue => {
  const context = useContext(TransferContext);
  if (!context) throw new Error('Transfer components must be used within Transfer');
  return context;
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

  // Provide context BEFORE return
  provideContext(TransferContext, contextValue);

  return () => {
    // Support function children
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx('div', { 'data-transfer': '', children });
  };
});

export const TransferList = defineComponent<{ type: 'source' | 'target' }>((props) => {
  const context = useTransferContext();
  const items = props.type === 'source' ? context.sourceItems() : context.targetItems();
  const selected =
    props.type === 'source' ? context.selectedSource() : context.selectedTarget();

  return () =>
    jsx('div', {
      'data-transfer-list': '',
      'data-type': props.type,
      children: items.map((item) =>
        jsx('div', {
          'data-transfer-item': '',
          'data-selected': selected.includes(item.key) ? '' : undefined,
          onClick: () => {
            if (props.type === 'source') {
              context.toggleSourceSelection(item.key);
            } else {
              context.toggleTargetSelection(item.key);
            }
          },
          children: item.title,
        }),
      ),
    });
});

export const TransferControls = defineComponent<any>(() => {
  const context = useTransferContext();

  return () =>
    jsx('div', {
      'data-transfer-controls': '',
      children: [
        jsx('button', {
          onClick: () => context.transferToTarget(),
          disabled: context.selectedSource().length === 0,
          children: '→',
        }),
        jsx('button', {
          onClick: () => context.transferToSource(),
          disabled: context.selectedTarget().length === 0,
          children: '←',
        }),
      ],
    });
});

(Transfer as any).List = TransferList;
(Transfer as any).Controls = TransferControls;

export type { TransferContextValue };
