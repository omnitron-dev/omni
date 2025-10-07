/**
 * Popconfirm - Confirmation dialog in popover
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

export interface PopconfirmProps {
  title: string;
  description?: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  okText?: string;
  cancelText?: string;
  children?: any;
}

interface PopconfirmContextValue {
  isOpen: Signal<boolean>;
  setOpen: (open: boolean) => void;
  confirm: () => void;
  cancel: () => void;
}

const PopconfirmContext = createContext<PopconfirmContextValue | null>(null);

const usePopconfirmContext = (): PopconfirmContextValue => {
  const context = useContext(PopconfirmContext);
  if (!context) throw new Error('Popconfirm components must be used within Popconfirm');
  return context;
};

export const Popconfirm = defineComponent<PopconfirmProps>((props) => {
  const isOpen: WritableSignal<boolean> = signal(false);

  const confirm = async () => {
    await props.onConfirm?.();
    isOpen.set(false);
  };

  const cancel = () => {
    props.onCancel?.();
    isOpen.set(false);
  };

  const contextValue: PopconfirmContextValue = {
    isOpen: computed(() => isOpen()),
    setOpen: (open: boolean) => isOpen.set(open),
    confirm,
    cancel,
  };

  return () => jsx(PopconfirmContext.Provider, { value: contextValue, children: jsx('div', { 'data-popconfirm': '', children: props.children }) });
});

export const PopconfirmTrigger = defineComponent<any>((props) => {
  const context = usePopconfirmContext();
  return () => jsx('div', { 'data-popconfirm-trigger': '', onClick: () => context.setOpen(true), children: props.children });
});

export const PopconfirmContent = defineComponent<any>((props) => {
  const context = usePopconfirmContext();
  if (!context.isOpen()) return () => null;

  return () => jsx('div', { 'data-popconfirm-content': '', role: 'dialog', children: props.children });
});

(Popconfirm as any).Trigger = PopconfirmTrigger;
(Popconfirm as any).Content = PopconfirmContent;

export type { PopconfirmContextValue };
