/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Badge } from '../../../src/primitives/Badge.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Badge', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Rendering', () => {
    it('should render as a span element', () => {
      const component = () => Badge({ children: 'New' });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl).toBeTruthy();
      expect(badgeEl?.textContent).toBe('New');
    });

    it('should render with text content', () => {
      const component = () => Badge({ children: 'Active' });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl?.textContent).toBe('Active');
    });

    it('should render with number content', () => {
      const component = () => Badge({ children: 42 });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl?.textContent).toBe('42');
    });

    it('should render with zero as content', () => {
      const component = () => Badge({ children: 0 });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl?.textContent).toBe('0');
    });

    it('should render empty badge', () => {
      const component = () => Badge({});

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl).toBeTruthy();
      expect(badgeEl?.textContent).toBe('');
    });

    it('should render with mixed content types', () => {
      const component = () => Badge({ children: ['Count: ', 3] });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl?.textContent).toContain('Count:');
      expect(badgeEl?.textContent).toContain('3');
    });
  });

  describe('Data Attributes', () => {
    it('should have data-badge attribute', () => {
      const component = () => Badge({ children: 'Badge' });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.hasAttribute('data-badge')).toBe(true);
      expect(badgeEl.getAttribute('data-badge')).toBe('');
    });

    it('should support custom data attributes', () => {
      const component = () =>
        Badge({
          'data-status': 'success',
          children: 'Active',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.getAttribute('data-status')).toBe('success');
    });

    it('should support multiple custom data attributes', () => {
      const component = () =>
        Badge({
          'data-status': 'error',
          'data-priority': 'high',
          'data-category': 'alert',
          children: 'Failed',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.getAttribute('data-status')).toBe('error');
      expect(badgeEl.getAttribute('data-priority')).toBe('high');
      expect(badgeEl.getAttribute('data-category')).toBe('alert');
    });

    it('should support data-testid for testing', () => {
      const component = () =>
        Badge({
          'data-testid': 'notification-badge',
          children: '5',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('[data-testid="notification-badge"]');
      expect(badgeEl).toBeTruthy();
      expect(badgeEl?.textContent).toBe('5');
    });
  });

  describe('Styling', () => {
    it('should apply class name', () => {
      const component = () =>
        Badge({
          class: 'badge',
          children: 'Badge',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('.badge');
      expect(badgeEl).toBeTruthy();
    });

    it('should apply multiple class names', () => {
      const component = () =>
        Badge({
          class: 'badge badge-success rounded',
          children: 'Success',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.classList.contains('badge')).toBe(true);
      expect(badgeEl.classList.contains('badge-success')).toBe(true);
      expect(badgeEl.classList.contains('rounded')).toBe(true);
    });

    it('should apply inline styles', () => {
      const component = () =>
        Badge({
          style: {
            background: '#10b981',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '12px',
          },
          children: 'Styled',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.style.background).toBe('#10b981');
      expect(badgeEl.style.color).toBe('white');
      expect(badgeEl.style.padding).toBe('4px 8px');
      expect(badgeEl.style.borderRadius).toBe('12px');
    });

    it('should apply both class and style', () => {
      const component = () =>
        Badge({
          class: 'badge-warning',
          style: { fontSize: '14px' },
          children: 'Warning',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('.badge-warning') as HTMLElement;
      expect(badgeEl).toBeTruthy();
      expect(badgeEl.style.fontSize).toBe('14px');
    });

    it('should apply dynamic class names', () => {
      const status = 'success';
      const component = () =>
        Badge({
          class: `badge badge-${status}`,
          children: 'Status',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.classList.contains('badge-success')).toBe(true);
      expect(badgeEl.classList.contains('badge')).toBe(true);
    });

    it('should apply dynamic styles', () => {
      const bgColor = 'green';
      const component = () =>
        Badge({
          style: { background: bgColor, color: 'white', padding: '4px 8px' },
          children: 'Styled',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.style.background).toBe('green');
      expect(badgeEl.style.color).toBe('white');
      expect(badgeEl.style.padding).toBe('4px 8px');
    });
  });

  describe('Accessibility', () => {
    it('should have role="status"', () => {
      const component = () => Badge({ children: 'Status' });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('[role="status"]');
      expect(badgeEl).toBeTruthy();
    });

    it('should have aria-live="polite"', () => {
      const component = () => Badge({ children: 'Notification' });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.getAttribute('aria-live')).toBe('polite');
    });

    it('should support custom aria-label', () => {
      const component = () =>
        Badge({
          'aria-label': '3 unread notifications',
          children: '3',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.getAttribute('aria-label')).toBe('3 unread notifications');
    });

    it('should support aria-labelledby', () => {
      const component = () =>
        Badge({
          'aria-labelledby': 'badge-label',
          children: '5',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.getAttribute('aria-labelledby')).toBe('badge-label');
    });

    it('should support aria-hidden', () => {
      const component = () =>
        Badge({
          'aria-hidden': 'true',
          children: 'Decorative',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.getAttribute('aria-hidden')).toBe('true');
    });

    it('should be configured for screen reader announcements', () => {
      const component = () => Badge({ children: '5' });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.getAttribute('aria-live')).toBe('polite');
      expect(badgeEl.getAttribute('role')).toBe('status');
      expect(badgeEl.textContent).toBe('5');
    });
  });

  describe('Props Forwarding', () => {
    it('should forward id attribute', () => {
      const component = () =>
        Badge({
          id: 'notification-badge',
          children: '3',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('#notification-badge');
      expect(badgeEl).toBeTruthy();
    });

    it('should forward title attribute', () => {
      const component = () =>
        Badge({
          title: 'You have 3 notifications',
          children: '3',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.getAttribute('title')).toBe('You have 3 notifications');
    });

    it('should forward event handlers', () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };

      const component = () =>
        Badge({
          onClick: handleClick,
          children: 'Click me',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      badgeEl.click();

      expect(clicked).toBe(true);
    });

    it('should forward multiple event handlers', () => {
      let mouseEntered = false;
      let mouseLeft = false;

      const component = () =>
        Badge({
          onMouseEnter: () => {
            mouseEntered = true;
          },
          onMouseLeave: () => {
            mouseLeft = true;
          },
          children: 'Hover me',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;

      badgeEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(mouseEntered).toBe(true);

      badgeEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      expect(mouseLeft).toBe(true);
    });
  });

  describe('Use Cases', () => {
    it('should work as notification count badge', () => {
      const unreadCount = 5;
      const component = () =>
        Badge({
          class: 'badge-notification',
          'aria-label': `${unreadCount} unread notifications`,
          children: unreadCount,
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('.badge-notification') as HTMLElement;
      expect(badgeEl.textContent).toBe('5');
      expect(badgeEl.getAttribute('aria-label')).toBe('5 unread notifications');
    });

    it('should work as status indicator', () => {
      const component = () =>
        Badge({
          'data-status': 'success',
          class: 'badge-status',
          children: 'Active',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('[data-status="success"]');
      expect(badgeEl).toBeTruthy();
      expect(badgeEl?.textContent).toBe('Active');
    });

    it('should work with different status types', () => {
      const component = () => {
        const wrapper = document.createElement('div');
        wrapper.appendChild(
          Badge({
            'data-status': 'success',
            class: 'badge badge-success',
            children: 'Active',
          })
        );
        wrapper.appendChild(
          Badge({
            'data-status': 'warning',
            class: 'badge badge-warning',
            children: 'Pending',
          })
        );
        wrapper.appendChild(
          Badge({
            'data-status': 'error',
            class: 'badge badge-error',
            children: 'Failed',
          })
        );
        return wrapper;
      };

      const { container } = renderComponent(component);

      const successBadge = container.querySelector('[data-status="success"]');
      const warningBadge = container.querySelector('[data-status="warning"]');
      const errorBadge = container.querySelector('[data-status="error"]');

      expect(successBadge?.textContent).toBe('Active');
      expect(warningBadge?.textContent).toBe('Pending');
      expect(errorBadge?.textContent).toBe('Failed');
    });

    it('should work as icon badge', () => {
      const component = () =>
        Badge({
          class: 'badge-icon',
          'aria-label': 'Important',
          children: '!',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('.badge-icon');
      expect(badgeEl?.textContent).toBe('!');
      expect(badgeEl?.getAttribute('aria-label')).toBe('Important');
    });

    it('should support hiding with display style', () => {
      const count = 0;
      const component = () =>
        Badge({
          style: { display: count === 0 ? 'none' : 'inline-flex' },
          children: count,
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.style.display).toBe('none');
    });

    it('should display 99+ for large counts', () => {
      const count = 150;
      const displayCount = count > 99 ? '99+' : count.toString();

      const component = () =>
        Badge({
          'aria-label': `${count} notifications`,
          children: displayCount,
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.textContent).toBe('99+');
      expect(badgeEl.getAttribute('aria-label')).toBe('150 notifications');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined children', () => {
      const component = () => Badge({ children: undefined });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl).toBeTruthy();
      expect(badgeEl?.textContent).toBe('');
    });

    it('should handle null children', () => {
      const component = () => Badge({ children: null });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl).toBeTruthy();
      expect(badgeEl?.textContent).toBe('');
    });

    it('should handle empty string children', () => {
      const component = () => Badge({ children: '' });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl).toBeTruthy();
      expect(badgeEl?.textContent).toBe('');
    });

    it('should handle boolean children', () => {
      const component = () => Badge({ children: true });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl).toBeTruthy();
    });

    it('should handle special characters in content', () => {
      const component = () => Badge({ children: '<script>alert("xss")</script>' });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl?.textContent).toBe('<script>alert("xss")</script>');
      expect(container.querySelector('script')).toBeNull();
    });

    it('should handle very long text content', () => {
      const longText = 'This is a very long badge text that might overflow';
      const component = () => Badge({ children: longText });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl?.textContent).toBe(longText);
    });

    it('should handle negative numbers', () => {
      const component = () => Badge({ children: -5 });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl?.textContent).toBe('-5');
    });

    it('should handle decimal numbers', () => {
      const component = () => Badge({ children: 3.14 });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl?.textContent).toBe('3.14');
    });

    it('should handle Unicode characters', () => {
      const component = () => Badge({ children: '✓' });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl?.textContent).toBe('✓');
    });

    it('should handle emojis', () => {
      const component = () => Badge({ children: '🔥' });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span');
      expect(badgeEl?.textContent).toBe('🔥');
    });
  });

  describe('Performance', () => {
    it('should render many badges efficiently', () => {
      const component = () => {
        const wrapper = document.createElement('div');
        for (let i = 0; i < 50; i++) {
          wrapper.appendChild(
            Badge({
              class: `badge-${i}`,
              children: i,
            })
          );
        }
        return wrapper;
      };

      const { container } = renderComponent(component);

      const badges = container.querySelectorAll('[data-badge]');
      expect(badges.length).toBe(50);
    });

    it('should handle conditional display', () => {
      const showBadge = true;
      const component = () =>
        Badge({
          style: { display: showBadge ? 'inline-flex' : 'none' },
          children: 'Badge',
        });

      const { container } = renderComponent(component);

      const badgeEl = container.querySelector('span') as HTMLElement;
      expect(badgeEl.textContent).toBe('Badge');
      expect(badgeEl.style.display).toBe('inline-flex');
    });
  });

  describe('Integration Scenarios', () => {
    it('should work inside a button', () => {
      const component = () => {
        const button = document.createElement('button');
        button.textContent = 'Notifications ';
        button.appendChild(
          Badge({
            class: 'badge-notification',
            children: '5',
          })
        );
        return button;
      };

      const { container } = renderComponent(component);

      const button = container.querySelector('button');
      const badge = button?.querySelector('.badge-notification');

      expect(button).toBeTruthy();
      expect(badge).toBeTruthy();
      expect(badge?.textContent).toBe('5');
    });

    it('should maintain accessibility when nested', () => {
      const component = () => {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('role', 'group');
        wrapper.setAttribute('aria-label', 'Notifications');
        wrapper.appendChild(
          Badge({
            'aria-label': '3 new notifications',
            children: '3',
          })
        );
        return wrapper;
      };

      const { container } = renderComponent(component);

      const wrapper = container.querySelector('[role="group"]');
      const badge = wrapper?.querySelector('[role="status"]');

      expect(wrapper?.getAttribute('aria-label')).toBe('Notifications');
      expect(badge?.getAttribute('aria-label')).toBe('3 new notifications');
    });
  });
});
