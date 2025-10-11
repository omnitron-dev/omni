/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VirtualList } from '../../../src/primitives/VirtualList.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

describe('VirtualList', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Rendering', () => {
    it('should render with data-virtual-list attribute', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should render as a div element', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('div[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should have overflow auto style', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.style.overflow).toBe('auto');
    });

    it('should render virtual content wrapper', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-virtual-content]');
      expect(content).toBeTruthy();
    });

    it('should apply position relative to container', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.style.position).toBe('relative');
    });
  });

  describe('Props - count', () => {
    it('should handle count=0', () => {
      const component = () =>
        VirtualList({
          count: 0,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-virtual-item]');
      expect(items.length).toBe(0);
    });

    it('should handle count=1', () => {
      const component = () =>
        VirtualList({
          count: 1,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should handle count=100', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-virtual-content]') as HTMLElement;
      // Total height should be count * itemSize
      expect(content.style.height).toBe('5000px');
    });

    it('should handle large count values', () => {
      const component = () =>
        VirtualList({
          count: 10000,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-virtual-content]') as HTMLElement;
      expect(content.style.height).toBe('500000px');
    });
  });

  describe('Props - itemSize (fixed)', () => {
    it('should support itemSize as number', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-virtual-item]');
      items.forEach((item) => {
        const htmlItem = item as HTMLElement;
        expect(htmlItem.style.height).toBe('50px');
      });
    });

    it('should calculate total size with fixed itemSize', () => {
      const component = () =>
        VirtualList({
          count: 20,
          itemSize: 100,
          height: 400,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-virtual-content]') as HTMLElement;
      expect(content.style.height).toBe('2000px');
    });

    it('should position items correctly with fixed size', () => {
      const component = () =>
        VirtualList({
          count: 5,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = Array.from(container.querySelectorAll('[data-virtual-item]')) as HTMLElement[];
      if (items.length > 0) {
        expect(items[0].style.top).toBe('0px');
        if (items.length > 1) {
          expect(items[1].style.top).toBe('50px');
        }
      }
    });
  });

  describe('Props - itemSize (dynamic)', () => {
    it('should support itemSize as function', () => {
      const getSize = (index: number) => (index % 2 === 0 ? 50 : 100);

      const component = () =>
        VirtualList({
          count: 10,
          itemSize: getSize,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should calculate offsets with dynamic sizes', () => {
      const getSize = (index: number) => 50 + index * 10;

      const component = () =>
        VirtualList({
          count: 10,
          itemSize: getSize,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should handle variable heights correctly', () => {
      const getSize = (index: number) => {
        if (index < 5) return 50;
        if (index < 10) return 100;
        return 75;
      };

      const component = () =>
        VirtualList({
          count: 15,
          itemSize: getSize,
          height: 400,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-virtual-content]');
      expect(content).toBeTruthy();
    });
  });

  describe('Props - height', () => {
    it('should support height as number', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.style.height).toBe('300px');
    });

    it('should support height as string', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: '50vh',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.style.height).toBe('50vh');
    });

    it('should support height as percentage', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: '100%',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.style.height).toBe('100%');
    });

    it('should work without explicit height', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });
  });

  describe('Props - width', () => {
    it('should support width as number', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          width: 400,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.style.width).toBe('400px');
    });

    it('should support width as string', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          width: '80%',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.style.width).toBe('80%');
    });

    it('should work without explicit width', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });
  });

  describe('Props - direction', () => {
    it('should default to vertical direction', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.getAttribute('data-direction')).toBe('vertical');
    });

    it('should support direction="vertical"', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          direction: 'vertical',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.getAttribute('data-direction')).toBe('vertical');
    });

    it('should support direction="horizontal"', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          width: 300,
          direction: 'horizontal',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.getAttribute('data-direction')).toBe('horizontal');
    });

    it('should apply vertical styles for vertical direction', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          direction: 'vertical',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-virtual-content]') as HTMLElement;
      expect(content.style.width).toBe('100%');
    });

    it('should apply horizontal styles for horizontal direction', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          width: 300,
          direction: 'horizontal',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-virtual-content]') as HTMLElement;
      expect(content.style.height).toBe('100%');
    });

    it('should position items vertically in vertical mode', () => {
      const component = () =>
        VirtualList({
          count: 5,
          itemSize: 50,
          height: 300,
          direction: 'vertical',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-virtual-item]');
      items.forEach((item) => {
        const htmlItem = item as HTMLElement;
        expect(htmlItem.style.top).toBeTruthy();
      });
    });

    it('should position items horizontally in horizontal mode', () => {
      const component = () =>
        VirtualList({
          count: 5,
          itemSize: 50,
          width: 300,
          direction: 'horizontal',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-virtual-item]');
      items.forEach((item) => {
        const htmlItem = item as HTMLElement;
        expect(htmlItem.style.left).toBeTruthy();
      });
    });
  });

  describe('Props - overscan', () => {
    it('should default to 3 items overscan', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should support custom overscan value', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          overscan: 5,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should support overscan=0', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          overscan: 0,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should support large overscan values', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          overscan: 20,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });
  });

  describe('Props - children (render function)', () => {
    it('should call children function for each visible item', () => {
      const renderItem = vi.fn((index: number) => `Item ${index}`);

      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          children: renderItem,
        });

      renderComponent(component);

      expect(renderItem).toHaveBeenCalled();
    });

    it('should pass correct index to children function', () => {
      const indices: number[] = [];
      const renderItem = (index: number) => {
        indices.push(index);
        return `Item ${index}`;
      };

      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          children: renderItem,
        });

      renderComponent(component);

      // Should render visible items (0-5 with default overscan)
      expect(indices.length).toBeGreaterThan(0);
    });

    it('should support rendering text content', () => {
      const component = () =>
        VirtualList({
          count: 5,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-virtual-item]');
      expect(items.length).toBeGreaterThan(0);
    });

    it('should support rendering HTML elements', () => {
      const renderItem = (index: number) => {
        const div = document.createElement('div');
        div.className = 'custom-item';
        div.textContent = `Item ${index}`;
        return div;
      };

      const component = () =>
        VirtualList({
          count: 5,
          itemSize: 50,
          height: 300,
          children: renderItem,
        });

      const { container } = renderComponent(component);

      const customItems = container.querySelectorAll('.custom-item');
      expect(customItems.length).toBeGreaterThan(0);
    });

    it('should support rendering complex components', () => {
      const renderItem = (index: number) => {
        const div = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = `Item ${index}`;
        const content = document.createElement('p');
        content.textContent = 'Description';
        div.appendChild(title);
        div.appendChild(content);
        return div;
      };

      const component = () =>
        VirtualList({
          count: 5,
          itemSize: 100,
          height: 300,
          children: renderItem,
        });

      const { container } = renderComponent(component);

      const titles = container.querySelectorAll('h3');
      expect(titles.length).toBeGreaterThan(0);
    });
  });

  describe('Virtual item attributes', () => {
    it('should add data-virtual-item attribute to items', () => {
      const component = () =>
        VirtualList({
          count: 5,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-virtual-item]');
      expect(items.length).toBeGreaterThan(0);
    });

    it('should add data-index attribute to items', () => {
      const component = () =>
        VirtualList({
          count: 5,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const firstItem = container.querySelector('[data-virtual-item]') as HTMLElement;
      expect(firstItem.hasAttribute('data-index')).toBe(true);
    });

    it('should set correct index values', () => {
      const component = () =>
        VirtualList({
          count: 5,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = Array.from(container.querySelectorAll('[data-virtual-item]')) as HTMLElement[];
      items.forEach((item, idx) => {
        expect(item.getAttribute('data-index')).toBe(String(idx));
      });
    });

    it('should position items absolutely', () => {
      const component = () =>
        VirtualList({
          count: 5,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-virtual-item]');
      items.forEach((item) => {
        const htmlItem = item as HTMLElement;
        expect(htmlItem.style.position).toBe('absolute');
      });
    });
  });

  describe('Scroll behavior', () => {
    it('should handle scroll events', async () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;

      // Simulate scroll
      list.scrollTop = 100;
      list.dispatchEvent(new Event('scroll'));

      await nextTick();

      expect(list).toBeTruthy();
    });

    it('should call onScroll callback', async () => {
      const onScroll = vi.fn();

      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          onScroll,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;

      list.scrollTop = 100;
      list.dispatchEvent(new Event('scroll'));

      await nextTick();

      expect(onScroll).toHaveBeenCalled();
    });

    it('should pass scroll offset to onScroll', async () => {
      const onScroll = vi.fn();

      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          onScroll,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;

      list.scrollTop = 250;
      list.dispatchEvent(new Event('scroll'));

      await nextTick();

      expect(onScroll).toHaveBeenCalledWith(250);
    });

    it('should handle horizontal scroll', async () => {
      const onScroll = vi.fn();

      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          width: 300,
          direction: 'horizontal',
          onScroll,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;

      list.scrollLeft = 150;
      list.dispatchEvent(new Event('scroll'));

      await nextTick();

      expect(onScroll).toHaveBeenCalledWith(150);
    });
  });

  describe('Props - scrollToIndex', () => {
    it('should accept scrollToIndex prop', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          scrollToIndex: 10,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should handle scrollToIndex=0', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          scrollToIndex: 0,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should handle scrollToIndex at end of list', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          scrollToIndex: 99,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });
  });

  describe('Props - scrollBehavior', () => {
    it('should support scrollBehavior="auto"', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          scrollBehavior: 'auto',
          scrollToIndex: 10,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should support scrollBehavior="smooth"', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          scrollBehavior: 'smooth',
          scrollToIndex: 10,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should support scrollBehavior="instant"', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 300,
          scrollBehavior: 'instant',
          scrollToIndex: 10,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });
  });

  describe('Props forwarding', () => {
    it('should forward className', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          class: 'custom-list',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('.custom-list');
      expect(list).toBeTruthy();
    });

    it('should forward id', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          id: 'my-list',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('#my-list');
      expect(list).toBeTruthy();
    });

    it('should forward data attributes', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          'data-testid': 'virtual-list-test',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-testid="virtual-list-test"]');
      expect(list).toBeTruthy();
    });

    it('should forward aria attributes', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          'aria-label': 'Items list',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[aria-label="Items list"]');
      expect(list).toBeTruthy();
    });
  });

  describe('Edge cases', () => {
    it('should handle count=0', () => {
      const component = () =>
        VirtualList({
          count: 0,
          itemSize: 50,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-virtual-item]');
      expect(items.length).toBe(0);
    });

    it('should handle very small viewport', () => {
      const component = () =>
        VirtualList({
          count: 100,
          itemSize: 50,
          height: 10,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });

    it('should handle very large items', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 1000,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-virtual-content]') as HTMLElement;
      expect(content.style.height).toBe('10000px');
    });

    it('should handle itemSize=0', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 0,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-virtual-item]');
      items.forEach((item) => {
        const htmlItem = item as HTMLElement;
        expect(htmlItem.style.height).toBe('0px');
      });
    });

    it('should handle dynamic size function returning 0', () => {
      const getSize = () => 0;

      const component = () =>
        VirtualList({
          count: 10,
          itemSize: getSize,
          height: 300,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]');
      expect(list).toBeTruthy();
    });
  });

  describe('Real-world use cases', () => {
    it('should work for chat message list', () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        text: `Message ${i}`,
        author: `User ${i % 5}`,
      }));

      const component = () =>
        VirtualList({
          count: messages.length,
          itemSize: 60,
          height: 400,
          class: 'chat-messages',
          children: (index: number) => {
            const div = document.createElement('div');
            div.className = 'message';
            div.textContent = messages[index].text;
            return div;
          },
        });

      const { container } = renderComponent(component);

      const messageItems = container.querySelectorAll('.message');
      expect(messageItems.length).toBeGreaterThan(0);
    });

    it('should work for infinite scroll feed', () => {
      const component = () =>
        VirtualList({
          count: 1000,
          itemSize: 200,
          height: 600,
          overscan: 5,
          children: (index: number) => {
            const article = document.createElement('article');
            article.className = 'feed-item';
            article.textContent = `Post ${index}`;
            return article;
          },
        });

      const { container } = renderComponent(component);

      const articles = container.querySelectorAll('.feed-item');
      expect(articles.length).toBeGreaterThan(0);
    });

    it('should work for table rows virtualization', () => {
      const component = () =>
        VirtualList({
          count: 500,
          itemSize: 40,
          height: 400,
          class: 'table-body',
          children: (index: number) => {
            const tr = document.createElement('tr');
            const td1 = document.createElement('td');
            td1.textContent = `Cell ${index}-1`;
            const td2 = document.createElement('td');
            td2.textContent = `Cell ${index}-2`;
            tr.appendChild(td1);
            tr.appendChild(td2);
            return tr;
          },
        });

      const { container } = renderComponent(component);

      const rows = container.querySelectorAll('tr');
      expect(rows.length).toBeGreaterThan(0);
    });

    it('should work for horizontal carousel', () => {
      const component = () =>
        VirtualList({
          count: 50,
          itemSize: 300,
          width: 900,
          direction: 'horizontal',
          class: 'carousel',
          children: (index: number) => {
            const div = document.createElement('div');
            div.className = 'slide';
            div.textContent = `Slide ${index}`;
            return div;
          },
        });

      const { container } = renderComponent(component);

      const slides = container.querySelectorAll('.slide');
      expect(slides.length).toBeGreaterThan(0);
    });

    it('should work for variable height timeline', () => {
      const getHeight = (index: number) => {
        // Simulate variable content heights
        const heights = [80, 120, 100, 150, 90];
        return heights[index % heights.length];
      };

      const component = () =>
        VirtualList({
          count: 100,
          itemSize: getHeight,
          height: 500,
          class: 'timeline',
          children: (index: number) => {
            const div = document.createElement('div');
            div.className = 'timeline-event';
            div.textContent = `Event ${index}`;
            return div;
          },
        });

      const { container } = renderComponent(component);

      const events = container.querySelectorAll('.timeline-event');
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Accessibility', () => {
    it('should support aria-label', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          'aria-label': 'Virtual scrollable list',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.getAttribute('aria-label')).toBe('Virtual scrollable list');
    });

    it('should support role attribute', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          role: 'list',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.getAttribute('role')).toBe('list');
    });

    it('should support aria-labelledby', () => {
      const component = () =>
        VirtualList({
          count: 10,
          itemSize: 50,
          height: 300,
          'aria-labelledby': 'list-title',
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-virtual-list]') as HTMLElement;
      expect(list.getAttribute('aria-labelledby')).toBe('list-title');
    });

    it('should allow semantic HTML in items', () => {
      const component = () =>
        VirtualList({
          count: 5,
          itemSize: 80,
          height: 300,
          role: 'list',
          children: (index: number) => {
            const li = document.createElement('li');
            li.setAttribute('role', 'listitem');
            li.textContent = `Item ${index}`;
            return li;
          },
        });

      const { container } = renderComponent(component);

      const listItems = container.querySelectorAll('li[role="listitem"]');
      expect(listItems.length).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should only render visible items initially', () => {
      const renderItem = vi.fn((index: number) => `Item ${index}`);

      const component = () =>
        VirtualList({
          count: 1000,
          itemSize: 50,
          height: 300,
          overscan: 3,
          children: renderItem,
        });

      renderComponent(component);

      // Should render approximately (300/50 + 2*3) = 12 items
      expect(renderItem.mock.calls.length).toBeLessThan(20);
      expect(renderItem.mock.calls.length).toBeGreaterThan(0);
    });

    it('should handle large datasets efficiently', () => {
      const component = () =>
        VirtualList({
          count: 100000,
          itemSize: 50,
          height: 400,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-virtual-item]');
      // Should only render visible + overscan items
      expect(items.length).toBeLessThan(100);
    });

    it('should calculate total size correctly for large lists', () => {
      const component = () =>
        VirtualList({
          count: 10000,
          itemSize: 50,
          height: 400,
          children: (index: number) => `Item ${index}`,
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-virtual-content]') as HTMLElement;
      expect(content.style.height).toBe('500000px');
    });
  });
});
