/**
 * TagsInput - Input component for creating multiple tags/chips
 *
 * Features:
 * - Create tags by typing and pressing Enter or comma
 * - Delete tags with Backspace
 * - Paste multiple tags (splits by delimiter)
 * - Max tags limit
 * - Duplicate prevention
 * - Custom validation
 * - Keyboard navigation
 * - Controlled and uncontrolled modes
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface TagsInputProps {
  /** Controlled value (array of tags) */
  value?: string[];
  /** Value change callback */
  onValueChange?: (value: string[]) => void;
  /** Default value (uncontrolled) */
  defaultValue?: string[];
  /** Placeholder text */
  placeholder?: string;
  /** Delimiter for creating tags (default: Enter and comma) */
  delimiter?: string | string[];
  /** Maximum number of tags */
  maxTags?: number;
  /** Whether to allow duplicates */
  allowDuplicates?: boolean;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Custom tag validator (return error message or null) */
  validator?: (tag: string) => string | null;
  /** Called when a tag is added */
  onTagAdd?: (tag: string) => void;
  /** Called when a tag is removed */
  onTagRemove?: (tag: string) => void;
  /** Called when validation fails */
  onValidationError?: (tag: string, error: string) => void;
  /** Children */
  children?: any;
}

export interface TagsInputFieldProps {
  /** Placeholder text */
  placeholder?: string;
  /** Additional props */
  [key: string]: any;
}

export interface TagsInputTagProps {
  /** Tag value */
  value: string;
  /** Children */
  children?: any;
}

export interface TagsInputTagRemoveProps {
  /** Tag value to remove */
  value: string;
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

interface TagsInputContextValue {
  /** Current tags */
  tags: Signal<string[]>;
  /** Add tag */
  addTag: (tag: string) => void;
  /** Remove tag */
  removeTag: (tag: string) => void;
  /** Clear all tags */
  clearAll: () => void;
  /** Disabled state */
  disabled: boolean;
  /** Max tags */
  maxTags: number;
  /** Can add more tags */
  canAddMore: () => boolean;
  /** Input value */
  inputValue: Signal<string>;
  /** Set input value */
  setInputValue: (value: string) => void;
  /** Input ref */
  inputRef: { current: HTMLInputElement | null };
}

// ============================================================================
// Context
// ============================================================================

const TagsInputContext = createContext<TagsInputContextValue | null>(null);

const useTagsInputContext = (): TagsInputContextValue => {
  const context = useContext(TagsInputContext);
  if (!context) {
    throw new Error('TagsInput components must be used within a TagsInput');
  }
  return context;
};

// ============================================================================
// TagsInput Root
// ============================================================================

export const TagsInput = defineComponent<TagsInputProps>((props) => {
  const disabled = props.disabled ?? false;
  const maxTags = props.maxTags ?? 0;
  const allowDuplicates = props.allowDuplicates ?? false;

  // State
  const internalTags: WritableSignal<string[]> = signal<string[]>(
    props.defaultValue ?? [],
  );
  const inputValue: WritableSignal<string> = signal<string>('');

  const inputRef: { current: HTMLInputElement | null } = { current: null };

  const currentTags = (): string[] => {
    if (props.value !== undefined) {
      return props.value;
    }
    return internalTags();
  };

  const setTags = (newTags: string[]) => {
    if (props.value === undefined) {
      internalTags.set(newTags);
    }
    props.onValueChange?.(newTags);
  };

  const validateTag = (tag: string): string | null => {
    const trimmed = tag.trim();

    if (!trimmed) {
      return 'Tag cannot be empty';
    }

    if (!allowDuplicates && currentTags().includes(trimmed)) {
      return 'Tag already exists';
    }

    if (maxTags > 0 && currentTags().length >= maxTags) {
      return `Maximum ${maxTags} tags allowed`;
    }

    if (props.validator) {
      return props.validator(trimmed);
    }

    return null;
  };

  const addTag = (tag: string) => {
    if (disabled) return;

    const trimmed = tag.trim();
    const error = validateTag(trimmed);

    if (error) {
      props.onValidationError?.(trimmed, error);
      return;
    }

    const newTags = [...currentTags(), trimmed];
    setTags(newTags);
    props.onTagAdd?.(trimmed);
    inputValue.set('');
  };

  const removeTag = (tag: string) => {
    if (disabled) return;

    const newTags = currentTags().filter((t) => t !== tag);
    setTags(newTags);
    props.onTagRemove?.(tag);
  };

  const clearAll = () => {
    if (disabled) return;
    setTags([]);
  };

  const canAddMore = (): boolean => {
    if (maxTags === 0) return true;
    return currentTags().length < maxTags;
  };

  const setInputValue = (value: string) => {
    inputValue.set(value);
  };

  const contextValue: TagsInputContextValue = {
    tags: computed(() => currentTags()),
    addTag,
    removeTag,
    clearAll,
    disabled,
    maxTags,
    canAddMore,
    inputValue: computed(() => inputValue()),
    setInputValue,
    inputRef,
  };

  return () =>
    jsx(TagsInputContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-tags-input': '',
        'data-disabled': disabled ? '' : undefined,
        role: 'group',
        'aria-label': 'Tags input',
        children: props.children,
      }),
    });
});

// ============================================================================
// TagsInput Field
// ============================================================================

export const TagsInputField = defineComponent<TagsInputFieldProps>((props) => {
  const context = useTagsInputContext();

  const getDelimiters = (): string[] => {
    const parentProps = (context as any).props;
    const delimiter = parentProps?.delimiter || ['Enter', ','];
    return Array.isArray(delimiter) ? delimiter : [delimiter];
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (context.disabled) return;

    const delimiters = getDelimiters();

    if (e.key === 'Backspace' && context.inputValue() === '') {
      // Remove last tag on backspace when input is empty
      e.preventDefault();
      const tags = context.tags();
      if (tags.length > 0) {
        context.removeTag(tags[tags.length - 1] as string);
      }
    } else if (e.key === 'Enter' || delimiters.includes(e.key)) {
      e.preventDefault();
      const value = context.inputValue();
      if (value.trim()) {
        context.addTag(value);
      }
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    let value = target.value;

    // Check for delimiter characters in the input
    const delimiters = getDelimiters();
    const hasDelimiter = delimiters.some((d) => d !== 'Enter' && value.includes(d));

    if (hasDelimiter) {
      // Split by delimiters and add multiple tags
      const delimiter = delimiters.find((d) => d !== 'Enter' && value.includes(d));
      if (delimiter) {
        const tags = value.split(delimiter).filter((t) => t.trim());
        tags.forEach((tag) => {
          if (tag.trim()) {
            context.addTag(tag);
          }
        });
        value = '';
      }
    }

    context.setInputValue(value);
  };

  const handlePaste = (e: ClipboardEvent) => {
    const pastedText = e.clipboardData?.getData('text') || '';
    const delimiters = getDelimiters().filter((d) => d !== 'Enter');

    // Check if pasted text contains delimiters
    const hasDelimiter = delimiters.some((d) => pastedText.includes(d));

    if (hasDelimiter) {
      e.preventDefault();
      const delimiter = delimiters.find((d) => pastedText.includes(d));
      if (delimiter) {
        const tags = pastedText.split(delimiter).filter((t) => t.trim());
        tags.forEach((tag) => {
          if (tag.trim()) {
            context.addTag(tag);
          }
        });
      }
    }
  };

  return () => {
    const { placeholder = 'Add tag...', ...rest } = props;

    return jsx('input', {
      ref: context.inputRef,
      type: 'text',
      'data-tags-input-field': '',
      placeholder: context.canAddMore() ? placeholder : '',
      value: context.inputValue(),
      disabled: context.disabled || !context.canAddMore(),
      onInput: handleInput,
      onKeyDown: handleKeyDown,
      onPaste: handlePaste,
      'aria-label': 'Tag input field',
      ...rest,
    });
  };
});

// ============================================================================
// TagsInput Tag
// ============================================================================

export const TagsInputTag = defineComponent<TagsInputTagProps>((props) => () => {
    const { value, children } = props;

    return jsx('div', {
      'data-tags-input-tag': '',
      'data-value': value,
      children: children ?? value,
    });
  });

// ============================================================================
// TagsInput Tag Remove
// ============================================================================

export const TagsInputTagRemove = defineComponent<TagsInputTagRemoveProps>((props) => {
  const context = useTagsInputContext();

  const handleClick = (e: Event) => {
    e.stopPropagation();
    context.removeTag(props.value);
  };

  return () => {
    const { value, children = '×', ...rest } = props;

    return jsx('button', {
      type: 'button',
      'data-tags-input-tag-remove': '',
      onClick: handleClick,
      disabled: context.disabled,
      'aria-label': `Remove tag ${value}`,
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(TagsInput as any).Field = TagsInputField;
(TagsInput as any).Tag = TagsInputTag;
(TagsInput as any).TagRemove = TagsInputTagRemove;

// ============================================================================
// Export types
// ============================================================================

export type { TagsInputContextValue };
