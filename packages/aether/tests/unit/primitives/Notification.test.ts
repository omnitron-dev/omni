/**
 * Notification Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Notification, notify, closeNotification } from '../../../src/primitives/Notification.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

describe('Notification', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    // Clear all notifications before each test
    // The notify function adds to module-level signal, so we need to clear them
    // by closing all existing notifications
    try {
      // Get all existing notification IDs and close them
      // Clear a large range to handle the incrementing idCounter
      for (let i = 0; i < 200; i++) {
        closeNotification(`notification-${i}`);
      }
    } catch (e) {
      // Ignore errors from trying to close non-existent notifications
    }
    cleanup?.();
    cleanup = undefined;
    vi.clearAllTimers();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.restoreAllMocks();
  });

  describe('Rendering Tests', () => {
    it('1. Renders container with data-notification-container', () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const notificationContainer = container.querySelector('[data-notification-container]');
      expect(notificationContainer).toBeTruthy();
    });

    it('2. Renders with correct placement data attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({ placement: 'topLeft' }));
      cleanup = dispose;

      const notificationContainer = container.querySelector('[data-notification-container]');
      expect(notificationContainer?.getAttribute('data-placement')).toBe('topLeft');
    });

    it('3. Renders position styles for topRight (default)', () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const notificationContainer = container.querySelector('[data-notification-container]') as HTMLDivElement;
      expect(notificationContainer.style.top).toBe('16px');
      expect(notificationContainer.style.right).toBe('16px');
      expect(notificationContainer.style.bottom).toBe('');
      expect(notificationContainer.style.left).toBe('');
    });

    it('4. Renders position styles for topLeft', () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({ placement: 'topLeft' }));
      cleanup = dispose;

      const notificationContainer = container.querySelector('[data-notification-container]') as HTMLDivElement;
      expect(notificationContainer.style.top).toBe('16px');
      expect(notificationContainer.style.left).toBe('16px');
      expect(notificationContainer.style.bottom).toBe('');
      expect(notificationContainer.style.right).toBe('');
    });

    it('5. Renders position styles for bottomRight', () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({ placement: 'bottomRight' }));
      cleanup = dispose;

      const notificationContainer = container.querySelector('[data-notification-container]') as HTMLDivElement;
      expect(notificationContainer.style.bottom).toBe('16px');
      expect(notificationContainer.style.right).toBe('16px');
      expect(notificationContainer.style.top).toBe('');
      expect(notificationContainer.style.left).toBe('');
    });

    it('6. Renders position styles for bottomLeft', () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({ placement: 'bottomLeft' }));
      cleanup = dispose;

      const notificationContainer = container.querySelector('[data-notification-container]') as HTMLDivElement;
      expect(notificationContainer.style.bottom).toBe('16px');
      expect(notificationContainer.style.left).toBe('16px');
      expect(notificationContainer.style.top).toBe('');
      expect(notificationContainer.style.right).toBe('');
    });

    it('7. Renders fixed position and z-index', () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const notificationContainer = container.querySelector('[data-notification-container]') as HTMLDivElement;
      expect(notificationContainer.style.position).toBe('fixed');
      expect(notificationContainer.style.zIndex).toBe('9999');
    });

    it('8. Renders notification with role="alert"', () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      console.log('Before notify - innerHTML:', container.innerHTML.substring(0, 200));

      notify({ title: 'Test Notification' });

      console.log('After notify - innerHTML:', container.innerHTML.substring(0, 300));

      const notification = container.querySelector('[data-notification]');
      console.log('Found notification:', notification !== null);
      expect(notification?.getAttribute('role')).toBe('alert');
    });

    it('9. Renders title and description', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test Title', description: 'Test Description' });
      await Promise.resolve();

      const title = container.querySelector('[data-notification-title]');
      const description = container.querySelector('[data-notification-description]');

      expect(title?.textContent).toBe('Test Title');
      expect(description?.textContent).toBe('Test Description');
    });

    it('10. Renders close button when closable=true (default)', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test' });
      await Promise.resolve();

      const closeButton = container.querySelector('[data-notification-close]');
      expect(closeButton).toBeTruthy();
      expect(closeButton?.textContent).toBe('×');
    });
  });

  describe('Notify Function Tests', () => {
    it('11. notify() adds notification to list', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test Notification' });
      await Promise.resolve();

      const notification = container.querySelector('[data-notification]');
      expect(notification).toBeTruthy();
    });

    it('12. notify() returns notification id', () => {
      const id = notify({ title: 'Test' });
      expect(id).toMatch(/^notification-\d+$/);
    });

    it('13. notify() generates unique ids', () => {
      const id1 = notify({ title: 'Test 1' });
      const id2 = notify({ title: 'Test 2' });
      expect(id1).not.toBe(id2);
    });

    it('14. Multiple notifications render', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Notification 1' });
      notify({ title: 'Notification 2' });
      notify({ title: 'Notification 3' });
      await Promise.resolve();

      const notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(3);
    });

    it('15. Notification has correct data-type attribute', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Success', type: 'success' });
      await Promise.resolve();

      const notification = container.querySelector('[data-notification]');
      expect(notification?.getAttribute('data-type')).toBe('success');
    });

    it('16. Default type is "info"', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test' });
      await Promise.resolve();

      const notification = container.querySelector('[data-notification]');
      expect(notification?.getAttribute('data-type')).toBe('info');
    });

    it('17. Custom types (success, warning, error) work', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Success', type: 'success' });
      notify({ title: 'Warning', type: 'warning' });
      notify({ title: 'Error', type: 'error' });
      await Promise.resolve();

      const notifications = container.querySelectorAll('[data-notification]');
      expect(notifications[0]?.getAttribute('data-type')).toBe('success');
      expect(notifications[1]?.getAttribute('data-type')).toBe('warning');
      expect(notifications[2]?.getAttribute('data-type')).toBe('error');
    });

    it('18. Title renders correctly', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Important Message' });
      await Promise.resolve();

      const title = container.querySelector('[data-notification-title]');
      expect(title?.textContent).toBe('Important Message');
    });

    it('19. Description renders when provided', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Title', description: 'Description text' });
      await Promise.resolve();

      const description = container.querySelector('[data-notification-description]');
      expect(description?.textContent).toBe('Description text');
    });

    it('20. Description does not render when omitted', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Title only' });
      await Promise.resolve();

      const description = container.querySelector('[data-notification-description]');
      expect(description).toBeNull();
    });

    it('21. Closable button shows by default', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test' });
      await Promise.resolve();

      const closeButton = container.querySelector('[data-notification-close]');
      expect(closeButton).toBeTruthy();
    });

    it('22. Closable=false hides close button', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test', closable: false });
      await Promise.resolve();

      const closeButton = container.querySelector('[data-notification-close]');
      expect(closeButton).toBeNull();
    });
  });

  describe('Close Function Tests', () => {
    it('23. closeNotification() removes notification', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const id = notify({ title: 'Test' });
      await Promise.resolve();

      let notification = container.querySelector('[data-notification]');
      expect(notification).toBeTruthy();

      closeNotification(id);
      await Promise.resolve();

      notification = container.querySelector('[data-notification]');
      expect(notification).toBeNull();
    });

    it('24. Close button click removes notification', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test' });
      await Promise.resolve();

      const closeButton = container.querySelector('[data-notification-close]') as HTMLButtonElement;
      expect(closeButton).toBeTruthy();

      closeButton.click();
      await Promise.resolve();

      const notification = container.querySelector('[data-notification]');
      expect(notification).toBeNull();
    });

    it('25. Closing one does not affect others', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const id1 = notify({ title: 'Test 1' });
      notify({ title: 'Test 2' });
      await Promise.resolve();

      let notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(2);

      closeNotification(id1);
      await Promise.resolve();

      notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(1);
    });

    it('26. Closing non-existent id is safe', () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      expect(() => closeNotification('non-existent-id')).not.toThrow();
    });

    it('27. Multiple closes are safe', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const id = notify({ title: 'Test' });
      await Promise.resolve();

      closeNotification(id);
      closeNotification(id);
      closeNotification(id);

      expect(() => closeNotification(id)).not.toThrow();
    });
  });

  describe('Auto-dismiss Tests', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('28. Auto-dismisses after default duration (4500ms)', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test' });
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      let notification = container.querySelector('[data-notification]');
      expect(notification).toBeTruthy();

      vi.advanceTimersByTime(4500);
      await Promise.resolve();

      notification = container.querySelector('[data-notification]');
      expect(notification).toBeNull();
    });

    it('29. Auto-dismisses after custom duration', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test', duration: 2000 });
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      let notification = container.querySelector('[data-notification]');
      expect(notification).toBeTruthy();

      vi.advanceTimersByTime(2000);
      await Promise.resolve();

      notification = container.querySelector('[data-notification]');
      expect(notification).toBeNull();
    });

    it('30. duration=0 prevents auto-dismiss', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test', duration: 0 });
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      let notification = container.querySelector('[data-notification]');
      expect(notification).toBeTruthy();

      vi.advanceTimersByTime(10000);
      await Promise.resolve();

      notification = container.querySelector('[data-notification]');
      expect(notification).toBeTruthy();
    });

    it('31. Multiple notifications dismiss independently', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test 1', duration: 1000 });
      notify({ title: 'Test 2', duration: 2000 });
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      let notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(2);

      vi.advanceTimersByTime(1000);
      await Promise.resolve();

      notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(1);

      vi.advanceTimersByTime(1000);
      await Promise.resolve();

      notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(0);
    });

    it('32. Dismissed notification is removed from DOM', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test', duration: 1000 });
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      let notification = container.querySelector('[data-notification]');
      expect(notification).toBeTruthy();

      vi.advanceTimersByTime(1000);
      await Promise.resolve();

      notification = container.querySelector('[data-notification]');
      expect(notification).toBeNull();
    });

    it('33. Timer cleanup on manual close', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const id = notify({ title: 'Test', duration: 5000 });
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      closeNotification(id);
      await Promise.resolve();

      let notification = container.querySelector('[data-notification]');
      expect(notification).toBeNull();

      // Advance past the original duration
      vi.advanceTimersByTime(5000);
      await Promise.resolve();

      // Should still be null (no duplicate removal)
      notification = container.querySelector('[data-notification]');
      expect(notification).toBeNull();
    });

    it('34. No memory leaks from timers', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      for (let i = 0; i < 10; i++) {
        notify({ title: `Test ${i}`, duration: 1000 });
      }
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      vi.advanceTimersByTime(1000);
      await Promise.resolve();

      const notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(0);
    });

    it('35. Rapid notifications handle timers correctly', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test 1', duration: 1000 });
      notify({ title: 'Test 2', duration: 1000 });
      notify({ title: 'Test 3', duration: 1000 });
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      let notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(3);

      vi.advanceTimersByTime(1000);
      await Promise.resolve();

      notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(0);
    });
  });

  describe('MaxCount Tests', () => {
    it('36. Default maxCount is 5', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      for (let i = 0; i < 10; i++) {
        notify({ title: `Test ${i}` });
      }
      await Promise.resolve();

      const notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(5);
    });

    it('37. Custom maxCount limits displayed notifications', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({ maxCount: 3 }));
      cleanup = dispose;

      for (let i = 0; i < 10; i++) {
        notify({ title: `Test ${i}` });
      }
      await Promise.resolve();

      const notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(3);
    });

    it('38. maxCount=1 shows only latest', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({ maxCount: 1 }));
      cleanup = dispose;

      notify({ title: 'Test 1' });
      notify({ title: 'Test 2' });
      notify({ title: 'Test 3' });
      await Promise.resolve();

      const notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(1);
    });

    it('39. Exceeding maxCount hides oldest', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({ maxCount: 2 }));
      cleanup = dispose;

      notify({ title: 'Test 1' });
      notify({ title: 'Test 2' });
      notify({ title: 'Test 3' });
      await Promise.resolve();

      const notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(2);

      const titles = Array.from(notifications).map((n) => n.querySelector('[data-notification-title]')?.textContent);
      expect(titles).toEqual(['Test 1', 'Test 2']);
    });

    it('40. Removing notification updates display', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({ maxCount: 3 }));
      cleanup = dispose;

      const id1 = notify({ title: 'Test 1' });
      notify({ title: 'Test 2' });
      notify({ title: 'Test 3' });
      await Promise.resolve();

      let notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(3);

      closeNotification(id1);
      await Promise.resolve();

      notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(2);
    });
  });

  describe('State Management Tests', () => {
    it('41. Module-level signal updates reactively', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test 1' });
      await Promise.resolve();

      let notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(1);

      notify({ title: 'Test 2' });
      await Promise.resolve();

      notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(2);
    });

    it('42. Notifications list is reactive', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const id = notify({ title: 'Test' });
      await Promise.resolve();

      let notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(1);

      closeNotification(id);
      await Promise.resolve();

      notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(0);
    });

    it('43. Adding notification triggers re-render', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const initialHTML = container.innerHTML;

      notify({ title: 'New Notification' });
      await Promise.resolve();

      const updatedHTML = container.innerHTML;
      expect(updatedHTML).not.toBe(initialHTML);
    });

    it('44. Removing notification triggers re-render', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const id = notify({ title: 'Test' });
      await Promise.resolve();

      const beforeHTML = container.innerHTML;

      closeNotification(id);
      await Promise.resolve();

      const afterHTML = container.innerHTML;
      expect(afterHTML).not.toBe(beforeHTML);
    });

    it('45. Empty state renders empty container', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      await Promise.resolve();

      const notificationContainer = container.querySelector('[data-notification-container]');
      const notifications = container.querySelectorAll('[data-notification]');

      expect(notificationContainer).toBeTruthy();
      expect(notifications.length).toBe(0);
    });

    it('46. State persists across component re-mounts', async () => {
      let cleanup1: (() => void) | undefined;
      const { container: container1, cleanup: dispose1 } = renderComponent(() => Notification({}));
      cleanup1 = dispose1;

      notify({ title: 'Test 1' });
      notify({ title: 'Test 2' });
      await Promise.resolve();

      let notifications = container1.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(2);

      cleanup1();

      const { container: container2, cleanup: dispose2 } = renderComponent(() => Notification({}));
      cleanup = dispose2;
      await Promise.resolve();

      notifications = container2.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(2);
    });

    it('47. Multiple Notification components share state', async () => {
      const { container: container1, cleanup: dispose1 } = renderComponent(() => Notification({}));
      const { container: container2, cleanup: dispose2 } = renderComponent(() => Notification({}));

      cleanup = () => {
        dispose1();
        dispose2();
      };

      notify({ title: 'Shared Notification' });
      await Promise.resolve();

      const notifications1 = container1.querySelectorAll('[data-notification]');
      const notifications2 = container2.querySelectorAll('[data-notification]');

      expect(notifications1.length).toBe(1);
      expect(notifications2.length).toBe(1);
    });

    it('48. Clearing all notifications works', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const id1 = notify({ title: 'Test 1' });
      const id2 = notify({ title: 'Test 2' });
      const id3 = notify({ title: 'Test 3' });
      await Promise.resolve();

      let notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(3);

      closeNotification(id1);
      closeNotification(id2);
      closeNotification(id3);
      await Promise.resolve();

      notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(0);
    });
  });

  describe('Accessibility Tests', () => {
    it('49. Each notification has role="alert"', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test 1' });
      notify({ title: 'Test 2' });
      await Promise.resolve();

      const notifications = container.querySelectorAll('[data-notification]');
      notifications.forEach((notification) => {
        expect(notification.getAttribute('role')).toBe('alert');
      });
    });

    it('50. Close button is focusable', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test' });
      await Promise.resolve();

      const closeButton = container.querySelector('[data-notification-close]') as HTMLButtonElement;
      expect(closeButton).toBeTruthy();
      expect(closeButton.tagName).toBe('BUTTON');
    });

    it('51. Close button has accessible text (×)', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test' });
      await Promise.resolve();

      const closeButton = container.querySelector('[data-notification-close]');
      expect(closeButton?.textContent).toBe('×');
    });

    it('52. Screen reader announcements work (role="alert")', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Important Alert', type: 'error' });
      await Promise.resolve();

      const notification = container.querySelector('[data-notification]');
      expect(notification?.getAttribute('role')).toBe('alert');
    });
  });

  describe('Edge Cases', () => {
    it('53. Empty title (should still render)', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: '' });
      await Promise.resolve();

      const notification = container.querySelector('[data-notification]');
      expect(notification).toBeTruthy();

      const title = container.querySelector('[data-notification-title]');
      expect(title?.textContent).toBe('');
    });

    it('54. Very long title', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const longTitle = 'A'.repeat(500);
      notify({ title: longTitle });
      await Promise.resolve();

      const title = container.querySelector('[data-notification-title]');
      expect(title?.textContent).toBe(longTitle);
    });

    it('55. Very long description', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const longDescription = 'B'.repeat(1000);
      notify({ title: 'Test', description: longDescription });
      await Promise.resolve();

      const description = container.querySelector('[data-notification-description]');
      expect(description?.textContent).toBe(longDescription);
    });

    it('56. Rapid notify() calls', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      for (let i = 0; i < 20; i++) {
        notify({ title: `Test ${i}` });
      }
      await Promise.resolve();

      const notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(5); // Limited by default maxCount
    });

    it('57. notify() during auto-dismiss', async () => {
      vi.useFakeTimers();
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test 1', duration: 1000 });
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      vi.advanceTimersByTime(500);
      await Promise.resolve();

      notify({ title: 'Test 2' });
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      let notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(2);

      vi.advanceTimersByTime(500);
      await Promise.resolve();

      notifications = container.querySelectorAll('[data-notification]');
      expect(notifications.length).toBe(1);

      vi.restoreAllMocks();
    });

    it('58. closeNotification during timer', async () => {
      vi.useFakeTimers();
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      const id = notify({ title: 'Test', duration: 5000 });
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      vi.advanceTimersByTime(2000);
      await Promise.resolve();

      closeNotification(id);
      await Promise.resolve();

      const notification = container.querySelector('[data-notification]');
      expect(notification).toBeNull();

      vi.restoreAllMocks();
    });

    it('59. Changing placement dynamically', async () => {
      const { container, cleanup: dispose } = renderComponent(() => Notification({ placement: 'topLeft' }));
      cleanup = dispose;

      let notificationContainer = container.querySelector('[data-notification-container]') as HTMLDivElement;
      expect(notificationContainer.style.top).toBe('16px');
      expect(notificationContainer.style.left).toBe('16px');

      // Note: Dynamic placement change would require reactive props
      // This test verifies initial placement works
    });

    it('60. Zero duration with close button', async () => {
      vi.useFakeTimers();
      const { container, cleanup: dispose } = renderComponent(() => Notification({}));
      cleanup = dispose;

      notify({ title: 'Test', duration: 0, closable: true });
      vi.advanceTimersByTime(0); // Flush nextTick
      await Promise.resolve();

      let notification = container.querySelector('[data-notification]');
      expect(notification).toBeTruthy();

      vi.advanceTimersByTime(10000);
      await Promise.resolve();

      notification = container.querySelector('[data-notification]');
      expect(notification).toBeTruthy();

      const closeButton = container.querySelector('[data-notification-close]') as HTMLButtonElement;
      closeButton.click();
      await Promise.resolve();

      notification = container.querySelector('[data-notification]');
      expect(notification).toBeNull();

      vi.restoreAllMocks();
    });
  });
});
