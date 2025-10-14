import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getAccessibleName,
  validateAccessibility,
  generateAccessibilityReport,
  fixCommonA11yIssues,
  isDecorative,
  markAsDecorative,
  unmarkAsDecorative,
  addAccessibleDescription,
  getAccessibilityInfo,
} from '../../../src/svg/accessibility/utils.js';

describe('Accessibility Utilities', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('getAccessibleName', () => {
    it('should get name from aria-labelledby', () => {
      const label = document.createElement('div');
      label.id = 'test-label';
      label.textContent = 'Test Label';
      document.body.appendChild(label);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-labelledby', 'test-label');

      const name = getAccessibleName(svg);
      expect(name).toBe('Test Label');

      document.body.removeChild(label);
    });

    it('should get name from aria-label', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-label', 'Direct Label');

      const name = getAccessibleName(svg);
      expect(name).toBe('Direct Label');
    });

    it('should get name from title element', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Title Text';
      svg.appendChild(title);

      const name = getAccessibleName(svg);
      expect(name).toBe('Title Text');
    });

    it('should prioritize aria-labelledby over aria-label', () => {
      const label = document.createElement('div');
      label.id = 'priority-label';
      label.textContent = 'Priority Label';
      document.body.appendChild(label);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-labelledby', 'priority-label');
      svg.setAttribute('aria-label', 'Should be ignored');

      const name = getAccessibleName(svg);
      expect(name).toBe('Priority Label');

      document.body.removeChild(label);
    });

    it('should handle multiple labelledby IDs', () => {
      const label1 = document.createElement('div');
      label1.id = 'label-1';
      label1.textContent = 'First';
      const label2 = document.createElement('div');
      label2.id = 'label-2';
      label2.textContent = 'Second';
      document.body.appendChild(label1);
      document.body.appendChild(label2);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-labelledby', 'label-1 label-2');

      const name = getAccessibleName(svg);
      expect(name).toBe('First Second');

      document.body.removeChild(label1);
      document.body.removeChild(label2);
    });

    it('should return empty string for unlabeled element', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      const name = getAccessibleName(svg);
      expect(name).toBe('');
    });
  });

  describe('validateAccessibility', () => {
    it('should pass for fully accessible SVG', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Accessible SVG';
      svg.appendChild(title);
      svg.setAttribute('role', 'img');

      const report = validateAccessibility(svg);
      expect(report.passed).toBe(true);
      expect(report.score).toBeGreaterThan(80);
    });

    it('should fail for SVG without accessible name', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      const report = validateAccessibility(svg);
      expect(report.passed).toBe(false);
      expect(report.summary.errors).toBeGreaterThan(0);
    });

    it('should warn about missing role', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Test';
      svg.appendChild(title);

      const report = validateAccessibility(svg);
      expect(report.summary.warnings).toBeGreaterThan(0);
    });

    it('should check interactive elements for keyboard accessibility', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Test';
      svg.appendChild(title);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('onclick', 'alert("click")');
      svg.appendChild(circle);

      const report = validateAccessibility(svg);
      expect(report.summary.errors).toBeGreaterThan(0);
    });

    it('should check for missing title', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      const report = validateAccessibility(svg);
      const hasWarning = report.issues.some((issue) => issue.message.includes('title'));
      expect(hasWarning).toBe(true);
    });

    it('should suggest description for complex graphics', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Complex';
      svg.appendChild(title);

      // Add many elements to make it complex
      for (let i = 0; i < 10; i++) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        svg.appendChild(path);
      }

      const report = validateAccessibility(svg);
      const hasInfo = report.issues.some((issue) => issue.message.includes('description'));
      expect(hasInfo).toBe(true);
    });

    it('should ignore decorative SVGs', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-hidden', 'true');

      const report = validateAccessibility(svg);
      // Should have fewer issues since it's decorative
      expect(report.issues.length).toBeLessThan(3);
    });
  });

  describe('generateAccessibilityReport', () => {
    it('should generate readable report', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      const report = generateAccessibilityReport(svg);
      expect(report).toContain('Accessibility Report');
      expect(report).toContain('Score:');
      expect(report).toContain('Status:');
    });

    it('should show passed status for accessible SVG', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Test';
      svg.appendChild(title);
      svg.setAttribute('role', 'img');

      const report = generateAccessibilityReport(svg);
      expect(report).toContain('PASSED');
    });

    it('should list all issues', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      const report = generateAccessibilityReport(svg);
      expect(report).toContain('Issues:');
    });

    it('should show WCAG rules', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      const report = generateAccessibilityReport(svg);
      expect(report).toContain('WCAG');
    });
  });

  describe('fixCommonA11yIssues', () => {
    it('should fix missing title', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      fixCommonA11yIssues(svg);

      const title = svg.querySelector('title');
      expect(title).not.toBeNull();
    });

    it('should fix missing role', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Test';
      svg.appendChild(title);

      fixCommonA11yIssues(svg);

      expect(svg.getAttribute('role')).toBe('img');
    });

    it('should fix keyboard accessibility for interactive elements', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Test';
      svg.appendChild(title);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('onclick', 'alert("click")');
      svg.appendChild(circle);

      fixCommonA11yIssues(svg);

      expect(circle.getAttribute('tabindex')).toBe('0');
    });

    it('should return updated report', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      const report = fixCommonA11yIssues(svg);
      expect(report.passed).toBeDefined();
      expect(report.score).toBeGreaterThan(0);
    });
  });

  describe('isDecorative', () => {
    it('should detect aria-hidden', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-hidden', 'true');

      expect(isDecorative(svg)).toBe(true);
    });

    it('should detect presentation role', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('role', 'presentation');

      expect(isDecorative(svg)).toBe(true);
    });

    it('should detect none role', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('role', 'none');

      expect(isDecorative(svg)).toBe(true);
    });

    it('should return false for non-decorative', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      expect(isDecorative(svg)).toBe(false);
    });
  });

  describe('markAsDecorative', () => {
    it('should mark SVG as decorative', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      markAsDecorative(svg);

      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('role')).toBe('presentation');
    });
  });

  describe('unmarkAsDecorative', () => {
    it('should remove decorative attributes', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      markAsDecorative(svg);

      unmarkAsDecorative(svg);

      expect(svg.hasAttribute('aria-hidden')).toBe(false);
      expect(svg.hasAttribute('role')).toBe(false);
    });

    it('should preserve non-presentation roles', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-hidden', 'true');

      unmarkAsDecorative(svg);

      expect(svg.getAttribute('role')).toBe('img');
    });
  });

  describe('addAccessibleDescription', () => {
    it('should add title and description', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      addAccessibleDescription(svg, 'Title', 'Description');

      const title = svg.querySelector('title');
      const desc = svg.querySelector('desc');

      expect(title?.textContent).toBe('Title');
      expect(desc?.textContent).toBe('Description');
    });

    it('should set aria-labelledby', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      addAccessibleDescription(svg, 'Title');

      const title = svg.querySelector('title');
      expect(svg.getAttribute('aria-labelledby')).toBe(title?.id);
    });

    it('should set aria-describedby', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      addAccessibleDescription(svg, 'Title', 'Description');

      const desc = svg.querySelector('desc');
      expect(svg.getAttribute('aria-describedby')).toBe(desc?.id);
    });

    it('should set role if missing', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      addAccessibleDescription(svg, 'Title');

      expect(svg.getAttribute('role')).toBe('img');
    });

    it('should update existing title', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Old';
      svg.appendChild(title);

      addAccessibleDescription(svg, 'New');

      expect(svg.querySelector('title')?.textContent).toBe('New');
    });
  });

  describe('getAccessibilityInfo', () => {
    it('should return complete accessibility info', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Test';
      svg.appendChild(title);
      svg.setAttribute('role', 'img');
      svg.setAttribute('tabindex', '0');

      const info = getAccessibilityInfo(svg);

      expect(info.hasAccessibleName).toBe(true);
      expect(info.accessibleName).toBe('Test');
      expect(info.role).toBe('img');
      expect(info.isDecorative).toBe(false);
      expect(info.isKeyboardAccessible).toBe(true);
      expect(info.hasTitle).toBe(true);
    });

    it('should detect decorative SVG', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      markAsDecorative(svg);

      const info = getAccessibilityInfo(svg);

      expect(info.isDecorative).toBe(true);
    });

    it('should detect missing accessible name', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      const info = getAccessibilityInfo(svg);

      expect(info.hasAccessibleName).toBe(false);
      expect(info.accessibleName).toBe('');
    });
  });
});
