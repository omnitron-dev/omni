/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
} from '../../../src/primitives/NavigationMenu.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('NavigationMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render navigation menu with nav role', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'item1',
                  children: () => NavigationMenuTrigger({ children: 'Products' }),
                }),
            }),
        });

      const { container } = renderComponent(component);

      const nav = container.querySelector('[data-navigation-menu]');
      expect(nav).toBeTruthy();
      expect(nav?.tagName).toBe('NAV');
      expect(nav?.getAttribute('aria-label')).toBe('Main navigation');
    });

    it('should render with horizontal orientation by default', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () => NavigationMenuItem({ value: 'item1', children: () => 'Item' }),
            }),
        });

      const { container } = renderComponent(component);

      const nav = container.querySelector('[data-navigation-menu]');
      expect(nav?.getAttribute('data-orientation')).toBe('horizontal');
    });

    it('should support vertical orientation', () => {
      const component = () =>
        NavigationMenu({
          orientation: 'vertical',
          children: () =>
            NavigationMenuList({
              children: () => NavigationMenuItem({ value: 'item1', children: () => 'Item' }),
            }),
        });

      const { container } = renderComponent(component);

      const nav = container.querySelector('[data-navigation-menu]');
      expect(nav?.getAttribute('data-orientation')).toBe('vertical');
    });
  });

  describe('NavigationMenuList', () => {
    it('should render list', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () => [
                NavigationMenuItem({ value: 'item1', children: () => 'Item 1' }),
                NavigationMenuItem({ value: 'item2', children: () => 'Item 2' }),
              ],
            }),
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-navigation-menu-list]');
      expect(list).toBeTruthy();
      expect(list?.tagName).toBe('UL');
    });

    it('should have orientation attribute', () => {
      const component = () =>
        NavigationMenu({
          orientation: 'vertical',
          children: () =>
            NavigationMenuList({
              children: () => NavigationMenuItem({ value: 'item1', children: () => 'Item' }),
            }),
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-navigation-menu-list]');
      expect(list?.getAttribute('data-orientation')).toBe('vertical');
    });
  });

  describe('NavigationMenuItem', () => {
    it('should render menu item as list item', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => NavigationMenuTrigger({ children: 'Products' }),
                }),
            }),
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('[data-navigation-menu-item]');
      expect(item).toBeTruthy();
      expect(item?.tagName).toBe('LI');
    });

    it('should not be active initially', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => NavigationMenuTrigger({ children: 'Products' }),
                }),
            }),
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('[data-navigation-menu-item]');
      expect(item?.hasAttribute('data-active')).toBe(false);
    });

    it('should become active when triggered', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({ children: () => 'Content' }),
                  ],
                }),
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-navigation-menu-trigger]') as HTMLButtonElement;
      trigger.click();

      const item = container.querySelector('[data-navigation-menu-item]');
      expect(item?.hasAttribute('data-active')).toBe(true);
    });
  });

  describe('NavigationMenuTrigger', () => {
    it('should render as button', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => NavigationMenuTrigger({ children: 'Products' }),
                }),
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-navigation-menu-trigger]');
      expect(trigger).toBeTruthy();
      expect(trigger?.tagName).toBe('BUTTON');
      expect(trigger?.getAttribute('type')).toBe('button');
    });

    it('should have closed state initially', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => NavigationMenuTrigger({ children: 'Products' }),
                }),
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-navigation-menu-trigger]');
      expect(trigger?.getAttribute('data-state')).toBe('closed');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    });

    it('should toggle on click', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({ children: () => 'Content' }),
                  ],
                }),
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-navigation-menu-trigger]') as HTMLButtonElement;

      // Click to open
      trigger.click();
      expect(trigger.getAttribute('data-state')).toBe('open');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');

      // Click to close
      trigger.click();
      expect(trigger.getAttribute('data-state')).toBe('closed');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('should support keyboard activation with Enter', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({ children: () => 'Content' }),
                  ],
                }),
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-navigation-menu-trigger]') as HTMLButtonElement;

      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(trigger.getAttribute('data-state')).toBe('open');
    });

    it('should support keyboard activation with Space', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({ children: () => 'Content' }),
                  ],
                }),
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-navigation-menu-trigger]') as HTMLButtonElement;

      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      expect(trigger.getAttribute('data-state')).toBe('open');
    });
  });

  describe('NavigationMenuContent', () => {
    it('should not render when inactive', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({ children: () => 'Content' }),
                  ],
                }),
            }),
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-navigation-menu-content]') as HTMLElement;
      // With Pattern 18, content exists but is hidden
      expect(content).toBeTruthy();
      expect(content.style.display).toBe('none');
      expect(content.getAttribute('data-state')).toBe('closed');
    });

    it('should render when active', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({ children: () => 'Product Content' }),
                  ],
                }),
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-navigation-menu-trigger]') as HTMLButtonElement;
      trigger.click();

      const content = container.querySelector('[data-navigation-menu-content]');
      expect(content).toBeTruthy();
      expect(content?.textContent).toBe('Product Content');
      expect(content?.getAttribute('data-state')).toBe('open');
    });
  });

  describe('NavigationMenuLink', () => {
    it('should render as anchor element', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => NavigationMenuLink({ href: '/products', children: 'Products' }),
                }),
            }),
        });

      const { container } = renderComponent(component);

      const link = container.querySelector('[data-navigation-menu-link]');
      expect(link).toBeTruthy();
      expect(link?.tagName).toBe('A');
      expect(link?.getAttribute('href')).toBe('/products');
    });

    it('should support active state', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () => [
                NavigationMenuItem({
                  value: 'home',
                  children: () => NavigationMenuLink({ href: '/', active: true, children: 'Home' }),
                }),
                NavigationMenuItem({
                  value: 'about',
                  children: () => NavigationMenuLink({ href: '/about', active: false, children: 'About' }),
                }),
              ],
            }),
        });

      const { container } = renderComponent(component);

      const links = container.querySelectorAll('[data-navigation-menu-link]');
      expect(links[0]?.hasAttribute('data-active')).toBe(true);
      expect(links[0]?.getAttribute('aria-current')).toBe('page');
      expect(links[1]?.hasAttribute('data-active')).toBe(false);
      expect(links[1]?.hasAttribute('aria-current')).toBe(false);
    });
  });

  describe('NavigationMenuIndicator', () => {
    it('should render indicator', () => {
      const component = () =>
        NavigationMenu({
          children: () => [
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'item1',
                  children: () => NavigationMenuTrigger({ children: 'Item' }),
                }),
            }),
            NavigationMenuIndicator({ children: () => 'Indicator' }),
          ],
        });

      const { container } = renderComponent(component);

      const indicator = container.querySelector('[data-navigation-menu-indicator]');
      expect(indicator).toBeTruthy();
      expect(indicator?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('NavigationMenuViewport', () => {
    it('should render viewport', () => {
      const component = () =>
        NavigationMenu({
          children: () => [
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'item1',
                  children: () => NavigationMenuTrigger({ children: 'Item' }),
                }),
            }),
            NavigationMenuViewport({ children: () => 'Viewport' }),
          ],
        });

      const { container } = renderComponent(component);

      const viewport = container.querySelector('[data-navigation-menu-viewport]');
      expect(viewport).toBeTruthy();
    });
  });

  describe('Controlled mode', () => {
    it('should support controlled value', () => {
      const value = signal('');

      const component = () =>
        NavigationMenu({
          value: value,
          onValueChange: (v) => value.set(v),
          children: () =>
            NavigationMenuList({
              children: () => [
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({ children: () => 'Product Content' }),
                  ],
                }),
                NavigationMenuItem({
                  value: 'about',
                  children: () => [
                    NavigationMenuTrigger({ children: 'About' }),
                    NavigationMenuContent({ children: () => 'About Content' }),
                  ],
                }),
              ],
            }),
        });

      const { container } = renderComponent(component);

      // Initially nothing is active
      let items = container.querySelectorAll('[data-navigation-menu-item]');
      expect(items[0]?.hasAttribute('data-active')).toBe(false);
      expect(items[1]?.hasAttribute('data-active')).toBe(false);

      // Set value externally
      value.set('products');

      items = container.querySelectorAll('[data-navigation-menu-item]');
      expect(items[0]?.hasAttribute('data-active')).toBe(true);
      expect(items[1]?.hasAttribute('data-active')).toBe(false);

      // Change to second item
      value.set('about');

      items = container.querySelectorAll('[data-navigation-menu-item]');
      expect(items[0]?.hasAttribute('data-active')).toBe(false);
      expect(items[1]?.hasAttribute('data-active')).toBe(true);
    });

    it('should call onValueChange when trigger is clicked', () => {
      let changedValue = '';

      const component = () =>
        NavigationMenu({
          onValueChange: (v) => {
            changedValue = v;
          },
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({ children: () => 'Content' }),
                  ],
                }),
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-navigation-menu-trigger]') as HTMLButtonElement;
      trigger.click();

      expect(changedValue).toBe('products');
    });
  });

  describe('Uncontrolled mode', () => {
    it('should support defaultValue', () => {
      const component = () =>
        NavigationMenu({
          defaultValue: 'products',
          children: () =>
            NavigationMenuList({
              children: () => [
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({ children: () => 'Product Content' }),
                  ],
                }),
                NavigationMenuItem({
                  value: 'about',
                  children: () => [
                    NavigationMenuTrigger({ children: 'About' }),
                    NavigationMenuContent({ children: () => 'About Content' }),
                  ],
                }),
              ],
            }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-navigation-menu-item]');
      expect(items[0]?.hasAttribute('data-active')).toBe(true);
      expect(items[1]?.hasAttribute('data-active')).toBe(false);

      // Content should be visible
      const content = container.querySelector('[data-navigation-menu-content]');
      expect(content?.textContent).toBe('Product Content');
    });
  });

  describe('Toggle behavior', () => {
    it('should close active item when toggled', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({ children: () => 'Content' }),
                  ],
                }),
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-navigation-menu-trigger]') as HTMLButtonElement;

      // Open
      trigger.click();
      let content = container.querySelector('[data-navigation-menu-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.style.display).toBe('block');
      expect(content.getAttribute('data-state')).toBe('open');

      // Close
      trigger.click();
      content = container.querySelector('[data-navigation-menu-content]') as HTMLElement;
      // With Pattern 18, content exists but is hidden
      expect(content).toBeTruthy();
      expect(content.style.display).toBe('none');
      expect(content.getAttribute('data-state')).toBe('closed');
    });

    it('should close first item when second is activated', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () => [
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({ children: () => 'Product Content' }),
                  ],
                }),
                NavigationMenuItem({
                  value: 'about',
                  children: () => [
                    NavigationMenuTrigger({ children: 'About' }),
                    NavigationMenuContent({ children: () => 'About Content' }),
                  ],
                }),
              ],
            }),
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[data-navigation-menu-trigger]') as NodeListOf<HTMLButtonElement>;

      // Open first
      triggers[0]?.click();
      let items = container.querySelectorAll('[data-navigation-menu-item]');
      expect(items[0]?.hasAttribute('data-active')).toBe(true);
      expect(items[1]?.hasAttribute('data-active')).toBe(false);

      // Open second (should close first)
      triggers[1]?.click();
      items = container.querySelectorAll('[data-navigation-menu-item]');
      expect(items[0]?.hasAttribute('data-active')).toBe(false);
      expect(items[1]?.hasAttribute('data-active')).toBe(true);
    });
  });

  describe('Multiple navigation items', () => {
    it('should render multiple items', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () => [
                NavigationMenuItem({
                  value: 'products',
                  children: () => NavigationMenuTrigger({ children: 'Products' }),
                }),
                NavigationMenuItem({
                  value: 'solutions',
                  children: () => NavigationMenuTrigger({ children: 'Solutions' }),
                }),
                NavigationMenuItem({
                  value: 'pricing',
                  children: () => NavigationMenuTrigger({ children: 'Pricing' }),
                }),
              ],
            }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-navigation-menu-item]');
      expect(items.length).toBe(3);

      const triggers = container.querySelectorAll('[data-navigation-menu-trigger]');
      expect(triggers.length).toBe(3);
      expect(triggers[0]?.textContent).toBe('Products');
      expect(triggers[1]?.textContent).toBe('Solutions');
      expect(triggers[2]?.textContent).toBe('Pricing');
    });
  });

  describe('Complex structure', () => {
    it('should render complex navigation with multiple items and content', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () => [
                NavigationMenuItem({
                  value: 'products',
                  children: () => [
                    NavigationMenuTrigger({ children: 'Products' }),
                    NavigationMenuContent({
                      children: () => [
                        NavigationMenuLink({ href: '/products/new', children: 'New' }),
                        NavigationMenuLink({ href: '/products/sale', children: 'Sale' }),
                      ],
                    }),
                  ],
                }),
                NavigationMenuItem({
                  value: 'company',
                  children: () => NavigationMenuLink({ href: '/company', children: 'Company' }),
                }),
              ],
            }),
        });

      const { container } = renderComponent(component);

      // Verify structure
      const items = container.querySelectorAll('[data-navigation-menu-item]');
      expect(items.length).toBe(2);

      // Open first item
      const trigger = container.querySelector('[data-navigation-menu-trigger]') as HTMLButtonElement;
      trigger.click();

      // Verify content with links
      const links = container.querySelectorAll('[data-navigation-menu-link]');
      expect(links.length).toBe(3); // 2 in content + 1 direct link
    });
  });

  describe('Value generation', () => {
    it('should auto-generate value if not provided', () => {
      const component = () =>
        NavigationMenu({
          children: () =>
            NavigationMenuList({
              children: () =>
                NavigationMenuItem({
                  children: () => NavigationMenuTrigger({ children: 'Item' }),
                }),
            }),
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('[data-navigation-menu-item]');
      expect(item).toBeTruthy();
      // Even without explicit value, item should work
    });
  });
});
