/**
 * Affix - Sticky/fixed positioning when scrolling
 */

import { defineComponent, onCleanup } from '../core/component/index.js';
import type { WritableSignal } from '../core/reactivity/types.js';
import { signal } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

export interface AffixProps {
  offsetTop?: number;
  offsetBottom?: number;
  target?: () => HTMLElement | Window;
  onChange?: (affixed: boolean) => void;
  children?: any;
  [key: string]: any;
}

export const Affix = defineComponent<AffixProps>((props) => {
  const offsetTop = props.offsetTop;
  const offsetBottom = props.offsetBottom;
  const affixed: WritableSignal<boolean> = signal(false);
  const affixRef: { current: HTMLDivElement | null } = { current: null };

  const handleScroll = () => {
    const el = affixRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const shouldAffix = offsetTop !== undefined ? rect.top <= offsetTop : rect.bottom >= (window.innerHeight - (offsetBottom ?? 0));

    if (shouldAffix !== affixed()) {
      affixed.set(shouldAffix);
      props.onChange?.(shouldAffix);
    }
  };

  const target = props.target?.() ?? window;
  target.addEventListener('scroll', handleScroll);
  onCleanup(() => target.removeEventListener('scroll', handleScroll));

  return () => jsx('div', { ref: affixRef, 'data-affix': '', 'data-affixed': affixed() ? '' : undefined, style: { position: affixed() ? 'fixed' : 'static', top: offsetTop, bottom: offsetBottom }, children: props.children });
});
