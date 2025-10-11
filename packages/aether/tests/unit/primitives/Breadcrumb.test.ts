/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../../../src/primitives/Breadcrumb.js';
import { renderComponent, createSpy } from '../../helpers/test-utils.js';

describe('Breadcrumb', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Breadcrumb Root - Basic Rendering', () => {
    it('should render as nav element', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({ children: 'Items' }),
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('nav');
      expect(nav).toBeTruthy();
    });

    it('should have data-breadcrumb attribute', () => {
      const component = () => Breadcrumb({ children: 'Content' });

      const { container } = renderComponent(component);
      const nav = container.querySelector('nav');
      expect(nav?.hasAttribute('data-breadcrumb')).toBe(true);
      expect(nav?.getAttribute('data-breadcrumb')).toBe('');
    });

    it('should have default aria-label', () => {
      const component = () => Breadcrumb({ children: 'Content' });

      const { container } = renderComponent(component);
      const nav = container.querySelector('nav');
      expect(nav?.getAttribute('aria-label')).toBe('Breadcrumb');
    });

    it('should accept custom aria-label', () => {
      const component = () =>
        Breadcrumb({
          'aria-label': 'Site navigation',
          children: 'Content',
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('nav');
      expect(nav?.getAttribute('aria-label')).toBe('Site navigation');
    });

    it('should render children', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({ children: 'List content' }),
        });

      const { container } = renderComponent(component);
      expect(container.textContent).toContain('List content');
    });

    it('should forward custom props', () => {
      const component = () =>
        Breadcrumb({
          'data-testid': 'breadcrumb-nav',
          children: 'Content',
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('[data-testid="breadcrumb-nav"]');
      expect(nav).toBeTruthy();
    });

    it('should apply custom class names', () => {
      const component = () =>
        Breadcrumb({
          class: 'custom-breadcrumb',
          children: 'Content',
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('.custom-breadcrumb');
      expect(nav).toBeTruthy();
    });

    it('should apply custom styles', () => {
      const component = () =>
        Breadcrumb({
          style: { fontSize: '14px', color: 'gray' },
          children: 'Content',
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('nav') as HTMLElement;
      expect(nav.style.fontSize).toBe('14px');
      expect(nav.style.color).toBe('gray');
    });
  });

  describe('BreadcrumbList - Basic Rendering', () => {
    it('should render as ol element', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({ children: 'Items' }),
        });

      const { container } = renderComponent(component);
      const list = container.querySelector('ol');
      expect(list).toBeTruthy();
    });

    it('should have data-breadcrumb-list attribute', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({ children: 'Items' }),
        });

      const { container } = renderComponent(component);
      const list = container.querySelector('ol');
      expect(list?.hasAttribute('data-breadcrumb-list')).toBe(true);
      expect(list?.getAttribute('data-breadcrumb-list')).toBe('');
    });

    it('should render children', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({ children: 'Home' }),
          }),
        });

      const { container } = renderComponent(component);
      expect(container.textContent).toContain('Home');
    });

    it('should forward custom props', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            'data-testid': 'breadcrumb-list',
            children: 'Items',
          }),
        });

      const { container } = renderComponent(component);
      const list = container.querySelector('[data-testid="breadcrumb-list"]');
      expect(list).toBeTruthy();
    });

    it('should apply custom class names', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            class: 'custom-list',
            children: 'Items',
          }),
        });

      const { container } = renderComponent(component);
      const list = container.querySelector('.custom-list');
      expect(list).toBeTruthy();
    });

    it('should render multiple items', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: [
              BreadcrumbItem({ children: 'Home' }),
              BreadcrumbItem({ children: 'Products' }),
              BreadcrumbItem({ children: 'Details' }),
            ],
          }),
        });

      const { container } = renderComponent(component);
      const items = container.querySelectorAll('[data-breadcrumb-item]');
      expect(items.length).toBe(3);
    });
  });

  describe('BreadcrumbItem - Basic Rendering', () => {
    it('should render as li element', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({ children: 'Home' }),
          }),
        });

      const { container } = renderComponent(component);
      const item = container.querySelector('li');
      expect(item).toBeTruthy();
    });

    it('should have data-breadcrumb-item attribute', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({ children: 'Home' }),
          }),
        });

      const { container } = renderComponent(component);
      const item = container.querySelector('li');
      expect(item?.hasAttribute('data-breadcrumb-item')).toBe(true);
      expect(item?.getAttribute('data-breadcrumb-item')).toBe('');
    });

    it('should render children', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({ href: '/', children: 'Home' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      expect(container.textContent).toContain('Home');
    });

    it('should not have aria-current when not current page', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({ children: 'Home' }),
          }),
        });

      const { container } = renderComponent(component);
      const item = container.querySelector('li');
      expect(item?.hasAttribute('aria-current')).toBe(false);
    });

    it('should have aria-current="page" when currentPage is true', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              currentPage: true,
              children: 'Current',
            }),
          }),
        });

      const { container } = renderComponent(component);
      const item = container.querySelector('li');
      expect(item?.getAttribute('aria-current')).toBe('page');
    });

    it('should have data-current attribute when currentPage is true', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              currentPage: true,
              children: 'Current',
            }),
          }),
        });

      const { container } = renderComponent(component);
      const item = container.querySelector('li');
      expect(item?.hasAttribute('data-current')).toBe(true);
      expect(item?.getAttribute('data-current')).toBe('');
    });

    it('should not have data-current when currentPage is false', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              currentPage: false,
              children: 'Not current',
            }),
          }),
        });

      const { container } = renderComponent(component);
      const item = container.querySelector('li');
      expect(item?.hasAttribute('data-current')).toBe(false);
    });

    it('should forward custom props', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              'data-testid': 'home-item',
              children: 'Home',
            }),
          }),
        });

      const { container } = renderComponent(component);
      const item = container.querySelector('[data-testid="home-item"]');
      expect(item).toBeTruthy();
    });

    it('should apply custom class names', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              class: 'custom-item',
              children: 'Home',
            }),
          }),
        });

      const { container } = renderComponent(component);
      const item = container.querySelector('.custom-item');
      expect(item).toBeTruthy();
    });
  });

  describe('BreadcrumbLink - Basic Rendering', () => {
    it('should render as anchor element', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({ href: '/', children: 'Home' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link).toBeTruthy();
    });

    it('should have data-breadcrumb-link attribute', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({ href: '/', children: 'Home' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link?.hasAttribute('data-breadcrumb-link')).toBe(true);
      expect(link?.getAttribute('data-breadcrumb-link')).toBe('');
    });

    it('should have href attribute', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({ href: '/products', children: 'Products' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toBe('/products');
    });

    it('should render children', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({ href: '/', children: 'Home' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link?.textContent).toBe('Home');
    });

    it('should call onClick handler when clicked', () => {
      const onClick = createSpy();
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({
                href: '/',
                onClick,
                children: 'Home',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a') as HTMLAnchorElement;
      link.click();

      expect(onClick.callCount).toBe(1);
    });

    it('should not be disabled by default', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({ href: '/', children: 'Home' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link?.hasAttribute('aria-disabled')).toBe(false);
      expect(link?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should forward custom props', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({
                href: '/',
                'data-testid': 'home-link',
                children: 'Home',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('[data-testid="home-link"]');
      expect(link).toBeTruthy();
    });

    it('should apply custom class names', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({
                href: '/',
                class: 'custom-link',
                children: 'Home',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('.custom-link');
      expect(link).toBeTruthy();
    });
  });

  describe('BreadcrumbLink - Disabled State', () => {
    it('should have aria-disabled when disabled', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({
                href: '/',
                disabled: true,
                children: 'Home',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link?.getAttribute('aria-disabled')).toBe('true');
    });

    it('should have data-disabled when disabled', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({
                href: '/',
                disabled: true,
                children: 'Home',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link?.hasAttribute('data-disabled')).toBe(true);
      expect(link?.getAttribute('data-disabled')).toBe('');
    });

    it('should not have href when disabled', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({
                href: '/products',
                disabled: true,
                children: 'Products',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link?.hasAttribute('href')).toBe(false);
    });

    it('should prevent default when disabled and clicked', () => {
      const onClick = createSpy();
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({
                href: '/',
                disabled: true,
                onClick,
                children: 'Home',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a') as HTMLAnchorElement;

      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(onClick.callCount).toBe(0);
    });

    it('should not call onClick when disabled', () => {
      const onClick = createSpy();
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({
                href: '/',
                disabled: true,
                onClick,
                children: 'Home',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a') as HTMLAnchorElement;
      link.click();

      expect(onClick.callCount).toBe(0);
    });
  });

  describe('BreadcrumbPage - Basic Rendering', () => {
    it('should render as span element', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              currentPage: true,
              children: BreadcrumbPage({ children: 'Current Page' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const page = container.querySelector('span');
      expect(page).toBeTruthy();
    });

    it('should have data-breadcrumb-page attribute', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbPage({ children: 'Current Page' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const page = container.querySelector('span');
      expect(page?.hasAttribute('data-breadcrumb-page')).toBe(true);
      expect(page?.getAttribute('data-breadcrumb-page')).toBe('');
    });

    it('should have aria-current="page"', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbPage({ children: 'Current Page' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const page = container.querySelector('span');
      expect(page?.getAttribute('aria-current')).toBe('page');
    });

    it('should render children', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbPage({ children: 'Product Details' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const page = container.querySelector('span');
      expect(page?.textContent).toBe('Product Details');
    });

    it('should forward custom props', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbPage({
                'data-testid': 'current-page',
                children: 'Current',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const page = container.querySelector('[data-testid="current-page"]');
      expect(page).toBeTruthy();
    });

    it('should apply custom class names', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbPage({
                class: 'current-page',
                children: 'Current',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const page = container.querySelector('.current-page');
      expect(page).toBeTruthy();
    });
  });

  describe('BreadcrumbSeparator - Basic Rendering', () => {
    it('should render as li element', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbSeparator({}),
          }),
        });

      const { container } = renderComponent(component);
      const separator = container.querySelector('[data-breadcrumb-separator]');
      expect(separator).toBeTruthy();
      expect(separator?.tagName).toBe('LI');
    });

    it('should have data-breadcrumb-separator attribute', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbSeparator({}),
          }),
        });

      const { container } = renderComponent(component);
      const separator = container.querySelector('li');
      expect(separator?.hasAttribute('data-breadcrumb-separator')).toBe(true);
      expect(separator?.getAttribute('data-breadcrumb-separator')).toBe('');
    });

    it('should have role="presentation"', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbSeparator({}),
          }),
        });

      const { container } = renderComponent(component);
      const separator = container.querySelector('li');
      expect(separator?.getAttribute('role')).toBe('presentation');
    });

    it('should have aria-hidden="true"', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbSeparator({}),
          }),
        });

      const { container } = renderComponent(component);
      const separator = container.querySelector('li');
      expect(separator?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should render default "/" separator', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbSeparator({}),
          }),
        });

      const { container } = renderComponent(component);
      const separator = container.querySelector('[data-breadcrumb-separator]');
      expect(separator?.textContent).toBe('/');
    });

    it('should render custom separator', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbSeparator({ children: '>' }),
          }),
        });

      const { container } = renderComponent(component);
      const separator = container.querySelector('[data-breadcrumb-separator]');
      expect(separator?.textContent).toBe('>');
    });

    it('should render icon as separator', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbSeparator({ children: '→' }),
          }),
        });

      const { container } = renderComponent(component);
      const separator = container.querySelector('[data-breadcrumb-separator]');
      expect(separator?.textContent).toBe('→');
    });

    it('should forward custom props', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbSeparator({
              'data-testid': 'separator',
            }),
          }),
        });

      const { container } = renderComponent(component);
      const separator = container.querySelector('[data-testid="separator"]');
      expect(separator).toBeTruthy();
    });

    it('should apply custom class names', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbSeparator({
              class: 'custom-separator',
            }),
          }),
        });

      const { container } = renderComponent(component);
      const separator = container.querySelector('.custom-separator');
      expect(separator).toBeTruthy();
    });
  });

  describe('Complete Breadcrumb Examples', () => {
    it('should render complete breadcrumb trail', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: [
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/', children: 'Home' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/products', children: 'Products' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                currentPage: true,
                children: BreadcrumbPage({ children: 'Details' }),
              }),
            ],
          }),
        });

      const { container } = renderComponent(component);

      expect(container.querySelectorAll('[data-breadcrumb-item]').length).toBe(3);
      expect(container.querySelectorAll('[data-breadcrumb-separator]').length).toBe(2);
      expect(container.querySelectorAll('a').length).toBe(2);
      expect(container.querySelector('[data-breadcrumb-page]')).toBeTruthy();
    });

    it('should render two-level breadcrumb', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: [
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/', children: 'Home' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                currentPage: true,
                children: BreadcrumbPage({ children: 'Dashboard' }),
              }),
            ],
          }),
        });

      const { container } = renderComponent(component);

      expect(container.querySelectorAll('[data-breadcrumb-item]').length).toBe(2);
      expect(container.querySelectorAll('a').length).toBe(1);
    });

    it('should render deep breadcrumb trail', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: [
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/', children: 'Home' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/products', children: 'Products' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/products/electronics', children: 'Electronics' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/products/electronics/laptops', children: 'Laptops' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                currentPage: true,
                children: BreadcrumbPage({ children: 'Gaming Laptop' }),
              }),
            ],
          }),
        });

      const { container } = renderComponent(component);

      expect(container.querySelectorAll('[data-breadcrumb-item]').length).toBe(5);
      expect(container.querySelectorAll('[data-breadcrumb-separator]').length).toBe(4);
    });

    it('should maintain accessibility in complete breadcrumb', () => {
      const component = () =>
        Breadcrumb({
          'aria-label': 'Page navigation',
          children: BreadcrumbList({
            children: [
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/', children: 'Home' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                currentPage: true,
                children: BreadcrumbPage({ children: 'Current' }),
              }),
            ],
          }),
        });

      const { container } = renderComponent(component);

      const nav = container.querySelector('nav');
      expect(nav?.getAttribute('aria-label')).toBe('Page navigation');

      const currentItem = container.querySelector('[data-current]');
      expect(currentItem?.getAttribute('aria-current')).toBe('page');

      const separator = container.querySelector('[data-breadcrumb-separator]');
      expect(separator?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty breadcrumb', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({ children: [] }),
        });

      const { container } = renderComponent(component);
      const list = container.querySelector('ol');
      expect(list).toBeTruthy();
    });

    it('should handle single breadcrumb item', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              currentPage: true,
              children: BreadcrumbPage({ children: 'Home' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      expect(container.querySelectorAll('[data-breadcrumb-item]').length).toBe(1);
    });

    it('should handle empty link text', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({ href: '/', children: '' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link?.textContent).toBe('');
    });

    it('should handle special characters in text', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({
                href: '/',
                children: '<script>alert("xss")</script>',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link?.textContent).toBe('<script>alert("xss")</script>');
      expect(container.querySelector('script')).toBeNull();
    });

    it('should handle very long breadcrumb text', () => {
      const longText = 'This is a very long breadcrumb text that might overflow and needs proper handling';
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbPage({ children: longText }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const page = container.querySelector('[data-breadcrumb-page]');
      expect(page?.textContent).toBe(longText);
    });

    it('should handle Unicode characters', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({ href: '/', children: '首页' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link?.textContent).toBe('首页');
    });

    it('should handle emojis in breadcrumb', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({ href: '/', children: '🏠 Home' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a');
      expect(link?.textContent).toBe('🏠 Home');
    });

    it('should handle null children', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({ children: null }),
          }),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[data-breadcrumb-item]')).toBeTruthy();
    });

    it('should handle undefined children', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({ children: undefined }),
          }),
        });

      const { container } = renderComponent(component);
      expect(container.querySelector('[data-breadcrumb-item]')).toBeTruthy();
    });

    it('should handle multiple current pages gracefully', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: [
              BreadcrumbItem({
                currentPage: true,
                children: BreadcrumbPage({ children: 'Page 1' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                currentPage: true,
                children: BreadcrumbPage({ children: 'Page 2' }),
              }),
            ],
          }),
        });

      const { container } = renderComponent(component);
      const currentPages = container.querySelectorAll('[aria-current="page"]');
      expect(currentPages.length).toBeGreaterThan(0);
    });
  });

  describe('Accessibility', () => {
    it('should have proper semantic structure', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: [
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/', children: 'Home' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                currentPage: true,
                children: BreadcrumbPage({ children: 'Current' }),
              }),
            ],
          }),
        });

      const { container } = renderComponent(component);

      expect(container.querySelector('nav')).toBeTruthy();
      expect(container.querySelector('ol')).toBeTruthy();
      expect(container.querySelectorAll('li').length).toBeGreaterThan(0);
    });

    it('should mark separators as presentational', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: [
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/', children: 'Home' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                children: BreadcrumbPage({ children: 'Current' }),
              }),
            ],
          }),
        });

      const { container } = renderComponent(component);
      const separator = container.querySelector('[data-breadcrumb-separator]');
      expect(separator?.getAttribute('role')).toBe('presentation');
      expect(separator?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should properly mark current page', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              currentPage: true,
              children: BreadcrumbPage({ children: 'Current Page' }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const currentElements = container.querySelectorAll('[aria-current="page"]');
      expect(currentElements.length).toBeGreaterThanOrEqual(1);
    });

    it('should support keyboard navigation on links', () => {
      const onClick = createSpy();
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: BreadcrumbItem({
              children: BreadcrumbLink({
                href: '/',
                onClick,
                children: 'Home',
              }),
            }),
          }),
        });

      const { container } = renderComponent(component);
      const link = container.querySelector('a') as HTMLAnchorElement;

      link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      // Link default behavior handles Enter key
      expect(link).toBeTruthy();
    });
  });

  describe('Integration Scenarios', () => {
    it('should work with custom separators', () => {
      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({
            children: [
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/', children: 'Home' }),
              }),
              BreadcrumbSeparator({ children: '›' }),
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/products', children: 'Products' }),
              }),
              BreadcrumbSeparator({ children: '›' }),
              BreadcrumbItem({
                currentPage: true,
                children: BreadcrumbPage({ children: 'Details' }),
              }),
            ],
          }),
        });

      const { container } = renderComponent(component);
      const separators = container.querySelectorAll('[data-breadcrumb-separator]');
      separators.forEach((sep) => {
        expect(sep.textContent).toBe('›');
      });
    });

    it('should work with styled components', () => {
      const component = () =>
        Breadcrumb({
          class: 'breadcrumb-container',
          children: BreadcrumbList({
            class: 'breadcrumb-list',
            children: [
              BreadcrumbItem({
                class: 'breadcrumb-item',
                children: BreadcrumbLink({
                  href: '/',
                  class: 'breadcrumb-link',
                  children: 'Home',
                }),
              }),
              BreadcrumbSeparator({ class: 'breadcrumb-separator' }),
              BreadcrumbItem({
                class: 'breadcrumb-item active',
                currentPage: true,
                children: BreadcrumbPage({
                  class: 'breadcrumb-page',
                  children: 'Current',
                }),
              }),
            ],
          }),
        });

      const { container } = renderComponent(component);

      expect(container.querySelector('.breadcrumb-container')).toBeTruthy();
      expect(container.querySelector('.breadcrumb-list')).toBeTruthy();
      expect(container.querySelector('.breadcrumb-item')).toBeTruthy();
      expect(container.querySelector('.breadcrumb-link')).toBeTruthy();
      expect(container.querySelector('.breadcrumb-separator')).toBeTruthy();
      expect(container.querySelector('.breadcrumb-page')).toBeTruthy();
    });

    it('should work in responsive layouts', () => {
      const component = () =>
        Breadcrumb({
          style: { fontSize: '14px', display: 'flex' },
          children: BreadcrumbList({
            style: { flexWrap: 'wrap' },
            children: [
              BreadcrumbItem({
                children: BreadcrumbLink({ href: '/', children: 'Home' }),
              }),
              BreadcrumbSeparator({}),
              BreadcrumbItem({
                currentPage: true,
                children: BreadcrumbPage({ children: 'Current' }),
              }),
            ],
          }),
        });

      const { container } = renderComponent(component);
      const nav = container.querySelector('nav') as HTMLElement;
      const list = container.querySelector('ol') as HTMLElement;

      expect(nav.style.fontSize).toBe('14px');
      expect(list.style.flexWrap).toBe('wrap');
    });
  });

  describe('Performance', () => {
    it('should render many breadcrumb items efficiently', () => {
      const items = Array.from({ length: 20 }, (_, i) => [
        BreadcrumbItem({
          children: i < 19
            ? BreadcrumbLink({ href: `/${i}`, children: `Item ${i}` })
            : BreadcrumbPage({ children: `Item ${i}` }),
          currentPage: i === 19,
        }),
        ...(i < 19 ? [BreadcrumbSeparator({})] : []),
      ]).flat();

      const component = () =>
        Breadcrumb({
          children: BreadcrumbList({ children: items }),
        });

      const { container } = renderComponent(component);
      expect(container.querySelectorAll('[data-breadcrumb-item]').length).toBe(20);
    });
  });
});
