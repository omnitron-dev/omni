/**
 * Toolbar Component
 *
 * A container for grouping buttons and controls.
 *
 * @example
 * ```tsx
 * <Toolbar aria-label="Formatting options">
 *   <Toolbar.Group>
 *     <Toolbar.Button>Bold</Toolbar.Button>
 *     <Toolbar.Button>Italic</Toolbar.Button>
 *     <Toolbar.Button>Underline</Toolbar.Button>
 *   </Toolbar.Group>
 *   <Toolbar.Separator />
 *   <Toolbar.Group>
 *     <Toolbar.Button>Undo</Toolbar.Button>
 *     <Toolbar.Button>Redo</Toolbar.Button>
 *   </Toolbar.Group>
 * </Toolbar>
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';

export interface ToolbarProps {
  /**
   * Toolbar orientation
   */
  orientation?: 'horizontal' | 'vertical';

  /**
   * ARIA label
   */
  'aria-label'?: string;

  /**
   * Loop keyboard navigation
   */
  loop?: boolean;

  children?: any;
  [key: string]: any;
}

export interface ToolbarGroupProps {
  children?: any;
  [key: string]: any;
}

export interface ToolbarButtonProps {
  /**
   * Whether the button is disabled
   */
  disabled?: boolean;

  /**
   * Click handler
   */
  onClick?: (e: Event) => void;

  /**
   * Button type
   */
  type?: 'button' | 'submit' | 'reset';

  children?: any;
  [key: string]: any;
}

export interface ToolbarLinkProps {
  /**
   * Link href
   */
  href?: string;

  /**
   * Target attribute
   */
  target?: string;

  children?: any;
  [key: string]: any;
}

export interface ToolbarSeparatorProps {
  [key: string]: any;
}

export interface ToolbarToggleGroupProps {
  /**
   * Selection type
   */
  type?: 'single' | 'multiple';

  /**
   * Selected value(s)
   */
  value?: string | string[];

  /**
   * Default value(s)
   */
  defaultValue?: string | string[];

  /**
   * Change handler
   */
  onValueChange?: (value: string | string[]) => void;

  children?: any;
  [key: string]: any;
}

export interface ToolbarToggleItemProps {
  /**
   * Item value
   */
  value: string;

  /**
   * Whether the item is disabled
   */
  disabled?: boolean;

  children?: any;
  [key: string]: any;
}

/**
 * Toolbar Root
 *
 * Container for toolbar items.
 */
export const Toolbar = defineComponent<ToolbarProps>((props) => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const orientation = props.orientation || 'horizontal';
    const loop = props.loop ?? true; // Default to true
    const isHorizontal = orientation === 'horizontal';

    const nextKey = isHorizontal ? 'ArrowRight' : 'ArrowDown';
    const prevKey = isHorizontal ? 'ArrowLeft' : 'ArrowUp';

    if (e.key !== nextKey && e.key !== prevKey && e.key !== 'Home' && e.key !== 'End') {
      return;
    }

    e.preventDefault();

    const toolbar = e.currentTarget as HTMLElement;
    const items = Array.from(
      toolbar.querySelectorAll('[data-toolbar-button]:not([disabled]), [data-toolbar-link]'),
    ) as HTMLElement[];

    if (items.length === 0) return;

    const currentIndex = items.findIndex((item) => item === document.activeElement);

    let nextIndex: number;

    if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = items.length - 1;
    } else if (e.key === nextKey) {
      nextIndex = currentIndex + 1;
      if (loop && nextIndex >= items.length) {
        nextIndex = 0;
      }
    } else {
      // prevKey
      nextIndex = currentIndex - 1;
      if (loop && nextIndex < 0) {
        nextIndex = items.length - 1;
      }
    }

    if (nextIndex >= 0 && nextIndex < items.length) {
      items[nextIndex]?.focus();
    }
  };

  return () => {
    const { orientation = 'horizontal', loop = true, children, ...restProps } = props;

    return jsx('div', {
      ...restProps,
      'data-toolbar': '',
      'data-orientation': orientation,
      role: 'toolbar',
      'aria-orientation': orientation,
      onKeyDown: handleKeyDown,
      children,
    });
  };
});

/**
 * Toolbar Group
 *
 * Groups related toolbar items.
 */
export const ToolbarGroup = defineComponent<ToolbarGroupProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('div', {
    ...restProps,
    'data-toolbar-group': '',
    role: 'group',
    children,
  });
});

/**
 * Toolbar Button
 *
 * Button within a toolbar.
 */
export const ToolbarButton = defineComponent<ToolbarButtonProps>((props) => {
  const handleClick = (e: Event) => {
    if (props.disabled) return;
    props.onClick?.(e);
  };

  return () => {
    const { type = 'button', disabled, onClick, children, ...restProps } = props;

    return jsx('button', {
      ...restProps,
      type,
      disabled,
      'data-toolbar-button': '',
      'data-disabled': disabled ? '' : undefined,
      onClick: handleClick,
      tabIndex: disabled ? -1 : 0,
      children,
    });
  };
});

/**
 * Toolbar Link
 *
 * Link within a toolbar.
 */
export const ToolbarLink = defineComponent<ToolbarLinkProps>((props) => () => {
  const { href, target, children, ...restProps } = props;

  return jsx('a', {
    ...restProps,
    href,
    target,
    'data-toolbar-link': '',
    tabIndex: 0,
    children,
  });
});

/**
 * Toolbar Separator
 *
 * Visual separator between toolbar items.
 */
export const ToolbarSeparator = defineComponent<ToolbarSeparatorProps>((props) => () => jsx('div', {
  ...props,
  'data-toolbar-separator': '',
  role: 'separator',
  'aria-orientation': 'vertical',
}));

/**
 * Toolbar Toggle Group
 *
 * Group of toggle buttons (like radio or checkbox group).
 */
export const ToolbarToggleGroup = defineComponent<ToolbarToggleGroupProps>((props) => () => {
  const {
    type = 'single',
    value,
    defaultValue,
    onValueChange,
    children,
    ...restProps
  } = props;

  // This is a simplified version - in a real implementation,
  // this would manage the toggle state
  return jsx('div', {
    ...restProps,
    'data-toolbar-toggle-group': '',
    'data-type': type,
    role: type === 'single' ? 'radiogroup' : 'group',
    children,
  });
});

/**
 * Toolbar Toggle Item
 *
 * Toggle button within a toggle group.
 */
export const ToolbarToggleItem = defineComponent<ToolbarToggleItemProps>((props) => () => {
  const { value, disabled, children, ...restProps } = props;

  return jsx('button', {
    ...restProps,
    type: 'button',
    'data-toolbar-toggle-item': '',
    'data-value': value,
    'data-disabled': disabled ? '' : undefined,
    disabled,
    role: 'radio',
    'aria-checked': 'false', // This would be managed by ToggleGroup
    tabIndex: disabled ? -1 : 0,
    children,
  });
});

// Attach sub-components
(Toolbar as any).Group = ToolbarGroup;
(Toolbar as any).Button = ToolbarButton;
(Toolbar as any).Link = ToolbarLink;
(Toolbar as any).Separator = ToolbarSeparator;
(Toolbar as any).ToggleGroup = ToolbarToggleGroup;
(Toolbar as any).ToggleItem = ToolbarToggleItem;

// Display names
Toolbar.displayName = 'Toolbar';
ToolbarGroup.displayName = 'Toolbar.Group';
ToolbarButton.displayName = 'Toolbar.Button';
ToolbarLink.displayName = 'Toolbar.Link';
ToolbarSeparator.displayName = 'Toolbar.Separator';
ToolbarToggleGroup.displayName = 'Toolbar.ToggleGroup';
ToolbarToggleItem.displayName = 'Toolbar.ToggleItem';
