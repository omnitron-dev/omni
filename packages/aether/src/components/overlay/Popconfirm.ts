/**
 * Styled Popconfirm Component
 *
 * Inline confirmation popover.
 * Built on top of the Popconfirm primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Popconfirm as PopconfirmPrimitive,
  PopconfirmTrigger as PopconfirmTriggerPrimitive,
  PopconfirmContent as PopconfirmContentPrimitive,
  // PopconfirmTitle as PopconfirmTitlePrimitive, // TODO: Not exported from primitive
  // PopconfirmDescription as PopconfirmDescriptionPrimitive, // TODO: Not exported from primitive
  // PopconfirmAction as PopconfirmActionPrimitive, // TODO: Not exported from primitive
  // PopconfirmCancel as PopconfirmCancelPrimitive, // TODO: Not exported from primitive
  type PopconfirmProps as PopconfirmPrimitiveProps,
} from '../../primitives/Popconfirm.js';
import { defineComponent } from '../../core/component/index.js';

// Temporary placeholders until primitive components are implemented
const PopconfirmTitlePrimitive = defineComponent<{ children?: any }>((props) => () => ({ type: 'div', props }));
const PopconfirmDescriptionPrimitive = defineComponent<{ children?: any }>((props) => () => ({ type: 'div', props }));
const PopconfirmActionPrimitive = defineComponent<{ children?: any }>((props) => () => ({ type: 'button', props }));
const PopconfirmCancelPrimitive = defineComponent<{ children?: any }>((props) => () => ({ type: 'button', props }));

/**
 * Popconfirm - Root component
 */
export const Popconfirm = PopconfirmPrimitive;

/**
 * PopconfirmTrigger - Trigger element
 */
export const PopconfirmTrigger = PopconfirmTriggerPrimitive;

/**
 * PopconfirmContent - Content container
 */
export const PopconfirmContent = styled(PopconfirmContentPrimitive, {
  base: {
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    border: '1px solid #e5e7eb',
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    padding: '1rem',
    maxWidth: '300px',
    zIndex: '50',
    animation: 'popconfirm-show 0.15s ease-out',
    '&[data-state="closed"]': {
      animation: 'popconfirm-hide 0.1s ease-in',
    },
  },
});

/**
 * PopconfirmTitle - Title
 */
export const PopconfirmTitle = styled(PopconfirmTitlePrimitive, {
  base: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#111827',
    marginBottom: '0.5rem',
  },
});

/**
 * PopconfirmDescription - Description
 */
export const PopconfirmDescription = styled(PopconfirmDescriptionPrimitive, {
  base: {
    fontSize: '0.8125rem',
    lineHeight: '1.5',
    color: '#6b7280',
    marginBottom: '1rem',
  },
});

/**
 * PopconfirmAction - Confirm button
 */
export const PopconfirmAction = styled<{
  variant?: 'default' | 'destructive';
}>(PopconfirmActionPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.375rem 0.75rem',
    fontSize: '0.8125rem',
    fontWeight: '500',
    lineHeight: '1.25',
    borderRadius: '0.375rem',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #ffffff, 0 0 0 4px #3b82f6',
    },
    '&:disabled': {
      opacity: '0.5',
      cursor: 'not-allowed',
    },
  },
  variants: {
    variant: {
      default: {
        backgroundColor: '#3b82f6',
        color: '#ffffff',
        '&:hover:not(:disabled)': {
          backgroundColor: '#2563eb',
        },
      },
      destructive: {
        backgroundColor: '#ef4444',
        color: '#ffffff',
        '&:hover:not(:disabled)': {
          backgroundColor: '#dc2626',
        },
      },
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

/**
 * PopconfirmCancel - Cancel button
 */
export const PopconfirmCancel = styled(PopconfirmCancelPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.375rem 0.75rem',
    fontSize: '0.8125rem',
    fontWeight: '500',
    lineHeight: '1.25',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    backgroundColor: '#ffffff',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    marginRight: '0.5rem',
    '&:hover': {
      backgroundColor: '#f9fafb',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
  },
});

// Attach sub-components
(Popconfirm as any).Trigger = PopconfirmTrigger;
(Popconfirm as any).Content = PopconfirmContent;
(Popconfirm as any).Title = PopconfirmTitle;
(Popconfirm as any).Description = PopconfirmDescription;
(Popconfirm as any).Action = PopconfirmAction;
(Popconfirm as any).Cancel = PopconfirmCancel;

// Display names
Popconfirm.displayName = 'Popconfirm';
PopconfirmTrigger.displayName = 'PopconfirmTrigger';
PopconfirmContent.displayName = 'PopconfirmContent';
PopconfirmTitle.displayName = 'PopconfirmTitle';
PopconfirmDescription.displayName = 'PopconfirmDescription';
PopconfirmAction.displayName = 'PopconfirmAction';
PopconfirmCancel.displayName = 'PopconfirmCancel';

// Type exports
export type { PopconfirmPrimitiveProps as PopconfirmProps };
