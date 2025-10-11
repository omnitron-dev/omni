/**
 * Affix - Sticky/fixed positioning when scrolling
 */

import { defineComponent, onCleanup } from '../core/component/index.js';
import type { WritableSignal } from '../core/reactivity/types.js';
import { signal } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
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
  let affixRef: HTMLDivElement | null = null;

  const handleScroll = () => {
    const el = affixRef;
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

  return () => {
    const refCallback = (el: HTMLDivElement | null) => {
      if (!el) return;
      affixRef = el;

      // Set up reactive effect for attributes and styles
      effect(() => {
        const isAffixed = affixed();
        if (isAffixed) {
          el.setAttribute('data-affixed', '');
          el.style.position = 'fixed';
        } else {
          el.removeAttribute('data-affixed');
          el.style.position = 'static';
        }

        if (offsetTop !== undefined) {
          el.style.top = `${offsetTop}px`;
        }
        if (offsetBottom !== undefined) {
          el.style.bottom = `${offsetBottom}px`;
        }
      });
    };

    return jsx('div', {
      ref: refCallback,
      'data-affix': '',
      children: props.children,
    });
  };
});
