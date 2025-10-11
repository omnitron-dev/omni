/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Avatar, AvatarImage, AvatarFallback, AvatarContext } from '../../../src/primitives/Avatar.js';
import { renderComponent, nextTick, waitFor } from '../../helpers/test-utils.js';
import { signal } from '../../../src/core/reactivity/signal.js';

describe('Avatar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Avatar root component', () => {
    it('should render a span element', () => {
      const component = () =>
        Avatar({
          children: null,
        });

      const { container } = renderComponent(component);

      const avatarEl = container.querySelector('span[data-avatar]');
      expect(avatarEl).toBeTruthy();
    });

    it('should have data-avatar attribute', () => {
      const component = () =>
        Avatar({
          children: null,
        });

      const { container } = renderComponent(component);

      const avatarEl = container.querySelector('span');
      expect(avatarEl?.getAttribute('data-avatar')).toBe('');
    });

    it('should forward props to span element', () => {
      const component = () =>
        Avatar({
          id: 'user-avatar',
          class: 'avatar-container',
          'data-testid': 'avatar',
          children: null,
        });

      const { container } = renderComponent(component);

      const avatarEl = container.querySelector('#user-avatar') as HTMLElement;
      expect(avatarEl).toBeTruthy();
      expect(avatarEl.classList.contains('avatar-container')).toBe(true);
      expect(avatarEl.getAttribute('data-testid')).toBe('avatar');
    });

    it('should render children', () => {
      const imageEl = document.createElement('img');
      imageEl.src = '/test.jpg';

      const component = () =>
        Avatar({
          children: imageEl,
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img');
      expect(img).toBeTruthy();
    });
  });

  describe('AvatarImage component', () => {
    it('should render an img element', () => {
      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/avatar.jpg',
            alt: 'User avatar',
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img');
      expect(img).toBeTruthy();
    });

    it('should have data-avatar-image attribute', () => {
      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/avatar.jpg',
            alt: 'User avatar',
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img[data-avatar-image]');
      expect(img).toBeTruthy();
    });

    it('should apply src and alt attributes', () => {
      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/avatar.jpg',
            alt: 'John Doe',
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLImageElement;
      expect(img.src).toContain('/avatar.jpg');
      expect(img.alt).toBe('John Doe');
    });

    it('should start with idle status', () => {
      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/avatar.jpg',
            alt: 'User',
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLElement;
      expect(img.getAttribute('data-status')).toBe('idle');
    });

    it('should hide image initially (before load)', () => {
      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/avatar.jpg',
            alt: 'User',
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLElement;
      expect(img.style.display).toBe('none');
    });

    it('should call onLoad callback when image loads', async () => {
      const onLoad = vi.fn();

      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/avatar.jpg',
            alt: 'User',
            onLoad,
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLImageElement;

      // Simulate image load
      img.dispatchEvent(new Event('load'));

      await nextTick();

      expect(onLoad).toHaveBeenCalledTimes(1);
    });

    it('should call onError callback when image fails', async () => {
      const onError = vi.fn();

      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/invalid.jpg',
            alt: 'User',
            onError,
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLImageElement;

      // Simulate image error
      img.dispatchEvent(new Event('error'));

      await nextTick();

      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('should forward additional props to img element', () => {
      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/avatar.jpg',
            alt: 'User',
            class: 'custom-image',
            id: 'profile-pic',
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLElement;
      expect(img.classList.contains('custom-image')).toBe(true);
      expect(img.id).toBe('profile-pic');
    });

    it('should support custom styles', () => {
      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/avatar.jpg',
            alt: 'User',
            style: { border: '2px solid red' },
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLElement;
      expect(img.style.border).toBe('2px solid red');
    });
  });

  describe('AvatarFallback component', () => {
    it('should render a span element', () => {
      const component = () =>
        Avatar({
          children: AvatarFallback({
            children: 'JD',
          }),
        });

      const { container } = renderComponent(component);

      const fallback = container.querySelector('span[data-avatar-fallback]');
      expect(fallback).toBeTruthy();
    });

    it('should have data-avatar-fallback attribute', () => {
      const component = () =>
        Avatar({
          children: AvatarFallback({
            children: 'JD',
          }),
        });

      const { container } = renderComponent(component);

      // Note: there are two spans - the outer avatar container and the inner fallback
      const fallback = container.querySelector('span[data-avatar-fallback]');
      expect(fallback?.getAttribute('data-avatar-fallback')).toBe('');
    });

    it('should display fallback content by default (when no image)', async () => {
      const component = () =>
        Avatar({
          children: AvatarFallback({
            children: 'JD',
          }),
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallback = container.querySelector('span[data-avatar-fallback]');
      expect(fallback).toBeTruthy();
      expect(fallback?.textContent).toBe('JD');
    });

    it('should have idle status initially', async () => {
      const component = () =>
        Avatar({
          children: AvatarFallback({
            children: 'JD',
          }),
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallback = container.querySelector('span[data-avatar-fallback]') as HTMLElement;
      expect(fallback.getAttribute('data-status')).toBe('idle');
    });

    it('should show immediately when delayMs is 0', async () => {
      const component = () =>
        Avatar({
          children: AvatarFallback({
            children: 'JD',
            delayMs: 0,
          }),
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallback = container.querySelector('span[data-avatar-fallback]');
      expect(fallback).toBeTruthy();
    });

    it('should show immediately when delayMs is undefined', async () => {
      const component = () =>
        Avatar({
          children: AvatarFallback({
            children: 'JD',
          }),
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallback = container.querySelector('span[data-avatar-fallback]');
      expect(fallback).toBeTruthy();
    });

    it('should forward props to span element', async () => {
      const component = () =>
        Avatar({
          children: AvatarFallback({
            children: 'JD',
            class: 'custom-fallback',
            style: { backgroundColor: 'blue' },
          }),
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallback = container.querySelector('span[data-avatar-fallback]') as HTMLElement;
      expect(fallback.classList.contains('custom-fallback')).toBe(true);
      expect(fallback.style.backgroundColor).toBe('blue');
    });

    it('should render different types of children', async () => {
      const component = () =>
        Avatar({
          children: AvatarFallback({
            children: 42,
          }),
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallback = container.querySelector('span[data-avatar-fallback]');
      expect(fallback?.textContent).toBe('42');
    });
  });

  describe('Integration: Avatar with Image and Fallback', () => {
    it('should render both image and fallback elements', () => {
      const component = () =>
        Avatar({
          children: [
            AvatarImage({
              src: '/avatar.jpg',
              alt: 'John Doe',
            }),
            AvatarFallback({
              children: 'JD',
            }),
          ],
        });

      const { container } = renderComponent(component);

      // Both should be in the DOM initially
      const img = container.querySelector('img');
      expect(img).toBeTruthy();

      // Fallback should be visible initially (idle status)
      const fallback = container.querySelector('span[data-avatar-fallback]');
      expect(fallback).toBeTruthy();
    });

    it('should show fallback initially when delayMs is 0', async () => {
      const component = () =>
        Avatar({
          children: [
            AvatarImage({
              src: '/avatar.jpg',
              alt: 'John Doe',
            }),
            AvatarFallback({
              children: 'JD',
              delayMs: 0,
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallback = container.querySelector('span[data-avatar-fallback]');
      expect(fallback).toBeTruthy();
      expect(fallback?.textContent).toBe('JD');
    });

    it('should pass image callbacks through', async () => {
      const onLoad = vi.fn();
      const onError = vi.fn();

      const component = () =>
        Avatar({
          children: [
            AvatarImage({
              src: '/avatar.jpg',
              alt: 'John Doe',
              onLoad,
              onError,
            }),
            AvatarFallback({
              children: 'JD',
            }),
          ],
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLImageElement;

      // Test load
      img.dispatchEvent(new Event('load'));
      await nextTick();
      expect(onLoad).toHaveBeenCalledTimes(1);

      // Create new component to test error
      document.body.innerHTML = '';
      const errorComponent = () =>
        Avatar({
          children: [
            AvatarImage({
              src: '/invalid.jpg',
              alt: 'John Doe',
              onError,
            }),
            AvatarFallback({
              children: 'JD',
            }),
          ],
        });

      const { container: errorContainer } = renderComponent(errorComponent);
      const errorImg = errorContainer.querySelector('img') as HTMLImageElement;

      errorImg.dispatchEvent(new Event('error'));
      await nextTick();
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe('Context functionality', () => {
    it('should provide context to children', () => {
      const component = () =>
        Avatar({
          children: [
            AvatarImage({
              src: '/avatar.jpg',
              alt: 'User',
            }),
            AvatarFallback({
              children: 'U',
            }),
          ],
        });

      const { container } = renderComponent(component);

      // If context is working, both children should render
      const img = container.querySelector('img');
      const fallback = container.querySelector('span[data-avatar-fallback]');

      expect(img).toBeTruthy();
      expect(fallback).toBeTruthy();
    });

    it('should initialize with idle status', () => {
      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/avatar.jpg',
            alt: 'User',
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLElement;
      expect(img.getAttribute('data-status')).toBe('idle');
    });
  });

  describe('Accessibility', () => {
    it('should have proper alt text on image', () => {
      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/avatar.jpg',
            alt: 'Profile picture of John Doe',
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLImageElement;
      expect(img.alt).toBe('Profile picture of John Doe');
    });

    it('should allow custom ARIA attributes on Avatar root', () => {
      const component = () =>
        Avatar({
          'aria-label': 'User avatar',
          role: 'img',
          children: AvatarFallback({
            children: 'JD',
          }),
        });

      const { container } = renderComponent(component);

      const avatar = container.querySelector('span[data-avatar]') as HTMLElement;
      expect(avatar.getAttribute('aria-label')).toBe('User avatar');
      expect(avatar.getAttribute('role')).toBe('img');
    });

    it('should maintain semantic structure', () => {
      const component = () =>
        Avatar({
          children: [
            AvatarImage({
              src: '/avatar.jpg',
              alt: 'John Doe',
            }),
            AvatarFallback({
              children: 'JD',
            }),
          ],
        });

      const { container } = renderComponent(component);

      // Should have proper structure
      const avatar = container.querySelector('span[data-avatar]');
      expect(avatar).toBeTruthy();

      const img = avatar?.querySelector('img');
      expect(img).toBeTruthy();
    });

    it('should allow aria-label on fallback', async () => {
      const component = () =>
        Avatar({
          children: AvatarFallback({
            children: 'JD',
            'aria-label': 'John Doe avatar',
          }),
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallback = container.querySelector('span[data-avatar-fallback]') as HTMLElement;
      expect(fallback.getAttribute('aria-label')).toBe('John Doe avatar');
    });
  });

  describe('Edge cases', () => {
    it('should handle multiple images (implementation detail)', () => {
      const component = () =>
        Avatar({
          children: [
            AvatarImage({
              src: '/avatar1.jpg',
              alt: 'First',
            }),
            AvatarImage({
              src: '/avatar2.jpg',
              alt: 'Second',
            }),
          ],
        });

      const { container } = renderComponent(component);

      // Both images should render (they share context)
      const images = container.querySelectorAll('img');
      expect(images.length).toBe(2);
    });

    it('should handle multiple fallbacks', async () => {
      const component = () =>
        Avatar({
          children: [
            AvatarFallback({
              children: 'First',
            }),
            AvatarFallback({
              children: 'Second',
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallbacks = container.querySelectorAll('span[data-avatar-fallback]');
      expect(fallbacks.length).toBeGreaterThan(0);
    });

    it('should handle empty fallback children', async () => {
      const component = () =>
        Avatar({
          children: AvatarFallback({
            children: '',
          }),
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallback = container.querySelector('span[data-avatar-fallback]');
      expect(fallback).toBeTruthy();
      expect(fallback?.textContent).toBe('');
    });

    it('should handle null children in fallback', async () => {
      const component = () =>
        Avatar({
          children: AvatarFallback({
            children: null,
          }),
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallback = container.querySelector('span[data-avatar-fallback]');
      expect(fallback).toBeTruthy();
    });

    it('should handle image with empty src', () => {
      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '',
            alt: 'Empty',
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLImageElement;
      expect(img).toBeTruthy();
      // Browser will resolve empty src
      expect(img.hasAttribute('src')).toBe(true);
    });

    it('should handle special characters in alt text', () => {
      const component = () =>
        Avatar({
          children: AvatarImage({
            src: '/avatar.jpg',
            alt: 'User\'s "Avatar" <Image>',
          }),
        });

      const { container } = renderComponent(component);

      const img = container.querySelector('img') as HTMLImageElement;
      expect(img.alt).toBe('User\'s "Avatar" <Image>');
    });
  });

  describe('Real-world use cases', () => {
    it('should work for user profile avatar', async () => {
      const component = () =>
        Avatar({
          class: 'profile-avatar',
          style: { width: '48px', height: '48px', borderRadius: '50%' },
          children: [
            AvatarImage({
              src: 'https://example.com/users/johndoe.jpg',
              alt: 'John Doe profile picture',
            }),
            AvatarFallback({
              children: 'JD',
              delayMs: 600,
            }),
          ],
        });

      const { container } = renderComponent(component);

      const avatar = container.querySelector('.profile-avatar') as HTMLElement;
      expect(avatar).toBeTruthy();
      expect(avatar.style.width).toBe('48px');
      expect(avatar.style.height).toBe('48px');

      const img = container.querySelector('img') as HTMLImageElement;
      expect(img.alt).toBe('John Doe profile picture');
    });

    it('should work for comment avatar with initials', async () => {
      const component = () =>
        Avatar({
          style: { width: '32px', height: '32px', borderRadius: '50%' },
          children: [
            AvatarImage({
              src: '/users/alice.jpg',
              alt: 'Alice',
            }),
            AvatarFallback({
              children: 'A',
              style: {
                backgroundColor: '#3b82f6',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              },
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      const avatar = container.querySelector('span[data-avatar]') as HTMLElement;
      expect(avatar.style.width).toBe('32px');
      expect(avatar.style.height).toBe('32px');

      const fallback = container.querySelector('span[data-avatar-fallback]') as HTMLElement;
      expect(fallback.textContent).toBe('A');
      // Browser may normalize hex to rgb format
      expect(fallback.style.backgroundColor).toMatch(/(#3b82f6|rgb\(59, 130, 246\))/);
    });

    it('should work for team member grid', async () => {
      const component = () =>
        Avatar({
          class: 'team-member',
          children: [
            AvatarImage({
              src: '/team/member1.jpg',
              alt: 'Team member',
            }),
            AvatarFallback({
              children: '?',
              delayMs: 100,
            }),
          ],
        });

      const { container } = renderComponent(component);

      const avatar = container.querySelector('.team-member');
      expect(avatar).toBeTruthy();

      const img = container.querySelector('img');
      expect(img).toBeTruthy();
    });

    it('should work with icon fallback', async () => {
      const iconElement = document.createElement('svg');
      iconElement.innerHTML = '<circle cx="12" cy="12" r="10"/>';

      const component = () =>
        Avatar({
          children: [
            AvatarImage({
              src: '/user.jpg',
              alt: 'User',
            }),
            AvatarFallback({
              children: iconElement,
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      const fallback = container.querySelector('span[data-avatar-fallback]');
      expect(fallback).toBeTruthy();
      expect(fallback?.querySelector('svg')).toBeTruthy();
    });
  });

  describe('Styling and customization', () => {
    it('should support custom classes on all components', async () => {
      const component = () =>
        Avatar({
          class: 'custom-avatar',
          children: [
            AvatarImage({
              src: '/avatar.jpg',
              alt: 'User',
              class: 'custom-image',
            }),
            AvatarFallback({
              children: 'U',
              class: 'custom-fallback',
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      expect(container.querySelector('.custom-avatar')).toBeTruthy();
      expect(container.querySelector('.custom-image')).toBeTruthy();
      expect(container.querySelector('.custom-fallback')).toBeTruthy();
    });

    it('should support inline styles on all components', async () => {
      const component = () =>
        Avatar({
          style: { border: '2px solid black' },
          children: [
            AvatarImage({
              src: '/avatar.jpg',
              alt: 'User',
              style: { objectFit: 'cover' },
            }),
            AvatarFallback({
              children: 'U',
              style: { fontSize: '20px' },
            }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      const avatar = container.querySelector('span[data-avatar]') as HTMLElement;
      expect(avatar.style.border).toBe('2px solid black');

      const img = container.querySelector('img') as HTMLElement;
      expect(img.style.objectFit).toBe('cover');

      const fallback = container.querySelector('span[data-avatar-fallback]') as HTMLElement;
      expect(fallback.style.fontSize).toBe('20px');
    });
  });
});
