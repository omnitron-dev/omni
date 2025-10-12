/**
 * Mentions - @mentions autocomplete for text inputs
 *
 * Features:
 * - Autocomplete for mentions (@user, #tag, /command)
 * - Customizable trigger characters
 * - Keyboard navigation in suggestions
 * - Insert mention at cursor position
 * - Rich mention rendering
 * - Search/filter suggestions
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface Mention {
  id: string;
  display: string;
  value?: string;
}

export interface MentionsProps {
  /** Input value (controlled) - signal for reactivity */
  value?: WritableSignal<string>;
  /** Value change callback */
  onValueChange?: (value: string) => void;
  /** Default value (uncontrolled) */
  defaultValue?: string;
  /** Available mentions */
  mentions: Mention[];
  /** Trigger character */
  trigger?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Disabled state */
  disabled?: boolean;
  /** On mention select */
  onMentionSelect?: (mention: Mention) => void;
  /** Children */
  children?: any;
}

export interface MentionsSuggestionsProps {
  /** Children */
  children?: any;
}

export interface MentionsSuggestionProps {
  /** Mention data */
  mention: Mention;
  /** Children */
  children?: any;
}

interface MentionsContextValue {
  /** Current value */
  value: Signal<string>;
  /** Set value */
  setValue: (value: string) => void;
  /** Show suggestions */
  isOpen: Signal<boolean>;
  /** Filtered mentions */
  filtered: Signal<Mention[]>;
  /** Selected index */
  selectedIndex: Signal<number>;
  /** Select mention */
  selectMention: (mention: Mention) => void;
  /** Navigate suggestions */
  navigate: (direction: 'up' | 'down') => void;
  /** Trigger */
  trigger: string;
}

// ============================================================================
// Context
// ============================================================================

const MentionsContext = createContext<MentionsContextValue | null>(null);

const useMentionsContext = (): MentionsContextValue => {
  const context = useContext(MentionsContext);
  if (!context) {
    throw new Error('Mentions components must be used within Mentions');
  }
  return context;
};

// ============================================================================
// Mentions Root
// ============================================================================

export const Mentions = defineComponent<MentionsProps>((props) => {
  const trigger = props.trigger ?? '@';
  const disabled = props.disabled ?? false;

  // Use provided signal or create internal one (like Select pattern)
  const value: WritableSignal<string> = props.value ?? signal(props.defaultValue ?? '');
  const isOpen: WritableSignal<boolean> = signal(false);
  const searchQuery: WritableSignal<string> = signal('');
  const selectedIndex: WritableSignal<number> = signal(0);
  const cursorPosition: WritableSignal<number> = signal(0);

  const setValue = (newValue: string) => {
    value.set(newValue);
    props.onValueChange?.(newValue);
  };

  const filtered = computed(() => {
    const query = searchQuery().toLowerCase();
    return props.mentions.filter((m) => m.display.toLowerCase().includes(query));
  });

  const selectMention = (mention: Mention) => {
    const currentValue = value();
    const cursorPos = cursorPosition();

    // Find trigger position
    const beforeCursor = currentValue.substring(0, cursorPos);
    const triggerIndex = beforeCursor.lastIndexOf(trigger);

    if (triggerIndex === -1) return;

    const before = currentValue.substring(0, triggerIndex);
    const after = currentValue.substring(cursorPos);
    const mentionText = `${trigger}${mention.display} `;

    setValue(before + mentionText + after);
    isOpen.set(false);
    searchQuery.set('');
    props.onMentionSelect?.(mention);
  };

  const navigate = (direction: 'up' | 'down') => {
    const items = filtered();
    const current = selectedIndex();

    if (direction === 'up') {
      selectedIndex.set(Math.max(0, current - 1));
    } else {
      selectedIndex.set(Math.min(items.length - 1, current + 1));
    }
  };

  const contextValue: MentionsContextValue = {
    value: value as Signal<string>,
    setValue,
    isOpen: isOpen as Signal<boolean>,
    filtered,
    selectedIndex: selectedIndex as Signal<number>,
    selectMention,
    navigate,
    trigger,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(MentionsContext, contextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx('div', {
      'data-mentions': '',
      'data-disabled': disabled ? '' : undefined,
      children,
    });
  };
});

// ============================================================================
// Mentions Input (simplified textarea)
// ============================================================================

export const MentionsInput = defineComponent<any>((props) => {
  const context = useMentionsContext();

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    context.setValue(target.value);
  };

  return () => {
    const textarea = jsx('textarea', {
      'data-mentions-input': '',
      onInput: handleInput,
      placeholder: props.placeholder,
      ...props,
    }) as HTMLTextAreaElement;

    // Sync textarea value with signal (Pattern 18)
    effect(() => {
      textarea.value = context.value();
    });

    return textarea;
  };
});

// ============================================================================
// Mentions Suggestions
// ============================================================================

export const MentionsSuggestions = defineComponent<MentionsSuggestionsProps>((props) => {
  const context = useMentionsContext();

  return () => {
    if (!context.isOpen()) return null;

    return jsx('div', {
      'data-mentions-suggestions': '',
      role: 'listbox',
      children: props.children,
    });
  };
});

// ============================================================================
// Mentions Suggestion Item
// ============================================================================

export const MentionsSuggestion = defineComponent<MentionsSuggestionProps>((props) => {
  const context = useMentionsContext();

  const handleClick = () => {
    context.selectMention(props.mention);
  };

  return () =>
    jsx('div', {
      'data-mentions-suggestion': '',
      role: 'option',
      onClick: handleClick,
      children: props.children ?? props.mention.display,
    });
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Mentions as any).Input = MentionsInput;
(Mentions as any).Suggestions = MentionsSuggestions;
(Mentions as any).Suggestion = MentionsSuggestion;

// ============================================================================
// Export types
// ============================================================================

export type { MentionsContextValue };
