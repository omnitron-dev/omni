/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VisuallyHidden } from '../../../src/primitives/VisuallyHidden.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('VisuallyHidden', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render span element', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden text',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span).toBeTruthy();
      expect(span?.textContent).toBe('Hidden text');
    });

    it('should have data-visually-hidden attribute', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden content',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.getAttribute('data-visually-hidden')).toBe('');
    });

    it('should render text content', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Screen reader only',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('Screen reader only');
    });
  });

  describe('CSS hiding styles', () => {
    it('should apply position absolute', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.position).toBe('absolute');
    });

    it('should apply 1px width', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.width).toBe('1px');
    });

    it('should apply 1px height', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.height).toBe('1px');
    });

    it('should apply zero padding', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.padding).toBe('0px');
    });

    it('should apply -1px margin', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.margin).toBe('-1px');
    });

    it('should apply overflow hidden', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.overflow).toBe('hidden');
    });

    it('should apply clip rect(0, 0, 0, 0)', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.clip).toBe('rect(0, 0, 0, 0)');
    });

    it('should apply white-space nowrap', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.whiteSpace).toBe('nowrap');
    });

    it('should apply zero border width', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.borderWidth).toBe('0px');
    });

    it('should apply all hiding styles together', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;

      expect(span?.style.position).toBe('absolute');
      expect(span?.style.width).toBe('1px');
      expect(span?.style.height).toBe('1px');
      expect(span?.style.padding).toBe('0px');
      expect(span?.style.margin).toBe('-1px');
      expect(span?.style.overflow).toBe('hidden');
      expect(span?.style.clip).toBe('rect(0, 0, 0, 0)');
      expect(span?.style.whiteSpace).toBe('nowrap');
      expect(span?.style.borderWidth).toBe('0px');
    });
  });

  describe('Custom style merging', () => {
    it('should merge custom styles with default styles', () => {
      const component = () =>
        VisuallyHidden({
          style: { color: 'red' },
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.color).toBe('red');
      expect(span?.style.position).toBe('absolute');
    });

    it('should allow overriding default styles', () => {
      const component = () =>
        VisuallyHidden({
          style: { position: 'relative' },
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.position).toBe('relative');
    });

    it('should support multiple custom style properties', () => {
      const component = () =>
        VisuallyHidden({
          style: {
            backgroundColor: 'blue',
            fontSize: '16px',
            fontWeight: 'bold',
          },
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.backgroundColor).toBe('blue');
      expect(span?.style.fontSize).toBe('16px');
      expect(span?.style.fontWeight).toBe('bold');
    });
  });

  describe('Custom attributes', () => {
    it('should apply custom className', () => {
      const component = () =>
        VisuallyHidden({
          class: 'sr-only',
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.className).toContain('sr-only');
    });

    it('should apply custom id', () => {
      const component = () =>
        VisuallyHidden({
          id: 'skip-link-text',
          children: 'Skip to content',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.id).toBe('skip-link-text');
    });

    it('should apply data attributes', () => {
      const component = () =>
        VisuallyHidden({
          'data-test': 'hidden-label',
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.getAttribute('data-test')).toBe('hidden-label');
    });

    it('should apply title attribute', () => {
      const component = () =>
        VisuallyHidden({
          title: 'Screen reader text',
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.getAttribute('title')).toBe('Screen reader text');
    });
  });

  describe('Children handling', () => {
    it('should render string children', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Close dialog',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('Close dialog');
    });

    it('should render multiline text', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Line 1\nLine 2',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('Line 1\nLine 2');
    });

    it('should render empty string', () => {
      const component = () =>
        VisuallyHidden({
          children: '',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('');
    });

    it('should handle special characters', () => {
      const component = () =>
        VisuallyHidden({
          children: '<div>&nbsp;</div>',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('<div>&nbsp;</div>');
    });

    it('should handle unicode characters', () => {
      const component = () =>
        VisuallyHidden({
          children: '→ Next item',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('→ Next item');
    });

    it('should handle numeric content', () => {
      const component = () =>
        VisuallyHidden({
          children: '42',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('42');
    });
  });

  describe('Accessibility', () => {
    it('should be readable by screen readers', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Screen reader content',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.getAttribute('aria-hidden')).toBeNull();
      expect(span?.textContent).toBe('Screen reader content');
    });

    it('should not use aria-hidden', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Important for screen readers',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.hasAttribute('aria-hidden')).toBe(false);
    });

    it('should support aria-label', () => {
      const component = () =>
        VisuallyHidden({
          'aria-label': 'Descriptive label',
          children: 'Content',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.getAttribute('aria-label')).toBe('Descriptive label');
    });

    it('should support aria-live for announcements', () => {
      const component = () =>
        VisuallyHidden({
          'aria-live': 'polite',
          children: 'Update notification',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.getAttribute('aria-live')).toBe('polite');
    });

    it('should support role attribute', () => {
      const component = () =>
        VisuallyHidden({
          role: 'status',
          children: 'Loading...',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.getAttribute('role')).toBe('status');
    });
  });

  describe('Use cases', () => {
    it('should work for icon-only button labels', () => {
      const component = () => {
        const button = document.createElement('button');
        button.appendChild(
          VisuallyHidden({
            children: 'Close dialog',
          })
        );

        const icon = document.createElement('span');
        icon.textContent = '×';
        button.appendChild(icon);

        return button;
      };

      const { container } = renderComponent(component);

      const hidden = container.querySelector('span[data-visually-hidden]');
      expect(hidden?.textContent).toBe('Close dialog');
    });

    it('should work for skip navigation links', () => {
      const component = () => {
        const link = document.createElement('a');
        link.href = '#main-content';
        link.appendChild(
          VisuallyHidden({
            children: 'Skip to main content',
          })
        );
        return link;
      };

      const { container } = renderComponent(component);

      const hidden = container.querySelector('span[data-visually-hidden]');
      expect(hidden?.textContent).toBe('Skip to main content');
    });

    it('should work for additional context', () => {
      const component = () => {
        const div = document.createElement('div');
        div.className = 'status-badge';

        const icon = document.createElement('span');
        icon.textContent = '✓';
        div.appendChild(icon);

        const text = document.createElement('span');
        text.textContent = 'Active';
        div.appendChild(text);

        div.appendChild(
          VisuallyHidden({
            children: 'User account is currently active',
          })
        );

        return div;
      };

      const { container } = renderComponent(component);

      const hidden = container.querySelector('span[data-visually-hidden]');
      expect(hidden?.textContent).toBe('User account is currently active');
    });

    it('should work for loading states', () => {
      const component = () =>
        VisuallyHidden({
          'aria-live': 'polite',
          role: 'status',
          children: 'Loading, please wait',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('Loading, please wait');
      expect(span?.getAttribute('aria-live')).toBe('polite');
      expect(span?.getAttribute('role')).toBe('status');
    });

    it('should work for form field labels', () => {
      const component = () => {
        const div = document.createElement('div');

        div.appendChild(
          VisuallyHidden({
            children: 'Search',
          })
        );

        const input = document.createElement('input');
        input.type = 'search';
        input.placeholder = 'Search...';
        div.appendChild(input);

        return div;
      };

      const { container } = renderComponent(component);

      const hidden = container.querySelector('span[data-visually-hidden]');
      expect(hidden?.textContent).toBe('Search');
    });
  });

  describe('Integration scenarios', () => {
    it('should work with icon buttons', () => {
      const component = () => {
        const button = document.createElement('button');
        button.className = 'icon-button';

        button.appendChild(
          VisuallyHidden({
            children: 'Delete item',
          })
        );

        const icon = document.createElement('svg');
        icon.innerHTML = '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z"/>';
        button.appendChild(icon);

        return button;
      };

      const { container } = renderComponent(component);

      const hidden = container.querySelector('span[data-visually-hidden]');
      expect(hidden?.textContent).toBe('Delete item');
      expect(hidden?.getAttribute('data-visually-hidden')).toBe('');
    });

    it('should work with media controls', () => {
      const component = () => {
        const button = document.createElement('button');

        button.appendChild(
          VisuallyHidden({
            children: 'Play',
          })
        );

        const icon = document.createElement('span');
        icon.textContent = '▶';
        button.appendChild(icon);

        return button;
      };

      const { container } = renderComponent(component);

      const hidden = container.querySelector('span[data-visually-hidden]');
      expect(hidden?.textContent).toBe('Play');
    });

    it('should work with table action buttons', () => {
      const component = () => {
        const td = document.createElement('td');

        const editBtn = document.createElement('button');
        editBtn.appendChild(
          VisuallyHidden({
            children: 'Edit Alice',
          })
        );
        td.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.appendChild(
          VisuallyHidden({
            children: 'Delete Alice',
          })
        );
        td.appendChild(deleteBtn);

        return td;
      };

      const { container } = renderComponent(component);

      const hiddenElements = container.querySelectorAll('span[data-visually-hidden]');
      expect(hiddenElements.length).toBe(2);
      expect(hiddenElements[0]?.textContent).toBe('Edit Alice');
      expect(hiddenElements[1]?.textContent).toBe('Delete Alice');
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined children', () => {
      const component = () =>
        VisuallyHidden({
          children: undefined,
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span).toBeTruthy();
      expect(span?.getAttribute('data-visually-hidden')).toBe('');
    });

    it('should handle null children', () => {
      const component = () =>
        VisuallyHidden({
          children: null,
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span).toBeTruthy();
    });

    it('should handle very long text', () => {
      const longText = 'This is a very long descriptive text for screen readers '.repeat(10);

      const component = () =>
        VisuallyHidden({
          children: longText,
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.textContent).toBe(longText);
    });

    it('should handle whitespace-only children', () => {
      const component = () =>
        VisuallyHidden({
          children: '   ',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('   ');
    });

    it('should handle boolean children', () => {
      const component = () =>
        VisuallyHidden({
          children: true,
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span).toBeTruthy();
    });
  });

  describe('Display name', () => {
    it('should have correct display name', () => {
      expect(VisuallyHidden.displayName).toBe('VisuallyHidden');
    });
  });

  describe('Style specificity', () => {
    it('should ensure styles are applied inline', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      // Inline styles should be present
      expect(span?.getAttribute('style')).toBeTruthy();
      expect(span?.getAttribute('style')).toContain('position');
    });

    it('should maintain hiding even with custom styles', () => {
      const component = () =>
        VisuallyHidden({
          style: { color: 'red' },
          children: 'Hidden',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;
      expect(span?.style.position).toBe('absolute');
      expect(span?.style.width).toBe('1px');
      expect(span?.style.height).toBe('1px');
      expect(span?.style.color).toBe('red');
    });
  });

  describe('WCAG compliance', () => {
    it('should meet WCAG 2.1 Level AA for off-screen content', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Screen reader only content',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span') as HTMLElement;

      // Should be visually hidden using recommended technique
      expect(span?.style.position).toBe('absolute');
      expect(span?.style.width).toBe('1px');
      expect(span?.style.height).toBe('1px');
      expect(span?.style.clip).toBe('rect(0, 0, 0, 0)');

      // Should not use display:none or visibility:hidden
      expect(span?.style.display).not.toBe('none');
      expect(span?.style.visibility).not.toBe('hidden');
    });

    it('should not use aria-hidden', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Important for accessibility',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.getAttribute('aria-hidden')).not.toBe('true');
    });
  });

  describe('Performance', () => {
    it('should render efficiently with minimal DOM', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Hidden text',
        });

      const { container } = renderComponent(component);

      const spans = container.querySelectorAll('span');
      expect(spans.length).toBe(1); // Only one span element
    });

    it('should not create unnecessary wrappers', () => {
      const component = () =>
        VisuallyHidden({
          children: 'Text',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.tagName).toBe('SPAN');
      expect(span?.children.length).toBe(0); // No child elements, just text
    });
  });

  describe('Multi-language support', () => {
    it('should handle RTL text', () => {
      const component = () =>
        VisuallyHidden({
          children: 'إغلاق الحوار',
        });

      const { container } = renderComponent(component);

      const span = container.querySelector('span');
      expect(span?.textContent).toBe('إغلاق الحوار');
    });

    it('should handle various languages', () => {
      const texts = [
        'ダイアログを閉じる', // Japanese
        '关闭对话框', // Chinese
        'Закрыть диалог', // Russian
        'Dialog schließen', // German
      ];

      texts.forEach((text) => {
        const component = () =>
          VisuallyHidden({
            children: text,
          });

        const { container, cleanup } = renderComponent(component);
        const span = container.querySelector('span');

        expect(span?.textContent).toBe(text);
        cleanup();
        document.body.innerHTML = '';
      });
    });
  });
});
