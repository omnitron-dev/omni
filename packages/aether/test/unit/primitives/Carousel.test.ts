/**
 * Carousel Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Carousel,
  CarouselViewport,
  CarouselSlide,
  CarouselPrevious,
  CarouselNext,
  CarouselIndicators,
} from '../../../src/primitives/Carousel.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Carousel', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Carousel Root Rendering Tests (10 tests)
  // ==========================================================================

  describe('Carousel Root Rendering Tests', () => {
    it('should render Carousel root', () => {
      const { container, cleanup: dispose } = renderComponent(() => Carousel({}));
      cleanup = dispose;

      const root = container.querySelector('[data-carousel]');
      expect(root).toBeTruthy();
    });

    it('should render as div element', () => {
      const { container, cleanup: dispose } = renderComponent(() => Carousel({}));
      cleanup = dispose;

      const root = container.querySelector('[data-carousel]');
      expect(root?.tagName).toBe('DIV');
    });

    it('should have role="region"', () => {
      const { container, cleanup: dispose } = renderComponent(() => Carousel({}));
      cleanup = dispose;

      const root = container.querySelector('[data-carousel]');
      expect(root?.getAttribute('role')).toBe('region');
    });

    it('should have aria-roledescription="carousel"', () => {
      const { container, cleanup: dispose } = renderComponent(() => Carousel({}));
      cleanup = dispose;

      const root = container.querySelector('[data-carousel]');
      expect(root?.getAttribute('aria-roledescription')).toBe('carousel');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() => Carousel({}));
      cleanup = dispose;

      const root = container.querySelector('[data-carousel]');
      expect(root?.getAttribute('aria-label')).toBe('Carousel');
    });

    it('should render with horizontal orientation by default', () => {
      const { container, cleanup: dispose } = renderComponent(() => Carousel({}));
      cleanup = dispose;

      const root = container.querySelector('[data-carousel]');
      expect(root?.getAttribute('data-orientation')).toBe('horizontal');
    });

    it('should render with vertical orientation', () => {
      const { container, cleanup: dispose } = renderComponent(() => Carousel({ orientation: 'vertical' }));
      cleanup = dispose;

      const root = container.querySelector('[data-carousel]');
      expect(root?.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should render with function children (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselViewport({ children: 'Content' }),
        })
      );
      cleanup = dispose;

      const viewport = container.querySelector('[data-carousel-viewport]');
      expect(viewport).toBeTruthy();
      expect(viewport?.textContent).toBe('Content');
    });

    it('should render multiple children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => [CarouselViewport({}), CarouselPrevious({}), CarouselNext({})],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-carousel-viewport]')).toBeTruthy();
      expect(container.querySelector('[data-carousel-previous]')).toBeTruthy();
      expect(container.querySelector('[data-carousel-next]')).toBeTruthy();
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() => Carousel({ children: () => null }));
      cleanup = dispose;

      const root = container.querySelector('[data-carousel]');
      expect(root).toBeTruthy();
    });
  });

  // ==========================================================================
  // Carousel Context Tests (8 tests)
  // ==========================================================================

  describe('Carousel Context Tests', () => {
    it('should provide currentIndex signal through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 1,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({ children: 'Slide 1' }), CarouselSlide({ children: 'Slide 2' })],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');
      expect(slides.length).toBe(2);
    });

    it('should provide totalSlides signal through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');
      expect(slides.length).toBe(3);
    });

    it('should provide orientation through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          orientation: 'vertical',
          children: () => CarouselViewport({}),
        })
      );
      cleanup = dispose;

      const viewport = container.querySelector('[data-carousel-viewport]');
      expect(viewport?.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should provide loop flag through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          loop: true,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
        })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-carousel]');
      expect(root).toBeTruthy();
    });

    it('should provide navigation functions through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => [CarouselPrevious({}), CarouselNext({})],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-carousel-previous]')).toBeTruthy();
      expect(container.querySelector('[data-carousel-next]')).toBeTruthy();
    });

    it('should provide canGoPrevious computed signal', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 0,
          loop: false,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');
      expect(slides.length).toBe(2);
    });

    it('should provide canGoNext computed signal', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 1,
          loop: false,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');
      expect(slides.length).toBe(2);
    });

    it('should allow all sub-components to access context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselPrevious({}),
            CarouselNext({}),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-carousel-viewport]')).toBeTruthy();
      expect(container.querySelector('[data-carousel-previous]')).toBeTruthy();
      expect(container.querySelector('[data-carousel-next]')).toBeTruthy();
      expect(container.querySelector('[data-carousel-indicators]')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Controlled/Uncontrolled Tests (8 tests)
  // ==========================================================================

  describe('Controlled/Uncontrolled Tests', () => {
    it('should work in uncontrolled mode with defaultValue', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 1,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({ children: 'Slide 1' }), CarouselSlide({ children: 'Slide 2' })],
            }),
        })
      );
      cleanup = dispose;

      const activeSlide = container.querySelector('[data-carousel-slide][data-active]');
      expect(activeSlide).toBeTruthy();
    });

    it('should work in controlled mode with value prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          value: 0,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({ children: 'Slide 1' }), CarouselSlide({ children: 'Slide 2' })],
            }),
        })
      );
      cleanup = dispose;

      const activeSlide = container.querySelector('[data-carousel-slide][data-active]');
      expect(activeSlide).toBeTruthy();
    });

    it('should call onValueChange when slide changes', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          onValueChange,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({}),
          ],
        })
      );
      cleanup = dispose;

      const nextButton = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      nextButton.click();

      expect(onValueChange).toHaveBeenCalledWith(1);
    });

    it('should use controlled value over internal state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          value: 1,
          defaultValue: 0,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({ children: 'Slide 1' }), CarouselSlide({ children: 'Slide 2' })],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');
      const activeSlide = container.querySelector('[data-carousel-slide][data-active]');
      expect(slides[1]).toBe(activeSlide);
    });

    it('should default to index 0 when no value provided', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({ children: 'Slide 1' }), CarouselSlide({ children: 'Slide 2' })],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');
      const activeSlide = container.querySelector('[data-carousel-slide][data-active]');
      expect(slides[0]).toBe(activeSlide);
    });

    it('should handle negative index with loop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          loop: true,
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselPrevious({}),
          ],
        })
      );
      cleanup = dispose;

      const prevButton = container.querySelector('[data-carousel-previous]') as HTMLButtonElement;
      prevButton.click();

      // Should wrap to last slide
      const activeSlide = container.querySelector('[data-carousel-slide][data-active]');
      expect(activeSlide).toBeTruthy();
    });

    it('should clamp index when not looping', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          loop: false,
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselPrevious({}),
          ],
        })
      );
      cleanup = dispose;

      const prevButton = container.querySelector('[data-carousel-previous]') as HTMLButtonElement;
      prevButton.click();

      // Should stay at index 0
      const slides = container.querySelectorAll('[data-carousel-slide]');
      const activeSlide = container.querySelector('[data-carousel-slide][data-active]');
      expect(slides[0]).toBe(activeSlide);
    });

    it('should handle empty slides gracefully', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => [CarouselViewport({}), CarouselNext({})],
        })
      );
      cleanup = dispose;

      const nextButton = container.querySelector('[data-carousel-next]') as HTMLButtonElement;

      // Should not throw when clicking next with no slides
      expect(() => nextButton.click()).not.toThrow();
    });
  });

  // ==========================================================================
  // CarouselViewport Tests (6 tests)
  // ==========================================================================

  describe('CarouselViewport Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselViewport({}),
        })
      );
      cleanup = dispose;

      const viewport = container.querySelector('[data-carousel-viewport]');
      expect(viewport?.tagName).toBe('DIV');
    });

    it('should have role="presentation"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselViewport({}),
        })
      );
      cleanup = dispose;

      const viewport = container.querySelector('[data-carousel-viewport]');
      expect(viewport?.getAttribute('role')).toBe('presentation');
    });

    it('should have data-orientation from context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          orientation: 'vertical',
          children: () => CarouselViewport({}),
        })
      );
      cleanup = dispose;

      const viewport = container.querySelector('[data-carousel-viewport]');
      expect(viewport?.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({ children: 'Slide 1' }), CarouselSlide({ children: 'Slide 2' })],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');
      expect(slides.length).toBe(2);
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () =>
            CarouselViewport({
              'data-testid': 'custom-viewport',
              className: 'custom-class',
            }),
        })
      );
      cleanup = dispose;

      const viewport = container.querySelector('[data-carousel-viewport]');
      expect(viewport?.getAttribute('data-testid')).toBe('custom-viewport');
      expect(viewport?.className).toContain('custom-class');
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselViewport({}),
        })
      );
      cleanup = dispose;

      const viewport = container.querySelector('[data-carousel-viewport]');
      expect(viewport).toBeTruthy();
    });
  });

  // ==========================================================================
  // CarouselSlide Tests (10 tests)
  // ==========================================================================

  describe('CarouselSlide Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () =>
            CarouselViewport({
              children: () => CarouselSlide({}),
            }),
        })
      );
      cleanup = dispose;

      const slide = container.querySelector('[data-carousel-slide]');
      expect(slide?.tagName).toBe('DIV');
    });

    it('should have role="group"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () =>
            CarouselViewport({
              children: () => CarouselSlide({}),
            }),
        })
      );
      cleanup = dispose;

      const slide = container.querySelector('[data-carousel-slide]');
      expect(slide?.getAttribute('role')).toBe('group');
    });

    it('should have aria-roledescription="slide"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () =>
            CarouselViewport({
              children: () => CarouselSlide({}),
            }),
        })
      );
      cleanup = dispose;

      const slide = container.querySelector('[data-carousel-slide]');
      expect(slide?.getAttribute('aria-roledescription')).toBe('slide');
    });

    it('should have aria-label with position', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');
      expect(slides[0]?.getAttribute('aria-label')).toMatch(/1 of 2/);
      expect(slides[1]?.getAttribute('aria-label')).toMatch(/2 of 2/);
    });

    it('should mark active slide with data-active', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 1,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({ children: 'Slide 1' }), CarouselSlide({ children: 'Slide 2' })],
            }),
        })
      );
      cleanup = dispose;

      const activeSlide = container.querySelector('[data-carousel-slide][data-active]');
      expect(activeSlide?.textContent).toBe('Slide 2');
    });

    it('should set aria-hidden on inactive slides', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 0,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');
      expect(slides[0]?.getAttribute('aria-hidden')).toBe('false');
      expect(slides[1]?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () =>
            CarouselViewport({
              children: () => CarouselSlide({ children: 'Slide Content' }),
            }),
        })
      );
      cleanup = dispose;

      const slide = container.querySelector('[data-carousel-slide]');
      expect(slide?.textContent).toBe('Slide Content');
    });

    it('should register with carousel context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => [
            CarouselViewport({
              children: () => [
                CarouselSlide({ children: 'Slide 1' }),
                CarouselSlide({ children: 'Slide 2' }),
                CarouselSlide({ children: 'Slide 3' }),
              ],
            }),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      const indicators = container.querySelectorAll('[data-carousel-indicator]');
      expect(indicators.length).toBe(3);
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () =>
            CarouselViewport({
              children: () =>
                CarouselSlide({
                  'data-testid': 'custom-slide',
                  className: 'custom-slide',
                }),
            }),
        })
      );
      cleanup = dispose;

      const slide = container.querySelector('[data-carousel-slide]');
      expect(slide?.getAttribute('data-testid')).toBe('custom-slide');
      expect(slide?.className).toContain('custom-slide');
    });

    it('should handle multiple slides correctly', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () =>
            CarouselViewport({
              children: () => [
                CarouselSlide({ children: '1' }),
                CarouselSlide({ children: '2' }),
                CarouselSlide({ children: '3' }),
                CarouselSlide({ children: '4' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');
      expect(slides.length).toBe(4);
    });
  });

  // ==========================================================================
  // CarouselPrevious Tests (8 tests)
  // ==========================================================================

  describe('CarouselPrevious Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselPrevious({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-previous]');
      expect(button?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselPrevious({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-previous]') as HTMLButtonElement;
      expect(button.type).toBe('button');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselPrevious({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-previous]');
      expect(button?.getAttribute('aria-label')).toBe('Previous slide');
    });

    it('should navigate to previous slide on click', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 1,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({ children: 'Slide 1' }), CarouselSlide({ children: 'Slide 2' })],
            }),
            CarouselPrevious({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-previous]') as HTMLButtonElement;
      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[1]?.hasAttribute('data-active')).toBe(true);

      button.click();

      expect(slides[0]?.hasAttribute('data-active')).toBe(true);
    });

    it('should be disabled at first slide when not looping', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          loop: false,
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselPrevious({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-previous]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should not be disabled at first slide when looping', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          loop: true,
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselPrevious({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-previous]') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselPrevious({ children: '←' }),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-previous]');
      expect(button?.textContent).toBe('←');
    });

    it('should call custom onClick handler', () => {
      const onClick = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 1, // Start at index 1 so Previous button is enabled
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselPrevious({ onClick }),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-previous]') as HTMLButtonElement;
      button.click();

      expect(onClick).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // CarouselNext Tests (8 tests)
  // ==========================================================================

  describe('CarouselNext Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselNext({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]');
      expect(button?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselNext({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      expect(button.type).toBe('button');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselNext({}),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]');
      expect(button?.getAttribute('aria-label')).toBe('Next slide');
    });

    it('should navigate to next slide on click', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({ children: 'Slide 1' }), CarouselSlide({ children: 'Slide 2' })],
            }),
            CarouselNext({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[0]?.hasAttribute('data-active')).toBe(true);

      button.click();

      expect(slides[1]?.hasAttribute('data-active')).toBe(true);
    });

    it('should be disabled at last slide when not looping', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          loop: false,
          defaultValue: 1,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should not be disabled at last slide when looping', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          loop: true,
          defaultValue: 1,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselNext({ children: '→' }),
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]');
      expect(button?.textContent).toBe('→');
    });

    it('should call custom onClick handler', () => {
      const onClick = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({ onClick }),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      button.click();

      expect(onClick).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // CarouselIndicators Tests (8 tests)
  // ==========================================================================

  describe('CarouselIndicators Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselIndicators({}),
        })
      );
      cleanup = dispose;

      const indicators = container.querySelector('[data-carousel-indicators]');
      expect(indicators?.tagName).toBe('DIV');
    });

    it('should have role="group"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselIndicators({}),
        })
      );
      cleanup = dispose;

      const indicators = container.querySelector('[data-carousel-indicators]');
      expect(indicators?.getAttribute('role')).toBe('group');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => CarouselIndicators({}),
        })
      );
      cleanup = dispose;

      const indicators = container.querySelector('[data-carousel-indicators]');
      expect(indicators?.getAttribute('aria-label')).toBe('Slide indicators');
    });

    it('should generate indicator buttons for each slide', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      const indicatorButtons = container.querySelectorAll('[data-carousel-indicator]');
      expect(indicatorButtons.length).toBe(3);
    });

    it('should mark active indicator with data-active', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 1,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      const indicators = container.querySelectorAll('[data-carousel-indicator]');
      expect(indicators[1]?.hasAttribute('data-active')).toBe(true);
    });

    it('should set aria-current on active indicator', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 2,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      const indicators = container.querySelectorAll('[data-carousel-indicator]');
      expect(indicators[2]?.getAttribute('aria-current')).toBe('true');
      expect(indicators[0]?.getAttribute('aria-current')).toBe('false');
    });

    it('should navigate to specific slide on indicator click', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [
                CarouselSlide({ children: '1' }),
                CarouselSlide({ children: '2' }),
                CarouselSlide({ children: '3' }),
              ],
            }),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      const indicators = container.querySelectorAll('[data-carousel-indicator]');
      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[0]?.hasAttribute('data-active')).toBe(true);

      (indicators[2] as HTMLButtonElement).click();

      expect(slides[2]?.hasAttribute('data-active')).toBe(true);
    });

    it('should have aria-label on each indicator button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      const indicators = container.querySelectorAll('[data-carousel-indicator]');
      expect(indicators[0]?.getAttribute('aria-label')).toMatch(/Go to slide 1/);
      expect(indicators[1]?.getAttribute('aria-label')).toMatch(/Go to slide 2/);
    });
  });

  // ==========================================================================
  // Navigation Tests (8 tests)
  // ==========================================================================

  describe('Navigation Tests', () => {
    it('should navigate forward through slides', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[0]?.hasAttribute('data-active')).toBe(true);

      button.click();
      expect(slides[1]?.hasAttribute('data-active')).toBe(true);

      button.click();
      expect(slides[2]?.hasAttribute('data-active')).toBe(true);
    });

    it('should navigate backward through slides', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 2,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselPrevious({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-previous]') as HTMLButtonElement;
      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[2]?.hasAttribute('data-active')).toBe(true);

      button.click();
      expect(slides[1]?.hasAttribute('data-active')).toBe(true);

      button.click();
      expect(slides[0]?.hasAttribute('data-active')).toBe(true);
    });

    it('should wrap to first slide when looping forward', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          loop: true,
          defaultValue: 2,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[2]?.hasAttribute('data-active')).toBe(true);

      button.click();

      expect(slides[0]?.hasAttribute('data-active')).toBe(true);
    });

    it('should wrap to last slide when looping backward', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          loop: true,
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselPrevious({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-previous]') as HTMLButtonElement;
      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[0]?.hasAttribute('data-active')).toBe(true);

      button.click();

      expect(slides[2]?.hasAttribute('data-active')).toBe(true);
    });

    it('should stay at last slide when not looping', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          loop: false,
          defaultValue: 1,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[1]?.hasAttribute('data-active')).toBe(true);

      button.click();

      // Should stay at slide 1 (last slide)
      expect(slides[1]?.hasAttribute('data-active')).toBe(true);
    });

    it('should stay at first slide when not looping', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          loop: false,
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselPrevious({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-previous]') as HTMLButtonElement;
      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[0]?.hasAttribute('data-active')).toBe(true);

      button.click();

      // Should stay at slide 0 (first slide)
      expect(slides[0]?.hasAttribute('data-active')).toBe(true);
    });

    it('should navigate to specific slide via goTo', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      const indicators = container.querySelectorAll('[data-carousel-indicator]');
      const slides = container.querySelectorAll('[data-carousel-slide]');

      (indicators[2] as HTMLButtonElement).click();

      expect(slides[2]?.hasAttribute('data-active')).toBe(true);
    });

    it('should update indicators when navigating', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({}),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      const indicators = container.querySelectorAll('[data-carousel-indicator]');

      expect(indicators[0]?.hasAttribute('data-active')).toBe(true);

      button.click();

      expect(indicators[1]?.hasAttribute('data-active')).toBe(true);
    });
  });

  // ==========================================================================
  // Autoplay Tests (6 tests)
  // ==========================================================================

  describe('Autoplay Tests', () => {
    it('should not autoplay by default', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 0,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[0]?.hasAttribute('data-active')).toBe(true);

      vi.advanceTimersByTime(5000);

      // Should still be on first slide
      expect(slides[0]?.hasAttribute('data-active')).toBe(true);
    });

    it('should autoplay when autoplay prop is set', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          autoplay: 1000,
          defaultValue: 0,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[0]?.hasAttribute('data-active')).toBe(true);

      vi.advanceTimersByTime(1000);

      // Should advance to next slide
      expect(slides[1]?.hasAttribute('data-active')).toBe(true);
    });

    it('should reset autoplay on manual navigation', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          autoplay: 2000,
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      const slides = container.querySelectorAll('[data-carousel-slide]');

      // Manually navigate
      button.click();

      expect(slides[1]?.hasAttribute('data-active')).toBe(true);

      // Wait for autoplay interval
      vi.advanceTimersByTime(2000);

      // Should advance to slide 2
      expect(slides[2]?.hasAttribute('data-active')).toBe(true);
    });

    it('should continue autoplay after reaching end when looping', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          autoplay: 1000,
          loop: true,
          defaultValue: 1,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[1]?.hasAttribute('data-active')).toBe(true);

      vi.advanceTimersByTime(1000);

      // Should wrap to first slide
      expect(slides[0]?.hasAttribute('data-active')).toBe(true);
    });

    it('should handle autoplay with single slide', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          autoplay: 1000,
          children: () =>
            CarouselViewport({
              children: () => CarouselSlide({}),
            }),
        })
      );
      cleanup = dispose;

      const slide = container.querySelector('[data-carousel-slide]');

      expect(slide?.hasAttribute('data-active')).toBe(true);

      vi.advanceTimersByTime(1000);

      // Should remain on same slide
      expect(slide?.hasAttribute('data-active')).toBe(true);
    });

    it('should not autoplay when autoplay is 0', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          autoplay: 0,
          defaultValue: 0,
          children: () =>
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');

      expect(slides[0]?.hasAttribute('data-active')).toBe(true);

      vi.advanceTimersByTime(5000);

      // Should still be on first slide
      expect(slides[0]?.hasAttribute('data-active')).toBe(true);
    });
  });

  // ==========================================================================
  // Integration Tests (6 tests)
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should render complete carousel with all components', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [
                CarouselSlide({ children: 'Slide 1' }),
                CarouselSlide({ children: 'Slide 2' }),
                CarouselSlide({ children: 'Slide 3' }),
              ],
            }),
            CarouselPrevious({ children: 'Prev' }),
            CarouselNext({ children: 'Next' }),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-carousel]')).toBeTruthy();
      expect(container.querySelector('[data-carousel-viewport]')).toBeTruthy();
      expect(container.querySelectorAll('[data-carousel-slide]').length).toBe(3);
      expect(container.querySelector('[data-carousel-previous]')).toBeTruthy();
      expect(container.querySelector('[data-carousel-next]')).toBeTruthy();
      expect(container.querySelector('[data-carousel-indicators]')).toBeTruthy();
      expect(container.querySelectorAll('[data-carousel-indicator]').length).toBe(3);
    });

    it('should synchronize all navigation methods', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          defaultValue: 0,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({}),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      const nextButton = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      const indicators = container.querySelectorAll('[data-carousel-indicator]');
      const slides = container.querySelectorAll('[data-carousel-slide]');

      // Navigate via button
      nextButton.click();

      // Check all components are synchronized
      expect(slides[1]?.hasAttribute('data-active')).toBe(true);
      expect(indicators[1]?.hasAttribute('data-active')).toBe(true);

      // Navigate via indicator
      (indicators[2] as HTMLButtonElement).click();

      expect(slides[2]?.hasAttribute('data-active')).toBe(true);
      expect(indicators[2]?.hasAttribute('data-active')).toBe(true);
    });

    it('should handle controlled mode with external state', () => {
      let currentIndex = 0;
      const onValueChange = (index: number) => {
        currentIndex = index;
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          value: currentIndex,
          onValueChange,
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({}),
          ],
        })
      );
      cleanup = dispose;

      const button = container.querySelector('[data-carousel-next]') as HTMLButtonElement;

      button.click();

      expect(currentIndex).toBe(1);
    });

    it('should work with vertical orientation', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          orientation: 'vertical',
          children: () => [
            CarouselViewport({
              children: () => [CarouselSlide({}), CarouselSlide({})],
            }),
            CarouselNext({}),
          ],
        })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-carousel]');
      const viewport = container.querySelector('[data-carousel-viewport]');

      expect(root?.getAttribute('data-orientation')).toBe('vertical');
      expect(viewport?.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should handle dynamic slide addition (Pattern 17 slide registration)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => [
            CarouselViewport({
              children: () => [
                CarouselSlide({ children: '1' }),
                CarouselSlide({ children: '2' }),
                CarouselSlide({ children: '3' }),
              ],
            }),
            CarouselIndicators({}),
          ],
        })
      );
      cleanup = dispose;

      const slides = container.querySelectorAll('[data-carousel-slide]');
      const indicators = container.querySelectorAll('[data-carousel-indicator]');

      // Should have matching counts
      expect(slides.length).toBe(3);
      expect(indicators.length).toBe(3);
    });

    it('should handle empty carousel gracefully', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Carousel({
          children: () => [CarouselViewport({}), CarouselPrevious({}), CarouselNext({}), CarouselIndicators({})],
        })
      );
      cleanup = dispose;

      const prevButton = container.querySelector('[data-carousel-previous]') as HTMLButtonElement;
      const nextButton = container.querySelector('[data-carousel-next]') as HTMLButtonElement;
      const indicators = container.querySelectorAll('[data-carousel-indicator]');

      expect(prevButton.disabled).toBe(true);
      expect(nextButton.disabled).toBe(true);
      expect(indicators.length).toBe(0);
    });
  });
});
