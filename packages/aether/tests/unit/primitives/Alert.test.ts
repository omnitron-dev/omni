/**
 * Alert Primitive Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Alert, AlertIcon, AlertTitle, AlertDescription } from '../../../src/primitives/Alert.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Alert', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Rendering', () => {
    it('should render a div with role="alert"', () => {
      const { container, cleanup: dispose } = renderComponent(() => Alert({}));
      cleanup = dispose;

      const alert = container.querySelector('div[role="alert"]');
      expect(alert).toBeTruthy();
    });

    it('should render with data-alert attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() => Alert({}));
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert).toBeTruthy();
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          children: 'Alert message',
        })
      );
      cleanup = dispose;

      expect(container.textContent).toContain('Alert message');
    });

    it('should render multiple children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          children: ['Warning: ', 'Action required'],
        })
      );
      cleanup = dispose;

      expect(container.textContent).toContain('Warning:');
      expect(container.textContent).toContain('Action required');
    });
  });

  describe('Variants', () => {
    it('should use default variant by default', () => {
      const { container, cleanup: dispose } = renderComponent(() => Alert({}));
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.getAttribute('data-variant')).toBe('default');
    });

    it('should support info variant', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          variant: 'info',
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.getAttribute('data-variant')).toBe('info');
    });

    it('should support success variant', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          variant: 'success',
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.getAttribute('data-variant')).toBe('success');
    });

    it('should support warning variant', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          variant: 'warning',
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.getAttribute('data-variant')).toBe('warning');
    });

    it('should support error variant', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          variant: 'error',
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.getAttribute('data-variant')).toBe('error');
    });
  });

  describe('ARIA Role', () => {
    it('should use alert role by default', () => {
      const { container, cleanup: dispose } = renderComponent(() => Alert({}));
      cleanup = dispose;

      const alert = container.querySelector('div[role="alert"]');
      expect(alert).toBeTruthy();
    });

    it('should support status role', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          role: 'status',
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[role="status"]');
      expect(alert).toBeTruthy();
    });
  });

  describe('Props', () => {
    it('should accept and apply className', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          className: 'custom-alert',
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.className).toBe('custom-alert');
    });

    it('should accept and apply style', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          style: { backgroundColor: 'yellow' },
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]') as HTMLDivElement;
      expect(alert.style.backgroundColor).toBe('yellow');
    });

    it('should accept and apply data attributes', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          'data-testid': 'my-alert',
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.getAttribute('data-testid')).toBe('my-alert');
    });

    it('should accept and apply aria attributes', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          'aria-label': 'Important notification',
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.getAttribute('aria-label')).toBe('Important notification');
    });

    it('should accept and apply id', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          id: 'my-alert',
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.id).toBe('my-alert');
    });
  });

  describe('DisplayName', () => {
    it('should have correct displayName', () => {
      expect(Alert.displayName).toBe('Alert');
    });
  });
});

describe('AlertIcon', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Rendering', () => {
    it('should render a div with data-alert-icon attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() => AlertIcon({}));
      cleanup = dispose;

      const icon = container.querySelector('div[data-alert-icon]');
      expect(icon).toBeTruthy();
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertIcon({
          children: '!',
        })
      );
      cleanup = dispose;

      const icon = container.querySelector('div[data-alert-icon]');
      expect(icon?.textContent).toBe('!');
    });

    it('should have aria-hidden="true"', () => {
      const { container, cleanup: dispose } = renderComponent(() => AlertIcon({}));
      cleanup = dispose;

      const icon = container.querySelector('div[data-alert-icon]');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('Props', () => {
    it('should accept and apply className', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertIcon({
          className: 'custom-icon',
        })
      );
      cleanup = dispose;

      const icon = container.querySelector('div[data-alert-icon]');
      expect(icon?.className).toBe('custom-icon');
    });

    it('should accept and apply style', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertIcon({
          style: { color: 'red' },
        })
      );
      cleanup = dispose;

      const icon = container.querySelector('div[data-alert-icon]') as HTMLDivElement;
      expect(icon.style.color).toBe('red');
    });

    it('should accept and apply data attributes', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertIcon({
          'data-testid': 'my-icon',
        })
      );
      cleanup = dispose;

      const icon = container.querySelector('div[data-alert-icon]');
      expect(icon?.getAttribute('data-testid')).toBe('my-icon');
    });
  });

  describe('DisplayName', () => {
    it('should have correct displayName', () => {
      expect(AlertIcon.displayName).toBe('Alert.Icon');
    });
  });
});

describe('AlertTitle', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Rendering', () => {
    it('should render with data-alert-title attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() => AlertTitle({}));
      cleanup = dispose;

      const title = container.querySelector('[data-alert-title]');
      expect(title).toBeTruthy();
    });

    it('should render as h5 by default', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          children: 'Alert Title',
        })
      );
      cleanup = dispose;

      const title = container.querySelector('h5[data-alert-title]');
      expect(title).toBeTruthy();
      expect(title?.textContent).toBe('Alert Title');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          children: 'Warning',
        })
      );
      cleanup = dispose;

      const title = container.querySelector('[data-alert-title]');
      expect(title?.textContent).toBe('Warning');
    });
  });

  describe('Heading Level', () => {
    it('should support h1', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          as: 'h1',
          children: 'Title',
        })
      );
      cleanup = dispose;

      const title = container.querySelector('h1[data-alert-title]');
      expect(title).toBeTruthy();
    });

    it('should support h2', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          as: 'h2',
          children: 'Title',
        })
      );
      cleanup = dispose;

      const title = container.querySelector('h2[data-alert-title]');
      expect(title).toBeTruthy();
    });

    it('should support h3', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          as: 'h3',
          children: 'Title',
        })
      );
      cleanup = dispose;

      const title = container.querySelector('h3[data-alert-title]');
      expect(title).toBeTruthy();
    });

    it('should support h4', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          as: 'h4',
          children: 'Title',
        })
      );
      cleanup = dispose;

      const title = container.querySelector('h4[data-alert-title]');
      expect(title).toBeTruthy();
    });

    it('should support h5', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          as: 'h5',
          children: 'Title',
        })
      );
      cleanup = dispose;

      const title = container.querySelector('h5[data-alert-title]');
      expect(title).toBeTruthy();
    });

    it('should support h6', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          as: 'h6',
          children: 'Title',
        })
      );
      cleanup = dispose;

      const title = container.querySelector('h6[data-alert-title]');
      expect(title).toBeTruthy();
    });
  });

  describe('Props', () => {
    it('should accept and apply className', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          className: 'custom-title',
        })
      );
      cleanup = dispose;

      const title = container.querySelector('[data-alert-title]');
      expect(title?.className).toBe('custom-title');
    });

    it('should accept and apply style', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          style: { fontWeight: 'bold' },
        })
      );
      cleanup = dispose;

      const title = container.querySelector('[data-alert-title]') as HTMLHeadingElement;
      expect(title.style.fontWeight).toBe('bold');
    });

    it('should accept and apply data attributes', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          'data-testid': 'my-title',
        })
      );
      cleanup = dispose;

      const title = container.querySelector('[data-alert-title]');
      expect(title?.getAttribute('data-testid')).toBe('my-title');
    });

    it('should accept and apply id', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertTitle({
          id: 'alert-title',
        })
      );
      cleanup = dispose;

      const title = container.querySelector('[data-alert-title]');
      expect(title?.id).toBe('alert-title');
    });
  });

  describe('DisplayName', () => {
    it('should have correct displayName', () => {
      expect(AlertTitle.displayName).toBe('Alert.Title');
    });
  });
});

describe('AlertDescription', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Rendering', () => {
    it('should render a div with data-alert-description attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() => AlertDescription({}));
      cleanup = dispose;

      const description = container.querySelector('div[data-alert-description]');
      expect(description).toBeTruthy();
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertDescription({
          children: 'This is a description',
        })
      );
      cleanup = dispose;

      const description = container.querySelector('div[data-alert-description]');
      expect(description?.textContent).toBe('This is a description');
    });

    it('should render multiple children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertDescription({
          children: ['First part. ', 'Second part.'],
        })
      );
      cleanup = dispose;

      const description = container.querySelector('div[data-alert-description]');
      expect(description?.textContent).toContain('First part.');
      expect(description?.textContent).toContain('Second part.');
    });
  });

  describe('Props', () => {
    it('should accept and apply className', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertDescription({
          className: 'custom-description',
        })
      );
      cleanup = dispose;

      const description = container.querySelector('div[data-alert-description]');
      expect(description?.className).toBe('custom-description');
    });

    it('should accept and apply style', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertDescription({
          style: { fontSize: '14px' },
        })
      );
      cleanup = dispose;

      const description = container.querySelector('div[data-alert-description]') as HTMLDivElement;
      expect(description.style.fontSize).toBe('14px');
    });

    it('should accept and apply data attributes', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertDescription({
          'data-testid': 'my-description',
        })
      );
      cleanup = dispose;

      const description = container.querySelector('div[data-alert-description]');
      expect(description?.getAttribute('data-testid')).toBe('my-description');
    });

    it('should accept and apply id', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        AlertDescription({
          id: 'alert-description',
        })
      );
      cleanup = dispose;

      const description = container.querySelector('div[data-alert-description]');
      expect(description?.id).toBe('alert-description');
    });
  });

  describe('DisplayName', () => {
    it('should have correct displayName', () => {
      expect(AlertDescription.displayName).toBe('Alert.Description');
    });
  });
});

describe('Alert Composition', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Sub-components', () => {
    it('should expose Icon as sub-component', () => {
      expect((Alert as any).Icon).toBe(AlertIcon);
    });

    it('should expose Title as sub-component', () => {
      expect((Alert as any).Title).toBe(AlertTitle);
    });

    it('should expose Description as sub-component', () => {
      expect((Alert as any).Description).toBe(AlertDescription);
    });
  });

  describe('Complete Alert', () => {
    it('should render complete alert with all sub-components', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          variant: 'warning',
          children: [
            AlertIcon({ children: '⚠' }),
            AlertTitle({ children: 'Warning' }),
            AlertDescription({ children: 'This action cannot be undone.' }),
          ],
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.getAttribute('data-variant')).toBe('warning');

      const icon = container.querySelector('[data-alert-icon]');
      expect(icon?.textContent).toBe('⚠');

      const title = container.querySelector('[data-alert-title]');
      expect(title?.textContent).toBe('Warning');

      const description = container.querySelector('[data-alert-description]');
      expect(description?.textContent).toBe('This action cannot be undone.');
    });

    it('should render alert with only title', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          children: AlertTitle({ children: 'Simple Alert' }),
        })
      );
      cleanup = dispose;

      const title = container.querySelector('[data-alert-title]');
      expect(title?.textContent).toBe('Simple Alert');

      const icon = container.querySelector('[data-alert-icon]');
      expect(icon).toBeNull();

      const description = container.querySelector('[data-alert-description]');
      expect(description).toBeNull();
    });

    it('should render alert with icon and description only', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          children: [
            AlertIcon({ children: 'ℹ' }),
            AlertDescription({ children: 'Information message' }),
          ],
        })
      );
      cleanup = dispose;

      const icon = container.querySelector('[data-alert-icon]');
      expect(icon?.textContent).toBe('ℹ');

      const description = container.querySelector('[data-alert-description]');
      expect(description?.textContent).toBe('Information message');

      const title = container.querySelector('[data-alert-title]');
      expect(title).toBeNull();
    });
  });

  describe('Accessibility - Complete Alert', () => {
    it('should have proper semantic structure', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          variant: 'error',
          role: 'alert',
          children: [
            AlertIcon({ children: '✕' }),
            AlertTitle({ as: 'h3', children: 'Error' }),
            AlertDescription({ children: 'An error occurred.' }),
          ],
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[role="alert"]');
      expect(alert).toBeTruthy();
      expect(alert?.getAttribute('data-variant')).toBe('error');

      const icon = container.querySelector('[data-alert-icon]');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');

      const title = container.querySelector('h3[data-alert-title]');
      expect(title).toBeTruthy();
    });

    it('should allow aria-labelledby for title reference', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          'aria-labelledby': 'alert-title',
          children: [
            AlertTitle({ id: 'alert-title', children: 'Important' }),
            AlertDescription({ children: 'Please read this carefully.' }),
          ],
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.getAttribute('aria-labelledby')).toBe('alert-title');

      const title = container.querySelector('[data-alert-title]');
      expect(title?.id).toBe('alert-title');
    });

    it('should allow aria-describedby for description reference', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        Alert({
          'aria-describedby': 'alert-desc',
          children: [
            AlertTitle({ children: 'Notice' }),
            AlertDescription({ id: 'alert-desc', children: 'Additional information.' }),
          ],
        })
      );
      cleanup = dispose;

      const alert = container.querySelector('div[data-alert]');
      expect(alert?.getAttribute('aria-describedby')).toBe('alert-desc');

      const description = container.querySelector('[data-alert-description]');
      expect(description?.id).toBe('alert-desc');
    });
  });
});
