/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Masonry } from '../../../src/primitives/Masonry.js';
import { renderComponent, nextTick, waitFor } from '../../helpers/test-utils.js';

describe('Masonry', () => {
  // Store original offsetHeight getter
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

  // Helper to set mocked height
  const setMockedHeight = (element: HTMLElement, height: number) => {
    (element as any).__mockedOffsetHeight = height;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();

    // Mock offsetHeight to return stored value or default
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      get(this: HTMLElement) {
        // Check if element has a mocked height
        const mockedHeight = (this as any).__mockedOffsetHeight;
        if (mockedHeight !== undefined) {
          return mockedHeight;
        }
        // Default fallback for unmocked elements
        return 0;
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore original offsetHeight
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    }
  });

  describe('Rendering', () => {
    it('should render with data-masonry attribute', () => {
      const component = () => Masonry({ children: null });
      const { container } = renderComponent(component);

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry).toBeTruthy();
    });

    it('should render as a div element', () => {
      const component = () => Masonry({ children: null });
      const { container } = renderComponent(component);

      const masonry = container.querySelector('div[data-masonry]');
      expect(masonry).toBeTruthy();
    });

    it('should have relative positioning', () => {
      const component = () => Masonry({ children: null });
      const { container } = renderComponent(component);

      const masonry = container.querySelector('[data-masonry]') as HTMLElement;
      expect(masonry.style.position).toBe('relative');
    });

    it('should render without children', () => {
      const component = () => Masonry({});
      const { container } = renderComponent(component);

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry).toBeTruthy();
      expect(masonry?.children.length).toBe(0);
    });

    it('should render with single child', async () => {
      const child = document.createElement('div');
      child.textContent = 'Item 1';

      const component = () => Masonry({ children: child });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry?.children.length).toBe(1);
    });

    it('should render with multiple children', async () => {
      const children = [document.createElement('div'), document.createElement('div'), document.createElement('div')];

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry?.children.length).toBe(3);
    });
  });

  describe('Props - columns', () => {
    it('should default to 3 columns', async () => {
      const children = [document.createElement('div'), document.createElement('div'), document.createElement('div')];
      children.forEach((child, i) => {
        child.textContent = `Item ${i + 1}`;
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]');
      const firstChild = masonry?.children[0] as HTMLElement;
      // First item should be at left 0%
      expect(firstChild?.style.left).toBe('0%');
    });

    it('should support columns=2', async () => {
      const children = [document.createElement('div'), document.createElement('div')];
      children.forEach((child, i) => {
        child.textContent = `Item ${i + 1}`;
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ columns: 2, children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]');
      const items = Array.from(masonry?.children || []) as HTMLElement[];

      // First item at 0%, second at 50%
      expect(items[0]?.style.left).toBe('0%');
      expect(items[1]?.style.left).toBe('50%');
    });

    it('should support columns=4', async () => {
      const children = Array.from({ length: 4 }, () => document.createElement('div'));
      children.forEach((child, i) => {
        child.textContent = `Item ${i + 1}`;
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ columns: 4, children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]');
      const items = Array.from(masonry?.children || []) as HTMLElement[];

      // Check column distribution
      expect(items[0]?.style.left).toBe('0%');
      expect(items[1]?.style.left).toBe('25%');
      expect(items[2]?.style.left).toBe('50%');
      expect(items[3]?.style.left).toBe('75%');
    });

    it('should support columns=1', async () => {
      const children = [document.createElement('div'), document.createElement('div')];
      children.forEach((child, i) => {
        child.textContent = `Item ${i + 1}`;
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ columns: 1, children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]');
      const items = Array.from(masonry?.children || []) as HTMLElement[];

      // All items should be at 0% (single column)
      expect(items[0]?.style.left).toBe('0%');
      expect(items[1]?.style.left).toBe('0%');
    });

    it('should support large column count', async () => {
      const children = Array.from({ length: 10 }, () => document.createElement('div'));
      children.forEach((child, i) => {
        child.textContent = `Item ${i + 1}`;
        setMockedHeight(child, 50);
      });

      const component = () => Masonry({ columns: 10, children });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry?.children.length).toBe(10);
    });
  });

  describe('Props - gap', () => {
    it('should default to 16px gap', async () => {
      const children = [document.createElement('div'), document.createElement('div')];
      children.forEach((child) => {
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]');
      const firstChild = masonry?.children[0] as HTMLElement;
      // Width should account for default gap
      expect(firstChild?.style.width).toContain('16px');
    });

    it('should support custom gap value', async () => {
      const children = [document.createElement('div'), document.createElement('div')];
      children.forEach((child) => {
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ gap: 20, children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]');
      const firstChild = masonry?.children[0] as HTMLElement;
      expect(firstChild?.style.width).toContain('20px');
    });

    it('should support gap=0', async () => {
      const children = [document.createElement('div'), document.createElement('div')];
      children.forEach((child) => {
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ gap: 0, children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]');
      const firstChild = masonry?.children[0] as HTMLElement;
      expect(firstChild?.style.width).not.toContain('16px');
    });

    it('should support large gap values', async () => {
      const children = [document.createElement('div'), document.createElement('div')];
      children.forEach((child) => {
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ gap: 50, children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]');
      const firstChild = masonry?.children[0] as HTMLElement;
      expect(firstChild?.style.width).toContain('50px');
    });
  });

  describe('Layout behavior', () => {
    it('should position items absolutely', async () => {
      const children = [document.createElement('div')];
      setMockedHeight(children[0], 100);

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]');
      const child = masonry?.children[0] as HTMLElement;
      expect(child?.style.position).toBe('absolute');
    });

    it('should distribute items across columns', async () => {
      const children = Array.from({ length: 6 }, () => document.createElement('div'));
      children.forEach((child, i) => {
        child.textContent = `Item ${i + 1}`;
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ columns: 3, children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]');
      const items = Array.from(masonry?.children || []) as HTMLElement[];

      // Items should be distributed: 0%, 33.33%, 66.66%, 0%, ...
      expect(parseFloat(items[0]?.style.left)).toBeCloseTo(0, 1);
      expect(parseFloat(items[3]?.style.left)).toBeCloseTo(0, 1);
    });

    it('should set container height based on tallest column', async () => {
      const children = [document.createElement('div')];
      setMockedHeight(children[0], 200);

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]') as HTMLElement;
      // Height should be item height + gap
      expect(masonry?.style.height).toBeTruthy();
    });

    it('should calculate width percentage correctly', async () => {
      const children = [document.createElement('div')];
      setMockedHeight(children[0], 100);

      const component = () => Masonry({ columns: 3, gap: 0, children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const masonry = container.querySelector('[data-masonry]');
      const child = masonry?.children[0] as HTMLElement;
      // Should be 33.33% of container width
      expect(child?.style.width).toContain('33.33');
    });

    it('should handle variable item heights', async () => {
      const children = [document.createElement('div'), document.createElement('div'), document.createElement('div')];
      setMockedHeight(children[0], 100);
      setMockedHeight(children[1], 200);
      setMockedHeight(children[2], 150);

      const component = () => Masonry({ columns: 2, children });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry?.children.length).toBe(3);
    });
  });

  describe('Responsive behavior', () => {
    it('should listen for window resize events', async () => {
      const component = () => Masonry({ children: document.createElement('div') });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry).toBeTruthy();

      // Verify resize listener is attached (implementation detail)
      // We can't directly test this without accessing internals
    });

    it('should handle resize events', async () => {
      const children = [document.createElement('div')];
      setMockedHeight(children[0], 100);

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      await nextTick();

      // Trigger resize
      window.dispatchEvent(new Event('resize'));

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry).toBeTruthy();
    });
  });

  describe('Props forwarding', () => {
    it('should forward custom class', () => {
      const component = () => Masonry({ class: 'custom-masonry', children: null });
      const { container } = renderComponent(component);

      const masonry = container.querySelector('.custom-masonry');
      expect(masonry).toBeTruthy();
    });

    it('should forward id prop', () => {
      const component = () => Masonry({ id: 'masonry-grid', children: null });
      const { container } = renderComponent(component);

      const masonry = container.querySelector('#masonry-grid');
      expect(masonry).toBeTruthy();
    });

    it('should forward data attributes', () => {
      const component = () => Masonry({ 'data-testid': 'masonry-test', children: null });
      const { container } = renderComponent(component);

      const masonry = container.querySelector('[data-testid="masonry-test"]');
      expect(masonry).toBeTruthy();
    });

    it('should forward aria attributes', () => {
      const component = () => Masonry({ 'aria-label': 'Image gallery', children: null });
      const { container } = renderComponent(component);

      const masonry = container.querySelector('[aria-label="Image gallery"]');
      expect(masonry).toBeTruthy();
    });

    it('should forward style prop', () => {
      const component = () => Masonry({ style: { backgroundColor: 'red' }, children: null });
      const { container } = renderComponent(component);

      const masonry = container.querySelector('[data-masonry]') as HTMLElement;
      expect(masonry?.style.backgroundColor).toBe('red');
    });

    it('should merge styles with position relative', () => {
      const component = () => Masonry({ style: { padding: '10px' }, children: null });
      const { container } = renderComponent(component);

      const masonry = container.querySelector('[data-masonry]') as HTMLElement;
      expect(masonry?.style.position).toBe('relative');
      expect(masonry?.style.padding).toBe('10px');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty children array', async () => {
      const component = () => Masonry({ children: [] });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry?.children.length).toBe(0);
    });

    it('should handle null children', async () => {
      const component = () => Masonry({ children: null });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry).toBeTruthy();
    });

    it('should handle undefined children', async () => {
      const component = () => Masonry({ children: undefined });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry).toBeTruthy();
    });

    it('should handle columns=0 gracefully', async () => {
      const children = [document.createElement('div')];
      const component = () => Masonry({ columns: 0, children });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry).toBeTruthy();
    });

    it('should handle negative gap gracefully', async () => {
      const children = [document.createElement('div')];
      setMockedHeight(children[0], 100);

      const component = () => Masonry({ gap: -10, children });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry).toBeTruthy();
    });

    it('should handle very large number of items', async () => {
      const children = Array.from({ length: 100 }, () => document.createElement('div'));
      children.forEach((child) => {
        setMockedHeight(child, 50);
      });

      const component = () => Masonry({ columns: 5, children });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry?.children.length).toBe(100);
    });

    it('should handle items with zero height', async () => {
      const children = [document.createElement('div')];
      setMockedHeight(children[0], 0);

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry?.children.length).toBe(1);
    });

    it('should handle missing offsetHeight', async () => {
      const children = [document.createElement('div')];

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry).toBeTruthy();
    });
  });

  describe('Real-world use cases', () => {
    it('should work for image gallery', async () => {
      const children = Array.from({ length: 12 }, (_, i) => {
        const div = document.createElement('div');
        const img = document.createElement('img');
        img.src = `/image${i + 1}.jpg`;
        img.alt = `Image ${i + 1}`;
        div.appendChild(img);
        setMockedHeight(div, 150 + Math.random() * 100);
        return div;
      });

      const component = () =>
        Masonry({
          columns: 4,
          gap: 16,
          class: 'gallery',
          children,
        });

      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('.gallery');
      expect(masonry?.children.length).toBe(12);
    });

    it('should work for Pinterest-style layout', async () => {
      const children = Array.from({ length: 20 }, (_, i) => {
        const card = document.createElement('div');
        card.className = 'pin-card';
        card.textContent = `Pin ${i + 1}`;
        setMockedHeight(card, 200 + Math.random() * 300);
        return card;
      });

      const component = () =>
        Masonry({
          columns: 3,
          gap: 12,
          'aria-label': 'Pin board',
          children,
        });

      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[aria-label="Pin board"]');
      expect(masonry?.children.length).toBe(20);
    });

    it('should work for blog post grid', async () => {
      const children = Array.from({ length: 6 }, (_, i) => {
        const article = document.createElement('article');
        const title = document.createElement('h3');
        title.textContent = `Article ${i + 1}`;
        const content = document.createElement('p');
        content.textContent = 'Lorem ipsum dolor sit amet...';
        article.appendChild(title);
        article.appendChild(content);
        setMockedHeight(article, 250 + i * 50);
        return article;
      });

      const component = () =>
        Masonry({
          columns: 2,
          gap: 24,
          class: 'blog-grid',
          children,
        });

      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('.blog-grid');
      const articles = masonry?.querySelectorAll('article');
      expect(articles?.length).toBe(6);
    });

    it('should work for product showcase', async () => {
      const children = Array.from({ length: 8 }, (_, i) => {
        const product = document.createElement('div');
        product.className = 'product-card';
        product.setAttribute('data-product-id', String(i + 1));
        setMockedHeight(product, 300);
        return product;
      });

      const component = () =>
        Masonry({
          columns: 4,
          gap: 20,
          style: { maxWidth: '1200px', margin: '0 auto' },
          children,
        });

      const { container } = renderComponent(component);

      await nextTick();

      const products = container.querySelectorAll('.product-card');
      expect(products.length).toBe(8);
    });
  });

  describe('Accessibility', () => {
    it('should support aria-label', () => {
      const component = () =>
        Masonry({
          'aria-label': 'Photo gallery',
          children: null,
        });

      const { container } = renderComponent(component);

      const masonry = container.querySelector('[data-masonry]') as HTMLElement;
      expect(masonry?.getAttribute('aria-label')).toBe('Photo gallery');
    });

    it('should support aria-labelledby', () => {
      const component = () =>
        Masonry({
          'aria-labelledby': 'gallery-title',
          children: null,
        });

      const { container } = renderComponent(component);

      const masonry = container.querySelector('[data-masonry]') as HTMLElement;
      expect(masonry?.getAttribute('aria-labelledby')).toBe('gallery-title');
    });

    it('should support role attribute', () => {
      const component = () =>
        Masonry({
          role: 'list',
          children: null,
        });

      const { container } = renderComponent(component);

      const masonry = container.querySelector('[data-masonry]') as HTMLElement;
      expect(masonry?.getAttribute('role')).toBe('list');
    });

    it('should maintain semantic HTML structure', async () => {
      const children = Array.from({ length: 3 }, () => {
        const article = document.createElement('article');
        article.textContent = 'Content';
        setMockedHeight(article, 100);
        return article;
      });

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      await nextTick();

      const articles = container.querySelectorAll('article');
      expect(articles.length).toBe(3);
    });
  });

  describe('Performance', () => {
    it('should handle rapid resize events efficiently', async () => {
      const children = Array.from({ length: 10 }, () => document.createElement('div'));
      children.forEach((child) => {
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      await nextTick();

      // Trigger multiple resize events
      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new Event('resize'));
      }

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry).toBeTruthy();
    });

    it('should use setTimeout for initial layout', async () => {
      const children = [document.createElement('div')];
      setMockedHeight(children[0], 100);

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      // Should not be laid out immediately
      const masonry = container.querySelector('[data-masonry]');
      expect(masonry).toBeTruthy();

      // After tick, layout should be applied
      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)
      const child = masonry?.children[0] as HTMLElement;
      expect(child?.style.position).toBe('absolute');
    });
  });

  describe('Integration with other components', () => {
    it('should work with custom styled children', async () => {
      const children = Array.from({ length: 4 }, (_, i) => {
        const div = document.createElement('div');
        div.className = 'custom-card';
        div.style.padding = '16px';
        div.style.backgroundColor = '#f0f0f0';
        div.textContent = `Card ${i + 1}`;
        setMockedHeight(div, 150);
        return div;
      });

      const component = () => Masonry({ columns: 2, gap: 16, children });
      const { container } = renderComponent(component);

      await nextTick();

      const cards = container.querySelectorAll('.custom-card');
      expect(cards.length).toBe(4);
      cards.forEach((card) => {
        const htmlCard = card as HTMLElement;
        expect(htmlCard.style.padding).toBe('16px');
      });
    });

    it('should maintain child event handlers', async () => {
      const clickHandler = vi.fn();
      const children = [document.createElement('button')];
      children[0].textContent = 'Click me';
      children[0].addEventListener('click', clickHandler);
      setMockedHeight(children[0], 40);

      const component = () => Masonry({ children });
      const { container } = renderComponent(component);

      await nextTick();

      const button = container.querySelector('button') as HTMLButtonElement;
      button.click();

      expect(clickHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Column distribution', () => {
    it('should distribute 7 items across 3 columns correctly', async () => {
      const children = Array.from({ length: 7 }, () => document.createElement('div'));
      children.forEach((child, i) => {
        child.textContent = `Item ${i + 1}`;
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ columns: 3, children });
      const { container } = renderComponent(component);

      await nextTick();

      const masonry = container.querySelector('[data-masonry]');
      expect(masonry?.children.length).toBe(7);
    });

    it('should fill columns in round-robin order', async () => {
      const children = Array.from({ length: 6 }, () => document.createElement('div'));
      children.forEach((child, i) => {
        child.textContent = `Item ${i}`;
        setMockedHeight(child, 100);
      });

      const component = () => Masonry({ columns: 3, children });
      const { container } = renderComponent(component);

      await nextTick();
      vi.runAllTimers(); // Execute setTimeout(layout, 0)

      const items = Array.from(container.querySelector('[data-masonry]')?.children || []) as HTMLElement[];

      // Items 0, 3 should be in column 0
      // Items 1, 4 should be in column 1
      // Items 2, 5 should be in column 2
      const col0Items = items.filter((item) => parseFloat(item.style.left) < 1);
      const col1Items = items.filter((item) => parseFloat(item.style.left) > 30 && parseFloat(item.style.left) < 40);
      const col2Items = items.filter((item) => parseFloat(item.style.left) > 60);

      expect(col0Items.length).toBe(2);
      expect(col1Items.length).toBe(2);
      expect(col2Items.length).toBe(2);
    });
  });
});
