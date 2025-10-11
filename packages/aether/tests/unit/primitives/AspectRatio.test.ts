/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AspectRatio } from '../../../src/primitives/AspectRatio.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('AspectRatio', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render with required ratio prop', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl).toBeTruthy();
      expect(aspectEl.textContent).toBe('Content');
    });

    it('should render children correctly', () => {
      const span = document.createElement('span');
      span.textContent = 'Test content';

      const component = () =>
        AspectRatio({
          ratio: 1,
          children: span,
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl).toBeTruthy();
      expect(aspectEl.querySelector('span')).toBeTruthy();
    });

    it('should have data-aspect-ratio attribute', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.hasAttribute('data-aspect-ratio')).toBe(true);
    });

    it('should apply custom class', () => {
      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          class: 'custom-aspect',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('.custom-aspect') as HTMLElement;
      expect(aspectEl).toBeTruthy();
    });
  });

  describe('Common aspect ratios', () => {
    it('should apply 16:9 aspect ratio (widescreen)', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;

      // 9/16 = 0.5625 = 56.25%
      expect(paddingEl.style.paddingBottom).toBe('56.25%');
    });

    it('should apply 4:3 aspect ratio (standard)', () => {
      const component = () => AspectRatio({ ratio: 4 / 3, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;

      // 3/4 = 0.75 = 75%
      expect(paddingEl.style.paddingBottom).toBe('75%');
    });

    it('should apply 1:1 aspect ratio (square)', () => {
      const component = () => AspectRatio({ ratio: 1, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;

      // 1/1 = 1 = 100%
      expect(paddingEl.style.paddingBottom).toBe('100%');
    });

    it('should apply 3:2 aspect ratio (photography)', () => {
      const component = () => AspectRatio({ ratio: 3 / 2, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;

      // 2/3 = 0.6666... = 66.66666666666666%
      expect(paddingEl.style.paddingBottom).toContain('66.666');
    });

    it('should apply 21:9 aspect ratio (ultrawide)', () => {
      const component = () => AspectRatio({ ratio: 21 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;

      // 9/21 = 0.428571... = 42.857142857142854%
      expect(paddingEl.style.paddingBottom).toContain('42.857');
    });

    it('should apply 9:16 aspect ratio (vertical video)', () => {
      const component = () => AspectRatio({ ratio: 9 / 16, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;

      // 16/9 = 1.7777... = 177.77777777777777%
      expect(paddingEl.style.paddingBottom).toContain('177.777');
    });

    it('should apply 2:1 aspect ratio (panoramic)', () => {
      const component = () => AspectRatio({ ratio: 2 / 1, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;

      // 1/2 = 0.5 = 50%
      expect(paddingEl.style.paddingBottom).toBe('50%');
    });
  });

  describe('Custom aspect ratios', () => {
    it('should apply custom ratio 5:4', () => {
      const component = () => AspectRatio({ ratio: 5 / 4, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;

      // 4/5 = 0.8 = 80%
      expect(paddingEl.style.paddingBottom).toBe('80%');
    });

    it('should apply custom ratio 8:5', () => {
      const component = () => AspectRatio({ ratio: 8 / 5, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;

      // 5/8 = 0.625 = 62.5%
      expect(paddingEl.style.paddingBottom).toBe('62.5%');
    });

    it('should apply very wide ratio 32:9', () => {
      const component = () => AspectRatio({ ratio: 32 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;

      // 9/32 = 0.28125 = 28.125%
      expect(paddingEl.style.paddingBottom).toBe('28.125%');
    });

    it('should apply very tall ratio 1:2', () => {
      const component = () => AspectRatio({ ratio: 1 / 2, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;

      // 2/1 = 2 = 200%
      expect(paddingEl.style.paddingBottom).toBe('200%');
    });
  });

  describe('Container structure', () => {
    it('should have relative positioning on outer container', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.style.position).toBe('relative');
      expect(aspectEl.style.width).toBe('100%');
    });

    it('should have two child divs', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const childDivs = aspectEl.querySelectorAll('div');
      expect(childDivs.length).toBe(2);
    });

    it('should have padding element as first child', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;
      expect(paddingEl.style.paddingBottom).toBeTruthy();
    });

    it('should have content container with absolute positioning', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const contentEl = aspectEl.querySelector('div:last-child') as HTMLElement;
      expect(contentEl.style.position).toBe('absolute');
      expect(contentEl.style.top).toBe('0px');
      expect(contentEl.style.left).toBe('0px');
      expect(contentEl.style.right).toBe('0px');
      expect(contentEl.style.bottom).toBe('0px');
    });

    it('should render children inside content container', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Test content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const contentEl = aspectEl.querySelector('div:last-child') as HTMLElement;
      expect(contentEl.textContent).toBe('Test content');
    });
  });

  describe('Children rendering', () => {
    it('should render text children', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Text content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.textContent).toBe('Text content');
    });

    it('should render element children', () => {
      const img = document.createElement('img');
      img.src = 'test.jpg';
      img.alt = 'Test image';

      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          children: img,
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const imgEl = aspectEl.querySelector('img') as HTMLImageElement;
      expect(imgEl).toBeTruthy();
      expect(imgEl.src).toContain('test.jpg');
      expect(imgEl.alt).toBe('Test image');
    });

    it('should render multiple children', () => {
      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          children: ['Text', document.createElement('span'), 'More text'],
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const contentEl = aspectEl.querySelector('div:last-child') as HTMLElement;
      expect(contentEl.childNodes.length).toBe(3);
    });

    it('should render video element', () => {
      const video = document.createElement('video');
      video.src = 'video.mp4';

      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          children: video,
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const videoEl = aspectEl.querySelector('video') as HTMLVideoElement;
      expect(videoEl).toBeTruthy();
      expect(videoEl.src).toContain('video.mp4');
    });

    it('should render iframe element', () => {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://example.com/embed';

      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          children: iframe,
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const iframeEl = aspectEl.querySelector('iframe') as HTMLIFrameElement;
      expect(iframeEl).toBeTruthy();
      expect(iframeEl.src).toBe('https://example.com/embed');
    });
  });

  describe('Custom styles', () => {
    it('should merge custom styles with default styles', () => {
      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          style: { backgroundColor: 'black', border: '1px solid red' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.style.position).toBe('relative');
      expect(aspectEl.style.width).toBe('100%');
      expect(aspectEl.style.backgroundColor).toBe('black');
      expect(aspectEl.style.border).toBe('1px solid red');
    });

    it('should allow custom width override', () => {
      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          style: { width: '500px' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.style.width).toBe('500px');
    });

    it('should allow maxWidth style', () => {
      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          style: { maxWidth: '800px' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.style.maxWidth).toBe('800px');
    });

    it('should allow borderRadius style', () => {
      const component = () =>
        AspectRatio({
          ratio: 1,
          style: { borderRadius: '8px', overflow: 'hidden' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      // Check that borderRadius is applied (value normalization may vary)
      expect(aspectEl.style.borderRadius).toContain('8px');
      expect(aspectEl.style.overflow).toBe('hidden');
    });
  });

  describe('Additional props', () => {
    it('should pass through additional HTML attributes', () => {
      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          id: 'aspect-container',
          'data-testid': 'aspect',
          'aria-label': 'Video container',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.id).toBe('aspect-container');
      expect(aspectEl.getAttribute('data-testid')).toBe('aspect');
      expect(aspectEl.getAttribute('aria-label')).toBe('Video container');
    });

    it('should support event handlers', () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };

      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          onClick: handleClick,
          children: 'Click me',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      aspectEl.click();

      expect(clicked).toBe(true);
    });

    it('should support title attribute', () => {
      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          title: 'Video player',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.title).toBe('Video player');
    });
  });

  describe('Accessibility', () => {
    it('should support ARIA attributes', () => {
      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          role: 'img',
          'aria-label': 'Product image',
          children: 'Image content',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.getAttribute('role')).toBe('img');
      expect(aspectEl.getAttribute('aria-label')).toBe('Product image');
    });

    it('should support aria-labelledby', () => {
      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          'aria-labelledby': 'video-title',
          children: 'Video content',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.getAttribute('aria-labelledby')).toBe('video-title');
    });

    it('should not add AspectRatio-specific ARIA attributes automatically', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.getAttribute('role')).toBeNull();
      expect(aspectEl.getAttribute('aria-label')).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle null children', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: null });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl).toBeTruthy();
      const contentEl = aspectEl.querySelector('div:last-child') as HTMLElement;
      expect(contentEl.childNodes.length).toBe(0);
    });

    it('should handle undefined children', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: undefined });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl).toBeTruthy();
      const contentEl = aspectEl.querySelector('div:last-child') as HTMLElement;
      expect(contentEl.childNodes.length).toBe(0);
    });

    it('should handle empty string children', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: '' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl).toBeTruthy();
      const contentEl = aspectEl.querySelector('div:last-child') as HTMLElement;
      expect(contentEl.textContent).toBe('');
    });

    it('should handle very wide ratio', () => {
      const component = () => AspectRatio({ ratio: 100 / 1, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;
      // 1/100 = 0.01 = 1%
      expect(paddingEl.style.paddingBottom).toBe('1%');
    });

    it('should handle very tall ratio', () => {
      const component = () => AspectRatio({ ratio: 1 / 100, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;
      // 100/1 = 100 = 10000%
      expect(paddingEl.style.paddingBottom).toBe('10000%');
    });

    it('should handle decimal ratios', () => {
      const component = () => AspectRatio({ ratio: 1.5, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;
      // 1/1.5 = 0.6666... = 66.66666666666666%
      expect(paddingEl.style.paddingBottom).toContain('66.666');
    });

    it('should handle ratio close to zero', () => {
      const component = () => AspectRatio({ ratio: 0.001, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;
      // 1/0.001 = 1000 = 100000%
      expect(paddingEl.style.paddingBottom).toBe('100000%');
    });
  });

  describe('Responsive use cases', () => {
    it('should work with maxWidth for responsive images', () => {
      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          style: { maxWidth: '600px', margin: '0 auto' },
          children: 'Image',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.style.maxWidth).toBe('600px');
      // Happy-dom normalizes margin to include px for 0 values
      expect(aspectEl.style.margin).toContain('auto');
    });

    it('should work with width constraints', () => {
      const component = () =>
        AspectRatio({
          ratio: 1,
          style: { minWidth: '200px', maxWidth: '400px' },
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.style.minWidth).toBe('200px');
      expect(aspectEl.style.maxWidth).toBe('400px');
    });
  });

  describe('Performance', () => {
    it('should maintain structure for proper aspect ratio calculation', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl.style.position).toBe('relative');
      expect(aspectEl.style.width).toBe('100%');

      const paddingEl = aspectEl.querySelector('div:first-child') as HTMLElement;
      expect(paddingEl.style.paddingBottom).toBe('56.25%');

      const contentEl = aspectEl.querySelector('div:last-child') as HTMLElement;
      expect(contentEl.style.position).toBe('absolute');
    });

    it('should use CSS for aspect ratio maintenance (no JavaScript)', () => {
      const component = () => AspectRatio({ ratio: 16 / 9, children: 'Content' });

      const { container } = renderComponent(component);

      // All styling should be inline CSS, no event listeners needed
      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      expect(aspectEl).toBeTruthy();
      expect(aspectEl.style.position).toBe('relative');
    });
  });

  describe('Common use cases', () => {
    it('should work for YouTube embed (16:9)', () => {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://www.youtube.com/embed/example';
      iframe.setAttribute('allowfullscreen', '');

      const component = () =>
        AspectRatio({
          ratio: 16 / 9,
          children: iframe,
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const iframeEl = aspectEl.querySelector('iframe');
      expect(iframeEl).toBeTruthy();
      expect(aspectEl.querySelector('div:first-child')?.style.paddingBottom).toBe('56.25%');
    });

    it('should work for square profile image (1:1)', () => {
      const img = document.createElement('img');
      img.src = 'profile.jpg';
      img.alt = 'Profile picture';

      const component = () =>
        AspectRatio({
          ratio: 1,
          style: { borderRadius: '50%', overflow: 'hidden' },
          children: img,
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const imgEl = aspectEl.querySelector('img');
      expect(imgEl).toBeTruthy();
      expect(aspectEl.querySelector('div:first-child')?.style.paddingBottom).toBe('100%');
      // Check that borderRadius is applied (value normalization may vary)
      expect(aspectEl.style.borderRadius).toContain('50%');
    });

    it('should work for product image (4:3)', () => {
      const img = document.createElement('img');
      img.src = 'product.jpg';
      img.alt = 'Product';

      const component = () =>
        AspectRatio({
          ratio: 4 / 3,
          children: img,
        });

      const { container } = renderComponent(component);

      const aspectEl = container.querySelector('[data-aspect-ratio]') as HTMLElement;
      const imgEl = aspectEl.querySelector('img');
      expect(imgEl).toBeTruthy();
      expect(aspectEl.querySelector('div:first-child')?.style.paddingBottom).toBe('75%');
    });
  });
});
