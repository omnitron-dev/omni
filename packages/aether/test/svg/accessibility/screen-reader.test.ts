import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useScreenReaderAnnounce,
  useVerboseDescription,
  createSROnlyText,
  DebouncedAnnouncer,
} from '../../../src/svg/accessibility/screen-reader.js';

describe('Screen Reader Support', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    // Clean up any live regions
    const liveRegions = document.querySelectorAll('.aether-sr-only');
    liveRegions.forEach((el) => el.remove());
  });

  describe('useScreenReaderAnnounce', () => {
    it('should create a live region', () => {
      const { announce } = useScreenReaderAnnounce();

      // Live region should be created
      const liveRegion = document.querySelector('[role="status"]');
      expect(liveRegion).not.toBeNull();
    });

    it('should announce a message', (done) => {
      const { announce } = useScreenReaderAnnounce();

      announce('Test message');

      // Wait for announcement to be set
      setTimeout(() => {
        const liveRegion = document.querySelector('[role="status"]');
        expect(liveRegion?.textContent).toBe('Test message');
        done();
      }, 150);
    });

    it('should support polite priority', (done) => {
      const { announce } = useScreenReaderAnnounce();

      announce('Polite message', 'polite');

      setTimeout(() => {
        const liveRegion = document.querySelector('[role="status"]');
        expect(liveRegion?.getAttribute('aria-live')).toBe('polite');
        done();
      }, 150);
    });

    it('should support assertive priority', (done) => {
      const { announce } = useScreenReaderAnnounce();

      announce('Urgent message', 'assertive');

      setTimeout(() => {
        const liveRegion = document.querySelector('[role="status"]');
        expect(liveRegion?.getAttribute('aria-live')).toBe('assertive');
        done();
      }, 150);
    });

    it('should clear announcements', (done) => {
      const { announce, clear } = useScreenReaderAnnounce();

      announce('Test message');

      setTimeout(() => {
        clear();
        const liveRegion = document.querySelector('[role="status"]');
        expect(liveRegion?.textContent).toBe('');
        done();
      }, 150);
    });

    it('should replace pending announcement', (done) => {
      const { announce } = useScreenReaderAnnounce();

      announce('First message');
      announce('Second message');

      setTimeout(() => {
        const liveRegion = document.querySelector('[role="status"]');
        expect(liveRegion?.textContent).toBe('Second message');
        done();
      }, 150);
    });

    it('should handle repeated messages', (done) => {
      const { announce } = useScreenReaderAnnounce();

      announce('Same message');

      setTimeout(() => {
        announce('Same message');

        setTimeout(() => {
          const liveRegion = document.querySelector('[role="status"]');
          expect(liveRegion?.textContent).toBe('Same message');
          done();
        }, 150);
      }, 150);
    });
  });

  describe('DebouncedAnnouncer', () => {
    it('should debounce announcements', (done) => {
      const announcer = new DebouncedAnnouncer(100);
      const mockAnnounce = vi.fn();

      announcer.announce('Message 1', mockAnnounce);
      announcer.announce('Message 2', mockAnnounce);
      announcer.announce('Message 3', mockAnnounce);

      // Should only call once after debounce period
      setTimeout(() => {
        expect(mockAnnounce).toHaveBeenCalledTimes(1);
        expect(mockAnnounce).toHaveBeenCalledWith('Message 3', 'polite');
        done();
      }, 150);
    });

    it('should clear pending announcement', () => {
      const announcer = new DebouncedAnnouncer(100);
      const mockAnnounce = vi.fn();

      announcer.announce('Message', mockAnnounce);
      announcer.clear();

      setTimeout(() => {
        expect(mockAnnounce).not.toHaveBeenCalled();
      }, 150);
    });

    it('should support custom priority', (done) => {
      const announcer = new DebouncedAnnouncer(100, 'assertive');
      const mockAnnounce = vi.fn();

      announcer.announce('Urgent', mockAnnounce);

      setTimeout(() => {
        expect(mockAnnounce).toHaveBeenCalledWith('Urgent', 'assertive');
        done();
      }, 150);
    });
  });

  describe('useVerboseDescription', () => {
    it('should describe an SVG element', () => {
      const { describe } = useVerboseDescription();

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-label', 'Test graphic');

      const description = describe(svg);
      expect(description).toContain('graphic');
      expect(description).toContain('Test graphic');
    });

    it('should describe element with title', () => {
      const { describe } = useVerboseDescription();

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Chart Title';
      svg.appendChild(title);

      const description = describe(svg);
      expect(description).toContain('Chart Title');
    });

    it('should include data values when requested', () => {
      const { describe } = useVerboseDescription({ includeDataValues: true });

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-value', '75');

      const description = describe(svg);
      expect(description).toContain('75');
    });

    it('should extract text content from text elements', () => {
      const { describe } = useVerboseDescription({ includeDataValues: true });

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.textContent = '50%';
      svg.appendChild(text);

      const description = describe(svg);
      expect(description).toContain('50%');
    });

    it('should announce description', (done) => {
      const { announceDescription } = useVerboseDescription();

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-label', 'Test');

      announceDescription(svg);

      setTimeout(() => {
        const liveRegion = document.querySelector('[role="status"]');
        expect(liveRegion?.textContent).toBeTruthy();
        done();
      }, 150);
    });
  });

  describe('createSROnlyText', () => {
    it('should create screen reader only text', () => {
      const span = createSROnlyText('Hidden text');

      expect(span.textContent).toBe('Hidden text');
      expect(span.className).toBe('aether-sr-only');
      expect(span.style.position).toBe('absolute');
      expect(span.style.left).toBe('-10000px');
    });

    it('should be visually hidden but accessible', () => {
      const span = createSROnlyText('Test');

      // Should be positioned off-screen
      expect(span.style.position).toBe('absolute');
      expect(span.style.left).toBe('-10000px');

      // Should be very small
      expect(span.style.width).toBe('1px');
      expect(span.style.height).toBe('1px');

      // Should have hidden overflow
      expect(span.style.overflow).toBe('hidden');
    });
  });

  describe('Accessible Name Extraction', () => {
    it('should prioritize aria-labelledby', () => {
      const { describe } = useVerboseDescription();

      const label = document.createElement('div');
      label.id = 'test-label';
      label.textContent = 'Label text';
      document.body.appendChild(label);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-labelledby', 'test-label');
      svg.setAttribute('aria-label', 'Should be ignored');

      const description = describe(svg);
      expect(description).toContain('Label text');

      document.body.removeChild(label);
    });

    it('should fall back to aria-label', () => {
      const { describe } = useVerboseDescription();

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-label', 'Direct label');

      const description = describe(svg);
      expect(description).toContain('Direct label');
    });

    it('should fall back to title element', () => {
      const { describe } = useVerboseDescription();

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Title text';
      svg.appendChild(title);

      const description = describe(svg);
      expect(description).toContain('Title text');
    });
  });

  describe('Element Type Descriptions', () => {
    it('should describe circle elements', () => {
      const { describe } = useVerboseDescription();

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const description = describe(circle);
      expect(description).toContain('circle');
    });

    it('should describe rect elements', () => {
      const { describe } = useVerboseDescription();

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const description = describe(rect);
      expect(description).toContain('rectangle');
    });

    it('should describe path elements', () => {
      const { describe } = useVerboseDescription();

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const description = describe(path);
      expect(description).toContain('path');
    });
  });
});
