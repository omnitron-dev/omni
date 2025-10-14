/**
 * Accessibility Utilities for SVG
 *
 * Provides utilities for validating and improving SVG accessibility
 */

/**
 * Accessibility issue severity levels
 */
export type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * Accessibility issue
 */
export interface AccessibilityIssue {
  severity: IssueSeverity;
  message: string;
  element?: SVGElement;
  fix?: () => void;
  wcagRule?: string;
}

/**
 * Accessibility report
 */
export interface AccessibilityReport {
  passed: boolean;
  score: number;
  issues: AccessibilityIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

/**
 * Get the accessible name of an SVG element
 *
 * Follows the accessible name computation algorithm:
 * 1. aria-labelledby
 * 2. aria-label
 * 3. title element
 * 4. text content
 */
export function getAccessibleName(element: SVGElement): string {
  // Check aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    const names = ids
      .map((id) => {
        const el = document.getElementById(id);
        return el?.textContent?.trim() || '';
      })
      .filter(Boolean);
    if (names.length > 0) {
      return names.join(' ');
    }
  }

  // Check aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return ariaLabel.trim();
  }

  // Check title element
  const titleElement = element.querySelector('title');
  if (titleElement?.textContent) {
    return titleElement.textContent.trim();
  }

  // Check text content for text elements
  if (element.tagName.toLowerCase() === 'text' || element.tagName.toLowerCase() === 'tspan') {
    return element.textContent?.trim() || '';
  }

  return '';
}

/**
 * Validate accessibility of an SVG element
 *
 * Checks against WCAG 2.1 AA guidelines
 */
export function validateAccessibility(svg: SVGElement): AccessibilityReport {
  const issues: AccessibilityIssue[] = [];

  // Check for accessible name
  if (!hasAccessibleName(svg)) {
    issues.push({
      severity: 'error',
      message: 'SVG element lacks an accessible name (aria-label, aria-labelledby, or title)',
      element: svg,
      wcagRule: 'WCAG 1.1.1 Non-text Content (Level A)',
      fix: () => {
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Graphic');
      },
    });
  }

  // Check for proper role
  const role = svg.getAttribute('role');
  const ariaHidden = svg.getAttribute('aria-hidden');

  if (!role && ariaHidden !== 'true') {
    issues.push({
      severity: 'warning',
      message: 'SVG element should have a role attribute (e.g., "img", "graphics-document")',
      element: svg,
      wcagRule: 'WCAG 4.1.2 Name, Role, Value (Level A)',
      fix: () => {
        svg.setAttribute('role', 'img');
      },
    });
  }

  // Check for decorative SVGs without aria-hidden
  if (ariaHidden !== 'true' && !hasAccessibleName(svg) && role === 'presentation') {
    issues.push({
      severity: 'info',
      message: 'Decorative SVG should have aria-hidden="true"',
      element: svg,
      fix: () => {
        svg.setAttribute('aria-hidden', 'true');
      },
    });
  }

  // Check interactive elements for keyboard accessibility
  const interactiveElements = svg.querySelectorAll('[onclick], a[href], button');
  interactiveElements.forEach((element) => {
    if (!isKeyboardAccessible(element as SVGElement)) {
      issues.push({
        severity: 'error',
        message: `Interactive element <${element.tagName.toLowerCase()}> is not keyboard accessible`,
        element: element as SVGElement,
        wcagRule: 'WCAG 2.1.1 Keyboard (Level A)',
        fix: () => {
          (element as SVGElement).setAttribute('tabindex', '0');
        },
      });
    }

    if (!hasAccessibleName(element as SVGElement)) {
      issues.push({
        severity: 'error',
        message: `Interactive element <${element.tagName.toLowerCase()}> lacks an accessible name`,
        element: element as SVGElement,
        wcagRule: 'WCAG 4.1.2 Name, Role, Value (Level A)',
      });
    }
  });

  // Check text elements for sufficient contrast (if background color is detectable)
  const textElements = svg.querySelectorAll('text, tspan');
  textElements.forEach((element) => {
    const fill = window.getComputedStyle(element as SVGElement).fill;
    if (fill === 'rgb(0, 0, 0)' || fill === '#000000' || fill === 'black') {
      issues.push({
        severity: 'info',
        message: 'Text element may not have sufficient color contrast',
        element: element as SVGElement,
        wcagRule: 'WCAG 1.4.3 Contrast (Minimum) (Level AA)',
      });
    }
  });

  // Check for missing title/desc elements
  const hasTitle = svg.querySelector('title') !== null;
  const hasDesc = svg.querySelector('desc') !== null;
  const ariaLabel = svg.getAttribute('aria-label');
  const labelledBy = svg.getAttribute('aria-labelledby');

  if (!hasTitle && !ariaLabel && !labelledBy) {
    issues.push({
      severity: 'warning',
      message: 'SVG lacks a title element for accessibility',
      element: svg,
      wcagRule: 'WCAG 1.1.1 Non-text Content (Level A)',
      fix: () => {
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = 'Graphic';
        svg.insertBefore(title, svg.firstChild);
      },
    });
  }

  // Check for complex graphics without description
  const hasComplexContent = svg.querySelectorAll('path, circle, rect, polygon').length > 5;
  if (hasComplexContent && !hasDesc && !svg.getAttribute('aria-describedby')) {
    issues.push({
      severity: 'info',
      message: 'Complex SVG graphic should have a description (desc element or aria-describedby)',
      element: svg,
      wcagRule: 'WCAG 1.1.1 Non-text Content (Level A)',
    });
  }

  // Calculate score and summary
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const info = issues.filter((i) => i.severity === 'info').length;

  const totalChecks = 8;
  const passedChecks = totalChecks - errors - warnings * 0.5;
  const score = Math.max(0, Math.round((passedChecks / totalChecks) * 100));

  return {
    passed: errors === 0,
    score,
    issues,
    summary: {
      errors,
      warnings,
      info,
    },
  };
}

/**
 * Generate a detailed accessibility report
 */
export function generateAccessibilityReport(svg: SVGElement): string {
  const report = validateAccessibility(svg);

  const lines: string[] = [];
  lines.push('=== SVG Accessibility Report ===');
  lines.push('');
  lines.push(`Score: ${report.score}/100`);
  lines.push(`Status: ${report.passed ? 'PASSED' : 'FAILED'}`);
  lines.push('');
  lines.push('Summary:');
  lines.push(`  Errors: ${report.summary.errors}`);
  lines.push(`  Warnings: ${report.summary.warnings}`);
  lines.push(`  Info: ${report.summary.info}`);
  lines.push('');

  if (report.issues.length > 0) {
    lines.push('Issues:');
    report.issues.forEach((issue, index) => {
      lines.push(`${index + 1}. [${issue.severity.toUpperCase()}] ${issue.message}`);
      if (issue.wcagRule) {
        lines.push(`   WCAG: ${issue.wcagRule}`);
      }
      if (issue.fix) {
        lines.push('   (Auto-fix available)');
      }
      lines.push('');
    });
  } else {
    lines.push('No issues found! 🎉');
  }

  return lines.join('\n');
}

/**
 * Automatically fix common accessibility issues
 */
export function fixCommonA11yIssues(svg: SVGElement): AccessibilityReport {
  const report = validateAccessibility(svg);

  // Apply auto-fixes
  report.issues.forEach((issue) => {
    if (issue.fix) {
      try {
        issue.fix();
      } catch (error) {
        console.error('Failed to apply auto-fix:', error);
      }
    }
  });

  // Return updated report
  return validateAccessibility(svg);
}

/**
 * Check if element has an accessible name
 */
function hasAccessibleName(element: SVGElement): boolean {
  const name = getAccessibleName(element);
  return name.length > 0;
}

/**
 * Check if element is keyboard accessible
 */
function isKeyboardAccessible(element: SVGElement): boolean {
  const tabIndex = element.getAttribute('tabindex');
  const focusable = element.getAttribute('focusable');

  // Check if element is naturally focusable
  if (element.tagName.toLowerCase() === 'a' && element.hasAttribute('href')) {
    return true;
  }

  if (element.tagName.toLowerCase() === 'button') {
    return true;
  }

  // Check if element has tabindex (but not -1)
  if (tabIndex !== null && tabIndex !== '-1') {
    return true;
  }

  // Check focusable attribute
  if (focusable === 'true') {
    return true;
  }

  return false;
}

/**
 * Check if SVG element is decorative
 */
export function isDecorative(svg: SVGElement): boolean {
  const ariaHidden = svg.getAttribute('aria-hidden');
  const role = svg.getAttribute('role');

  return ariaHidden === 'true' || role === 'presentation' || role === 'none';
}

/**
 * Mark SVG as decorative
 */
export function markAsDecorative(svg: SVGElement): void {
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('role', 'presentation');
}

/**
 * Remove decorative marking from SVG
 */
export function unmarkAsDecorative(svg: SVGElement): void {
  svg.removeAttribute('aria-hidden');
  if (svg.getAttribute('role') === 'presentation' || svg.getAttribute('role') === 'none') {
    svg.removeAttribute('role');
  }
}

/**
 * Add accessible description to SVG
 */
export function addAccessibleDescription(svg: SVGElement, title: string, description?: string): void {
  // Add or update title element
  let titleElement = svg.querySelector('title') as SVGTitleElement | null;
  if (!titleElement) {
    titleElement = document.createElementNS('http://www.w3.org/2000/svg', 'title') as SVGTitleElement;
    svg.insertBefore(titleElement, svg.firstChild);
  }
  titleElement.textContent = title;

  if (!titleElement.id) {
    titleElement.id = `svg-title-${Date.now()}`;
  }

  // Add or update desc element if description provided
  if (description) {
    let descElement = svg.querySelector('desc') as SVGDescElement | null;
    if (!descElement) {
      descElement = document.createElementNS('http://www.w3.org/2000/svg', 'desc') as SVGDescElement;
      if (titleElement.nextSibling) {
        svg.insertBefore(descElement, titleElement.nextSibling);
      } else {
        svg.appendChild(descElement);
      }
    }
    descElement.textContent = description;

    if (!descElement.id) {
      descElement.id = `svg-desc-${Date.now()}`;
    }

    // Set aria-describedby
    svg.setAttribute('aria-describedby', descElement.id);
  }

  // Set aria-labelledby
  svg.setAttribute('aria-labelledby', titleElement.id);

  // Set role if not present
  if (!svg.getAttribute('role')) {
    svg.setAttribute('role', 'img');
  }
}

/**
 * Get SVG accessibility information
 */
export function getAccessibilityInfo(svg: SVGElement): {
  hasAccessibleName: boolean;
  accessibleName: string;
  role: string | null;
  isDecorative: boolean;
  isKeyboardAccessible: boolean;
  hasTitle: boolean;
  hasDescription: boolean;
} {
  const name = getAccessibleName(svg);

  return {
    hasAccessibleName: name.length > 0,
    accessibleName: name,
    role: svg.getAttribute('role'),
    isDecorative: isDecorative(svg),
    isKeyboardAccessible: isKeyboardAccessible(svg),
    hasTitle: svg.querySelector('title') !== null,
    hasDescription: svg.querySelector('desc') !== null || svg.hasAttribute('aria-describedby'),
  };
}

/**
 * Generate accessible title for SVG
 *
 * Creates a meaningful title based on SVG content and attributes
 */
export function generateAccessibleTitle(svg: SVGElement, fallback = 'Graphic'): string {
  // Check for existing title
  const existingTitle = svg.querySelector('title')?.textContent?.trim();
  if (existingTitle) {
    return existingTitle;
  }

  // Check for aria-label
  const ariaLabel = svg.getAttribute('aria-label');
  if (ariaLabel) {
    return ariaLabel;
  }

  // Check for data attributes
  const dataLabel = svg.getAttribute('data-label') || svg.getAttribute('data-name');
  if (dataLabel) {
    return dataLabel;
  }

  // Try to infer from class names
  const className = svg.getAttribute('class');
  if (className) {
    const iconMatch = className.match(/icon-(\w+)/);
    if (iconMatch && iconMatch[1]) {
      return iconMatch[1].replace(/-/g, ' ');
    }
  }

  // Try to infer from ID
  const id = svg.id;
  if (id) {
    return id.replace(/-/g, ' ').replace(/_/g, ' ');
  }

  return fallback;
}

/**
 * Generate accessible description for SVG
 *
 * Creates a detailed description based on SVG structure
 */
export function generateAccessibleDescription(svg: SVGElement): string {
  const parts: string[] = [];

  // Check for existing description
  const existingDesc = svg.querySelector('desc')?.textContent?.trim();
  if (existingDesc) {
    return existingDesc;
  }

  // Count and describe elements
  const shapes = svg.querySelectorAll('circle, rect, ellipse, polygon, path').length;
  const texts = svg.querySelectorAll('text, tspan').length;
  const images = svg.querySelectorAll('image').length;

  if (shapes > 0) {
    parts.push(`${shapes} shape${shapes > 1 ? 's' : ''}`);
  }
  if (texts > 0) {
    parts.push(`${texts} text element${texts > 1 ? 's' : ''}`);
  }
  if (images > 0) {
    parts.push(`${images} image${images > 1 ? 's' : ''}`);
  }

  // Check for colors
  const fills = new Set<string>();
  svg.querySelectorAll('[fill]').forEach((el) => {
    const fill = el.getAttribute('fill');
    if (fill && fill !== 'none' && fill !== 'transparent') {
      fills.add(fill);
    }
  });

  if (fills.size > 0) {
    parts.push(`using ${fills.size} color${fills.size > 1 ? 's' : ''}`);
  }

  if (parts.length === 0) {
    return 'SVG graphic';
  }

  return `Graphic containing ${parts.join(', ')}`;
}

/**
 * Ensure unique ID for ARIA references
 */
export function ensureUniqueId(element: Element, prefix = 'svg-element'): string {
  if (element.id) {
    return element.id;
  }

  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  element.id = id;
  return id;
}
