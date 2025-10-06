/**
 * JSX Runtime Tests
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jsx, jsxs, Fragment } from '../../../src/jsx-runtime.js';
import { signal } from '../../../src/core/reactivity/signal.js';
import { defineComponent } from '../../../src/core/component/define.js';

describe('JSX Runtime', () => {
  describe('jsx()', () => {
    it('should create DOM element', () => {
      const element = jsx('div', null) as HTMLDivElement;

      expect(element).toBeInstanceOf(HTMLDivElement);
      expect(element.tagName).toBe('DIV');
    });

    it('should create element with props', () => {
      const element = jsx('div', {
        id: 'test',
        className: 'container',
      }) as HTMLDivElement;

      expect(element.id).toBe('test');
      expect(element.getAttribute('class')).toBe('container');
    });

    it('should create element with children', () => {
      const element = jsx('div', {
        children: 'Hello World',
      }) as HTMLDivElement;

      expect(element.textContent).toBe('Hello World');
    });

    it('should create element with multiple children', () => {
      const child1 = jsx('span', { children: 'Hello' });
      const child2 = jsx('span', { children: 'World' });

      const element = jsx('div', {
        children: [child1, child2],
      }) as HTMLDivElement;

      expect(element.children.length).toBe(2);
      expect(element.children[0]?.textContent).toBe('Hello');
      expect(element.children[1]?.textContent).toBe('World');
    });

    it('should handle numeric children', () => {
      const element = jsx('div', {
        children: 42,
      }) as HTMLDivElement;

      expect(element.textContent).toBe('42');
    });

    it('should handle null/undefined children', () => {
      const element1 = jsx('div', { children: null }) as HTMLDivElement;
      const element2 = jsx('div', { children: undefined }) as HTMLDivElement;

      expect(element1.textContent).toBe('');
      expect(element2.textContent).toBe('');
    });

    it('should filter out boolean children', () => {
      const element = jsx('div', {
        children: [true, false, 'text'],
      }) as HTMLDivElement;

      expect(element.textContent).toBe('text');
    });
  });

  describe('jsxs()', () => {
    it('should work identically to jsx()', () => {
      const el1 = jsx('div', { id: 'test' }) as HTMLDivElement;
      const el2 = jsxs('div', { id: 'test' }) as HTMLDivElement;

      expect(el1.tagName).toBe(el2.tagName);
      expect(el1.id).toBe(el2.id);
    });

    it('should handle static children', () => {
      const element = jsxs('ul', {
        children: [
          jsx('li', { children: '1' }),
          jsx('li', { children: '2' }),
          jsx('li', { children: '3' }),
        ],
      }) as HTMLUListElement;

      expect(element.children.length).toBe(3);
      expect(element.textContent).toBe('123');
    });
  });

  describe('Fragment', () => {
    it('should create document fragment', () => {
      const fragment = jsx(Fragment, {
        children: [
          jsx('div', { children: '1' }),
          jsx('div', { children: '2' }),
        ],
      }) as DocumentFragment;

      expect(fragment).toBeInstanceOf(DocumentFragment);
      expect(fragment.childNodes.length).toBe(2);
    });

    it('should work with single child', () => {
      const fragment = jsx(Fragment, {
        children: jsx('div', { children: 'test' }),
      }) as DocumentFragment;

      expect(fragment.childNodes.length).toBe(1);
      expect(fragment.textContent).toBe('test');
    });

    it('should work with text children', () => {
      const fragment = jsx(Fragment, {
        children: ['Hello', ' ', 'World'],
      }) as DocumentFragment;

      expect(fragment.textContent).toBe('Hello World');
    });
  });

  describe('Attributes', () => {
    it('should set string attributes', () => {
      const element = jsx('a', {
        href: 'https://example.com',
        target: '_blank',
      }) as HTMLAnchorElement;

      expect(element.href).toBe('https://example.com/');
      expect(element.target).toBe('_blank');
    });

    it('should set boolean attributes', () => {
      const element = jsx('button', {
        disabled: true,
      }) as HTMLButtonElement;

      expect(element.disabled).toBe(true);
      expect(element.hasAttribute('disabled')).toBe(true);
    });

    it('should remove false boolean attributes', () => {
      const element = jsx('button', {
        disabled: false,
      }) as HTMLButtonElement;

      expect(element.disabled).toBe(false);
      expect(element.hasAttribute('disabled')).toBe(false);
    });

    it('should handle data attributes', () => {
      const element = jsx('div', {
        'data-test-id': 'my-component',
        'data-value': '42',
      }) as HTMLDivElement;

      expect(element.getAttribute('data-test-id')).toBe('my-component');
      expect(element.getAttribute('data-value')).toBe('42');
    });
  });

  describe('Class handling', () => {
    it('should set className', () => {
      const element = jsx('div', {
        className: 'foo bar',
      }) as HTMLDivElement;

      expect(element.getAttribute('class')).toBe('foo bar');
    });

    it('should handle class attribute', () => {
      const element = jsx('div', {
        class: 'foo bar',
      }) as HTMLDivElement;

      expect(element.getAttribute('class')).toBe('foo bar');
    });

    it('should handle array of classes', () => {
      const element = jsx('div', {
        class: ['foo', 'bar', null, undefined, 'baz'],
      }) as HTMLDivElement;

      expect(element.getAttribute('class')).toBe('foo bar baz');
    });

    it('should handle class object', () => {
      const element = jsx('div', {
        class: {
          foo: true,
          bar: false,
          baz: true,
        },
      }) as HTMLDivElement;

      expect(element.getAttribute('class')).toBe('foo baz');
    });
  });

  describe('Style handling', () => {
    it('should set style object', () => {
      const element = jsx('div', {
        style: {
          color: 'red',
          fontSize: '16px',
        },
      }) as HTMLDivElement;

      expect(element.style.color).toBe('red');
      expect(element.style.fontSize).toBe('16px');
    });

    it('should convert camelCase to kebab-case', () => {
      const element = jsx('div', {
        style: {
          backgroundColor: 'blue',
        },
      }) as HTMLDivElement;

      expect(element.style.backgroundColor).toBe('blue');
    });
  });

  describe('Event handlers', () => {
    it('should attach onClick handler', () => {
      const handler = vi.fn();
      const element = jsx('button', {
        onClick: handler,
      }) as HTMLButtonElement;

      element.click();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should attach various event handlers', () => {
      const onClick = vi.fn();
      const onMouseOver = vi.fn();
      const onFocus = vi.fn();

      const element = jsx('button', {
        onClick,
        onMouseOver,
        onFocus,
      }) as HTMLButtonElement;

      element.click();
      element.dispatchEvent(new MouseEvent('mouseover'));
      element.dispatchEvent(new FocusEvent('focus'));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onMouseOver).toHaveBeenCalledTimes(1);
      expect(onFocus).toHaveBeenCalledTimes(1);
    });
  });

  describe('Ref handling', () => {
    it('should assign ref to element', () => {
      const ref = { current: null };
      const element = jsx('div', { ref }) as HTMLDivElement;

      expect(ref.current).toBe(element);
    });

    it('should work with createRef', () => {
      const ref = { current: null as HTMLButtonElement | null };
      const element = jsx('button', {
        ref,
        children: 'Click',
      }) as HTMLButtonElement;

      expect(ref.current).toBe(element);
      expect(ref.current?.textContent).toBe('Click');
    });
  });

  describe('Key handling', () => {
    it('should store key on element', () => {
      const element = jsx('div', null, 'my-key') as any;

      expect(element.__key).toBe('my-key');
    });

    it('should handle numeric keys', () => {
      const element = jsx('div', null, 42) as any;

      expect(element.__key).toBe(42);
    });
  });

  describe('SVG elements', () => {
    it('should create SVG element', () => {
      const element = jsx('svg', {
        width: 100,
        height: 100,
      }) as SVGSVGElement;

      expect(element).toBeInstanceOf(SVGSVGElement);
      expect(element.getAttribute('width')).toBe('100');
      expect(element.getAttribute('height')).toBe('100');
    });

    it('should create SVG children', () => {
      const circle = jsx('circle', {
        cx: 50,
        cy: 50,
        r: 40,
      }) as SVGCircleElement;

      expect(circle).toBeInstanceOf(SVGCircleElement);
    });
  });

  describe('Component rendering', () => {
    it('should render component', () => {
      const MyComponent = defineComponent<{ name: string }>((props) => {
        return () => jsx('div', { children: `Hello ${props.name}` });
      });

      const result = jsx(MyComponent, { name: 'World' }) as HTMLDivElement;

      expect(result).toBeInstanceOf(HTMLDivElement);
      expect(result.textContent).toBe('Hello World');
    });

    it('should pass props to component', () => {
      const MyComponent = defineComponent<{ count: number }>((props) => {
        return () => jsx('span', { children: `Count: ${props.count}` });
      });

      const result = jsx(MyComponent, { count: 42 }) as HTMLSpanElement;

      expect(result.textContent).toBe('Count: 42');
    });

    it('should pass children to component', () => {
      const Container = defineComponent<{ children: any }>((props) => {
        return () => jsx('div', { className: 'container', children: props.children });
      });

      const result = jsx(Container, {
        children: jsx('p', { children: 'Content' }),
      }) as HTMLDivElement;

      expect(result.getAttribute('class')).toBe('container');
      expect(result.querySelector('p')?.textContent).toBe('Content');
    });

    it('should handle nested components', () => {
      const Inner = defineComponent(() => {
        return () => jsx('span', { children: 'Inner' });
      });

      const Outer = defineComponent(() => {
        return () => jsx('div', { children: jsx(Inner, {}) });
      });

      const result = jsx(Outer, {}) as HTMLDivElement;

      expect(result.querySelector('span')?.textContent).toBe('Inner');
    });
  });

  describe('Error cases', () => {
    it('should throw on invalid element type', () => {
      expect(() => {
        jsx(123 as any, null);
      }).toThrow('Invalid JSX element type');
    });
  });

  describe('Complex scenarios', () => {
    it('should render complex nested structure', () => {
      const element = jsx('div', {
        className: 'app',
        children: [
          jsx('header', { children: jsx('h1', { children: 'Title' }) }),
          jsx('main', {
            children: [
              jsx('p', { children: 'Paragraph 1' }),
              jsx('p', { children: 'Paragraph 2' }),
            ],
          }),
          jsx('footer', { children: 'Footer' }),
        ],
      }) as HTMLDivElement;

      expect(element.querySelector('h1')?.textContent).toBe('Title');
      expect(element.querySelectorAll('p').length).toBe(2);
      expect(element.querySelector('footer')?.textContent).toBe('Footer');
    });

    it('should handle conditional rendering', () => {
      const showContent = true;
      const element = jsx('div', {
        children: showContent ? jsx('p', { children: 'Content' }) : null,
      }) as HTMLDivElement;

      expect(element.querySelector('p')?.textContent).toBe('Content');
    });

    it('should handle list rendering', () => {
      const items = ['A', 'B', 'C'];
      const element = jsx('ul', {
        children: items.map((item, i) =>
          jsx('li', { children: item }, `item-${i}`)
        ),
      }) as HTMLUListElement;

      expect(element.children.length).toBe(3);
      expect((element.children[0] as any).__key).toBe('item-0');
    });
  });
});
