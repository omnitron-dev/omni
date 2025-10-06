/**
 * Link Component Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Link } from '../../../src/router/Link.js';
import { createRouter, setRouter } from '../../../src/router/router.js';
import type { Router } from '../../../src/router/types.js';

describe('Link Component', () => {
  let router: Router;

  beforeEach(() => {
    // Create a memory router for testing
    router = createRouter({
      mode: 'memory',
      routes: [
        { path: '/' },
        { path: '/about' },
        { path: '/users/:id' },
        { path: '/blog' },
      ],
    });

    setRouter(router);
  });

  describe('Basic Rendering', () => {
    it('should create a link element', () => {
      const link = Link({ href: '/about', children: 'About' });
      expect(link).toBeInstanceOf(HTMLAnchorElement);
      expect((link as HTMLAnchorElement).href).toContain('/about');
    });

    it('should render children', () => {
      const link = Link({ href: '/about', children: 'About Page' });
      expect((link as HTMLAnchorElement).textContent).toBe('About Page');
    });

    it('should apply custom class', () => {
      const link = Link({ href: '/about', class: 'custom-link', children: 'About' });
      expect((link as HTMLAnchorElement).className).toContain('custom-link');
    });

    it('should pass through additional attributes', () => {
      const link = Link({ href: '/about', 'data-test': 'link', children: 'About' });
      expect((link as HTMLAnchorElement).getAttribute('data-test')).toBe('link');
    });
  });

  describe('External Links', () => {
    it('should add target and rel for external links', () => {
      const link = Link({ href: 'https://example.com', external: true, children: 'External' });
      expect((link as HTMLAnchorElement).target).toBe('_blank');
      expect((link as HTMLAnchorElement).rel).toBe('noopener noreferrer');
    });

    it('should not prevent default on external links', () => {
      const link = Link({ href: 'https://example.com', external: true, children: 'External' });
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('Navigation', () => {
    it('should navigate on click', async () => {
      const link = Link({ href: '/about', children: 'About' });

      // Spy on router navigate
      const navigateSpy = vi.spyOn(router, 'navigate');

      // Click link
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(navigateSpy).toHaveBeenCalledWith('/about', expect.objectContaining({
        scroll: true,
      }));
    });

    it('should use replace option', () => {
      const link = Link({ href: '/about', replace: true, children: 'About' });

      const navigateSpy = vi.spyOn(router, 'navigate');

      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);

      expect(navigateSpy).toHaveBeenCalledWith('/about', expect.objectContaining({
        replace: true,
      }));
    });

    it('should pass state on navigation', () => {
      const state = { from: 'home' };
      const link = Link({ href: '/about', state, children: 'About' });

      const navigateSpy = vi.spyOn(router, 'navigate');

      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);

      expect(navigateSpy).toHaveBeenCalledWith('/about', expect.objectContaining({
        state,
      }));
    });

    it('should disable scroll if scroll=false', () => {
      const link = Link({ href: '/about', scroll: false, children: 'About' });

      const navigateSpy = vi.spyOn(router, 'navigate');

      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(event);

      expect(navigateSpy).toHaveBeenCalledWith('/about', expect.objectContaining({
        scroll: false,
      }));
    });
  });

  describe('Modified Clicks', () => {
    it('should not prevent default on ctrl+click', () => {
      const link = Link({ href: '/about', children: 'About' });

      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('should not prevent default on meta+click', () => {
      const link = Link({ href: '/about', children: 'About' });

      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        metaKey: true,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('should not prevent default on shift+click', () => {
      const link = Link({ href: '/about', children: 'About' });

      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('should not prevent default on alt+click', () => {
      const link = Link({ href: '/about', children: 'About' });

      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        altKey: true,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('should not prevent default on middle click', () => {
      const link = Link({ href: '/about', children: 'About' });

      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 1, // Middle button
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('Active State', () => {
    it('should add activeClass when link is active', async () => {
      await router.navigate('/blog');

      const link = Link({ href: '/blog', activeClass: 'active', children: 'Blog' });
      expect((link as HTMLAnchorElement).className).toContain('active');
    });

    it('should add exactActiveClass when link is exactly active', async () => {
      await router.navigate('/blog');

      const link = Link({ href: '/blog', exactActiveClass: 'exact-active', children: 'Blog' });
      expect((link as HTMLAnchorElement).className).toContain('exact-active');
    });

    it('should not add activeClass when link is not active', async () => {
      // Ensure we're on a different route
      await router.navigate('/');

      const link = Link({ href: '/about', activeClass: 'active', children: 'About' });
      expect((link as HTMLAnchorElement).className).not.toContain('active');
    });
  });

  describe('Hover Events', () => {
    it('should handle mouseenter event', () => {
      const link = Link({ href: '/about', children: 'About' });

      const event = new MouseEvent('mouseenter', { bubbles: true });
      link.dispatchEvent(event);

      // Should not throw
      expect(true).toBe(true);
    });

    it('should handle mouseleave event', () => {
      const link = Link({ href: '/about', children: 'About' });

      const event = new MouseEvent('mouseleave', { bubbles: true });
      link.dispatchEvent(event);

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
