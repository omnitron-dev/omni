/**
 * @fileoverview Comprehensive tests for SSR Engine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderToString,
  renderToStaticMarkup,
  collectData,
  extractStyles,
  getSSRContext,
  setSSRContext,
} from '../../src/server/ssr.js';
import { VNodeType } from '../../src/reconciler/vnode.js';
import type { SSRContext } from '../../src/server/types.js';

describe('SSR Engine', () => {
  beforeEach(() => {
    // Reset SSR context before each test
    setSSRContext(null);
  });

  afterEach(() => {
    // Clean up after each test
    setSSRContext(null);
  });

  describe('renderToString', () => {
    it('should render simple component to HTML string', async () => {
      const SimpleComponent = () => 'Hello World';

      const result = await renderToString(SimpleComponent);

      expect(result.html).toBe('Hello World');
    });

    it('should render component with props', async () => {
      const ComponentWithProps = (props: { name: string }) => `Hello ${props.name}`;

      const result = await renderToString(ComponentWithProps, {
        props: { name: 'Alice' },
      });

      expect(result.html).toBe('Hello Alice');
    });

    it('should handle complex nested components', async () => {
      const Child = (props: { text: string }) => `<span>${props.text}</span>`;
      const Parent = () => `<div>${Child({ text: 'Child 1' })}${Child({ text: 'Child 2' })}</div>`;

      const result = await renderToString(Parent);

      expect(result.html).toContain('<div>');
      expect(result.html).toContain('<span>Child 1</span>');
      expect(result.html).toContain('<span>Child 2</span>');
    });

    it('should render async components', async () => {
      const AsyncComponent = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'Async Content';
      };

      const result = await renderToString(AsyncComponent);

      expect(result.html).toBe('Async Content');
    });

    it('should handle timeout for slow async operations', async () => {
      const SlowComponent = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        return 'Never rendered';
      };

      await expect(
        renderToString(SlowComponent, { timeout: 100 })
      ).rejects.toThrow('SSR render timeout');
    });

    it('should extract signal values during rendering', async () => {
      const signal = (value: any) => {
        const fn = () => value;
        fn.peek = () => value;
        return fn;
      };

      const count = signal(42);
      const ComponentWithSignal = () => `Count: ${count()}`;

      const result = await renderToString(ComponentWithSignal);

      expect(result.html).toBe('Count: 42');
    });

    it('should handle null and undefined components', async () => {
      const result1 = await renderToString(null);
      expect(result1.html).toBe('');

      const result2 = await renderToString(undefined);
      expect(result2.html).toBe('');
    });

    it('should handle primitive values', async () => {
      const result1 = await renderToString(() => 'string');
      expect(result1.html).toBe('string');

      const result2 = await renderToString(() => 123);
      expect(result2.html).toBe('123');

      const result3 = await renderToString(() => true);
      expect(result3.html).toBe('true');
    });

    it('should escape HTML special characters', async () => {
      const ComponentWithHTML = () => '<script>alert("xss")</script>';

      const result = await renderToString(ComponentWithHTML);

      expect(result.html).not.toContain('<script>');
      expect(result.html).toContain('&lt;script&gt;');
    });

    it('should collect data during rendering', async () => {
      const ComponentWithData = () => {
        const context = getSSRContext();
        if (context) {
          collectData('user', { id: 1, name: 'Alice' });
        }
        return 'Component';
      };

      const result = await renderToString(ComponentWithData);

      expect(result.data).toBeDefined();
      expect(result.data?.user).toEqual({ id: 1, name: 'Alice' });
    });

    it('should collect styles when enabled', async () => {
      const ComponentWithStyles = () => {
        const context = getSSRContext();
        if (context) {
          extractStyles('body { margin: 0; }');
        }
        return 'Styled Component';
      };

      const result = await renderToString(ComponentWithStyles, {
        collectStyles: true,
      });

      expect(result.styles).toBeDefined();
      expect(result.styles).toContain('body { margin: 0; }');
    });

    it('should handle arrays (fragments)', async () => {
      const Fragment = () => ['Item 1', 'Item 2', 'Item 3'];

      const result = await renderToString(Fragment);

      expect(result.html).toBe('Item 1Item 2Item 3');
    });

    it('should handle VNode elements', async () => {
      const vnode = {
        type: VNodeType.ELEMENT,
        tag: 'div',
        props: { class: 'test' },
        children: [
          {
            type: VNodeType.TEXT,
            text: 'VNode Content',
            tag: '',
            props: null,
            children: [],
          },
        ],
      };

      const ComponentWithVNode = () => vnode;

      const result = await renderToString(ComponentWithVNode);

      expect(result.html).toContain('<div');
      expect(result.html).toContain('class="test"');
      expect(result.html).toContain('VNode Content');
      expect(result.html).toContain('</div>');
    });
  });

  describe('renderToStaticMarkup', () => {
    it('should render static HTML without hydration data', async () => {
      const StaticComponent = () => '<div>Static Content</div>';

      const result = await renderToStaticMarkup(StaticComponent);

      expect(result.html).toBe('<div>Static Content</div>');
      expect(result.styles).toBeUndefined();
    });

    it('should collect styles when enabled', async () => {
      const ComponentWithStyles = () => {
        const context = getSSRContext();
        if (context) {
          extractStyles('.static { color: red; }');
        }
        return 'Static';
      };

      const result = await renderToStaticMarkup(ComponentWithStyles, {
        collectStyles: true,
      });

      expect(result.styles).toBeDefined();
      expect(result.styles).toContain('.static { color: red; }');
    });

    it('should not collect hydration data', async () => {
      const ComponentWithData = () => {
        const context = getSSRContext();
        if (context) {
          collectData('test', { value: 123 });
        }
        return 'Component';
      };

      const result = await renderToStaticMarkup(ComponentWithData);

      // Static markup doesn't return data
      expect(result).not.toHaveProperty('data');
    });

    it('should handle complex static pages', async () => {
      const Header = () => '<header>Header</header>';
      const Footer = () => '<footer>Footer</footer>';
      const StaticPage = () => `${Header()}<main>Content</main>${Footer()}`;

      const result = await renderToStaticMarkup(StaticPage);

      expect(result.html).toContain('<header>Header</header>');
      expect(result.html).toContain('<main>Content</main>');
      expect(result.html).toContain('<footer>Footer</footer>');
    });
  });

  describe('SSR Context', () => {
    it('should create and access SSR context', async () => {
      const ComponentWithContext = () => {
        const context = getSSRContext();
        expect(context).toBeDefined();
        expect(context?.data).toBeInstanceOf(Map);
        expect(context?.styles).toBeInstanceOf(Set);
        return 'Component';
      };

      await renderToString(ComponentWithContext);
    });

    it('should reset context after rendering', async () => {
      const Component = () => 'Test';

      await renderToString(Component);

      const context = getSSRContext();
      expect(context).toBeNull();
    });

    it('should preserve previous context', async () => {
      const previousContext: SSRContext = {
        data: new Map(),
        styles: new Set(),
        islands: [],
        async: {
          pending: new Set(),
          completed: false,
        },
      };

      setSSRContext(previousContext);

      const Component = () => 'Test';
      await renderToString(Component);

      const currentContext = getSSRContext();
      expect(currentContext).toBe(previousContext);
    });
  });

  describe('Island Architecture', () => {
    it('should detect interactive components', async () => {
      const InteractiveComponent = (props: { onClick: () => void }) => '<button>Click Me</button>';
      InteractiveComponent.__island = true;

      const result = await renderToString(
        InteractiveComponent,
        { islands: true, props: { onClick: () => {} } }
      );

      expect(result.islands).toBeDefined();
      expect(result.islands?.length).toBeGreaterThan(0);
    });

    it('should generate island markers with IDs', async () => {
      const Island = () => '<div>Island</div>';
      Island.__island = true;

      const result = await renderToString(Island, { islands: true });

      expect(result.islands).toBeDefined();
      if (result.islands && result.islands.length > 0) {
        const island = result.islands[0];
        expect(island.id).toMatch(/^island-\d+$/);
        expect(island.strategy).toBe('idle');
      }
    });

    it('should render island placeholders', async () => {
      const Island = () => 'Interactive';
      Island.__island = true;

      const result = await renderToString(Island, { islands: true });

      expect(result.html).toContain('data-island');
    });
  });

  describe('Error Handling', () => {
    it('should handle rendering errors gracefully', async () => {
      const ErrorComponent = () => {
        throw new Error('Rendering error');
      };

      await expect(renderToString(ErrorComponent)).rejects.toThrow(
        'Rendering error'
      );
    });

    it('should log errors to console', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      const ErrorComponent = () => {
        throw new Error('Test error');
      };

      try {
        await renderToString(ErrorComponent);
      } catch {
        // Expected
      }

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('Async Operations', () => {
    it('should track pending async operations', async () => {
      let contextDuringRender: SSRContext | null = null;

      const AsyncComponent = async () => {
        contextDuringRender = getSSRContext();
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'Async';
      };

      await renderToString(AsyncComponent);

      expect(contextDuringRender?.async.completed).toBe(true);
    });

    it('should wait for multiple async operations', async () => {
      const AsyncComponent = () => {
        const promise1 = new Promise((resolve) =>
          setTimeout(() => resolve('A'), 10)
        );
        const promise2 = new Promise((resolve) =>
          setTimeout(() => resolve('B'), 20)
        );

        return Promise.all([promise1, promise2]).then((results) =>
          results.join('')
        );
      };

      const result = await renderToString(AsyncComponent);

      expect(result.html).toBe('AB');
    });

    it('should handle async timeout', async () => {
      const SlowAsync = async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return 'Slow';
      };

      await expect(
        renderToString(SlowAsync, { timeout: 100 })
      ).rejects.toThrow();
    });
  });

  describe('VNode Rendering', () => {
    it('should render self-closing tags', async () => {
      const vnode = {
        type: VNodeType.ELEMENT,
        tag: 'img',
        props: { src: '/image.jpg', alt: 'Test' },
        children: [],
      };

      const Component = () => vnode;
      const result = await renderToString(Component);

      expect(result.html).toContain('<img');
      expect(result.html).toContain('src="/image.jpg"');
      expect(result.html).toContain('/>');
    });

    it('should handle className prop', async () => {
      const vnode = {
        type: VNodeType.ELEMENT,
        tag: 'div',
        props: { className: 'test-class' },
        children: [],
      };

      const Component = () => vnode;
      const result = await renderToString(Component);

      expect(result.html).toContain('class="test-class"');
    });

    it('should handle style objects', async () => {
      const vnode = {
        type: VNodeType.ELEMENT,
        tag: 'div',
        props: {
          style: {
            color: 'red',
            fontSize: '16px',
            backgroundColor: 'blue',
          },
        },
        children: [],
      };

      const Component = () => vnode;
      const result = await renderToString(Component);

      expect(result.html).toContain('style=');
      expect(result.html).toContain('color:red');
      expect(result.html).toContain('font-size:16px');
      expect(result.html).toContain('background-color:blue');
    });

    it('should skip event handlers', async () => {
      const vnode = {
        type: VNodeType.ELEMENT,
        tag: 'button',
        props: {
          onClick: () => console.log('clicked'),
          onMouseOver: () => console.log('hover'),
          id: 'btn',
        },
        children: [],
      };

      const Component = () => vnode;
      const result = await renderToString(Component);

      expect(result.html).not.toContain('onClick');
      expect(result.html).not.toContain('onMouseOver');
      expect(result.html).toContain('id="btn"');
    });

    it('should handle boolean attributes', async () => {
      const vnode = {
        type: VNodeType.ELEMENT,
        tag: 'input',
        props: {
          type: 'checkbox',
          checked: true,
          disabled: false,
        },
        children: [],
      };

      const Component = () => vnode;
      const result = await renderToString(Component);

      expect(result.html).toContain('checked');
      expect(result.html).not.toContain('disabled');
    });

    it('should render fragments', async () => {
      const vnode = {
        type: VNodeType.FRAGMENT,
        tag: '',
        props: null,
        children: [
          {
            type: VNodeType.TEXT,
            text: 'Fragment 1',
            tag: '',
            props: null,
            children: [],
          },
          {
            type: VNodeType.TEXT,
            text: 'Fragment 2',
            tag: '',
            props: null,
            children: [],
          },
        ],
      };

      const Component = () => vnode;
      const result = await renderToString(Component);

      expect(result.html).toBe('Fragment 1Fragment 2');
    });
  });

  describe('Data Collection', () => {
    it('should collect multiple data entries', async () => {
      const Component = () => {
        collectData('user', { id: 1, name: 'Alice' });
        collectData('posts', [{ id: 1, title: 'Post 1' }]);
        collectData('settings', { theme: 'dark' });
        return 'Component';
      };

      const result = await renderToString(Component);

      expect(result.data?.user).toEqual({ id: 1, name: 'Alice' });
      expect(result.data?.posts).toEqual([{ id: 1, title: 'Post 1' }]);
      expect(result.data?.settings).toEqual({ theme: 'dark' });
    });

    it('should handle collectData without context', () => {
      setSSRContext(null);

      // Should not throw
      expect(() => collectData('test', { value: 123 })).not.toThrow();
    });
  });

  describe('Style Extraction', () => {
    it('should extract multiple styles', async () => {
      const Component = () => {
        extractStyles('body { margin: 0; }');
        extractStyles('.app { padding: 1rem; }');
        extractStyles('h1 { color: blue; }');
        return 'Component';
      };

      const result = await renderToString(Component, { collectStyles: true });

      expect(result.styles).toHaveLength(3);
      expect(result.styles).toContain('body { margin: 0; }');
      expect(result.styles).toContain('.app { padding: 1rem; }');
      expect(result.styles).toContain('h1 { color: blue; }');
    });

    it('should deduplicate styles', async () => {
      const Component = () => {
        extractStyles('body { margin: 0; }');
        extractStyles('body { margin: 0; }'); // Duplicate
        return 'Component';
      };

      const result = await renderToString(Component, { collectStyles: true });

      expect(result.styles).toHaveLength(1);
    });

    it('should handle extractStyles without context', () => {
      setSSRContext(null);

      // Should not throw
      expect(() => extractStyles('body { margin: 0; }')).not.toThrow();
    });
  });
});
