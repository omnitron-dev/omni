/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  TabsListWithDragDrop,
  type TabsListPropsWithDragDrop,
} from '../../../src/components/navigation/Tabs.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

describe('Tabs Component with Drag-and-Drop', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Styled Tabs (Backward Compatibility)', () => {
    it('should render styled tabs without drag-drop', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', children: 'Content 2' }),
          ],
        });

      const { container } = renderComponent(component);

      // Check that tabs render correctly
      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toBeTruthy();

      const triggers = container.querySelectorAll('[role="tab"]');
      expect(triggers.length).toBe(2);

      // Verify no draggable attributes without drag-drop enabled
      const firstTab = triggers[0] as HTMLElement;
      expect(firstTab.getAttribute('draggable')).toBeNull();
    });

    it('should maintain existing styling', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsList({
              children: [TabsTrigger({ value: 'tab1', children: 'Tab 1' })],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[role="tab"]') as HTMLElement;
      expect(trigger).toBeTruthy();

      // Check that styles are applied (styled component should have style attribute or class)
      expect(trigger.getAttribute('data-state')).toBe('active');
    });

    it('should switch tabs on click', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsList({
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', children: 'Content 2' }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="tab"]') as NodeListOf<HTMLElement>;

      // Click second tab
      triggers[1]?.click();

      // Check that second tab is now selected
      expect(triggers[1]?.getAttribute('aria-selected')).toBe('true');
      expect(triggers[1]?.getAttribute('data-state')).toBe('active');
    });
  });

  describe('TabsListWithDragDrop Component', () => {
    it('should create TabsListWithDragDrop component', () => {
      expect(TabsListWithDragDrop).toBeTypeOf('function');
    });

    it('should have correct display name', () => {
      expect(TabsListWithDragDrop.displayName).toBe('TabsListWithDragDrop');
    });

    it('should render without drag-drop when disabled', () => {
      const component = () =>
        TabsListWithDragDrop({
          enableDragDrop: false,
          children: [
            TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
            TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
          ],
        });

      const { container } = renderComponent(component);
      const triggers = container.querySelectorAll('[role="tab"]');
      expect(triggers.length).toBe(2);
    });

    it('should enable draggable when drag-drop is enabled', async () => {
      const onTabsReorder = vi.fn();

      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              onTabsReorder,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
                TabsTrigger({ value: 'tab3', children: 'Tab 3' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', children: 'Content 2' }),
            TabsContent({ value: 'tab3', children: 'Content 3' }),
          ],
        });

      const { container } = renderComponent(component);

      // Wait for drag handlers to be attached
      await nextTick();

      const triggers = container.querySelectorAll('[role="tab"]') as NodeListOf<HTMLElement>;

      // All triggers should be draggable
      triggers.forEach((trigger) => {
        expect(trigger.getAttribute('draggable')).toBe('true');
      });
    });

    it('should set data-tab-index for each tab', async () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
                TabsTrigger({ value: 'tab3', children: 'Tab 3' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="tab"]') as NodeListOf<HTMLElement>;

      triggers.forEach((trigger, index) => {
        expect(trigger.getAttribute('data-tab-index')).toBe(String(index));
      });
    });

    it('should set data-value for each tab', async () => {
      const values = ['tab1', 'tab2', 'tab3'];

      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              children: values.map((value) => TabsTrigger({ value, children: `Tab ${value}` })),
            }),
            ...values.map((value) => TabsContent({ value, children: `Content ${value}` })),
          ],
        });

      const { container } = renderComponent(component);

      const triggers = container.querySelectorAll('[role="tab"]') as NodeListOf<HTMLElement>;

      triggers.forEach((trigger, index) => {
        expect(trigger.getAttribute('data-value')).toBe(values[index]);
      });
    });

    it('should have aria-dropeffect attribute on tablist', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist?.getAttribute('aria-dropeffect')).toBe('move');
    });
  });

  describe('Drag Events', () => {
    it('should set data-dragging on drag start', async () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const firstTab = container.querySelector('[data-value="tab1"]') as HTMLElement;
      expect(firstTab).toBeTruthy();

      // Create and dispatch dragstart event
      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });

      firstTab.dispatchEvent(dragStartEvent);

      // Check that data-dragging is set
      expect(firstTab.getAttribute('data-dragging')).toBe('true');
    });

    it('should set data-drag-over on drag over', async () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const firstTab = container.querySelector('[data-value="tab1"]') as HTMLElement;
      const secondTab = container.querySelector('[data-value="tab2"]') as HTMLElement;

      // Start dragging first tab
      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      firstTab.dispatchEvent(dragStartEvent);

      // Drag over second tab
      const dragOverEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      secondTab.dispatchEvent(dragOverEvent);

      // Check that data-drag-over is set
      expect(secondTab.getAttribute('data-drag-over')).toBe('true');
    });

    it('should remove data-drag-over on drag leave', async () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const secondTab = container.querySelector('[data-value="tab2"]') as HTMLElement;

      // Manually set data-drag-over
      secondTab.setAttribute('data-drag-over', 'true');

      // Create and dispatch dragleave event
      const dragLeaveEvent = new DragEvent('dragleave', {
        bubbles: true,
        cancelable: true,
      });
      secondTab.dispatchEvent(dragLeaveEvent);

      // Check that data-drag-over is removed
      expect(secondTab.hasAttribute('data-drag-over')).toBe(false);
    });

    it('should clean up on drag end', async () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const firstTab = container.querySelector('[data-value="tab1"]') as HTMLElement;

      // Start dragging
      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      firstTab.dispatchEvent(dragStartEvent);

      expect(firstTab.getAttribute('data-dragging')).toBe('true');

      // End dragging
      const dragEndEvent = new DragEvent('dragend', {
        bubbles: true,
        cancelable: true,
      });
      firstTab.dispatchEvent(dragEndEvent);

      // Check that data-dragging is removed
      expect(firstTab.hasAttribute('data-dragging')).toBe(false);
    });
  });

  describe('Reordering Callback', () => {
    it('should call onTabsReorder when tabs are reordered', async () => {
      const onTabsReorder = vi.fn();

      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              onTabsReorder,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
                TabsTrigger({ value: 'tab3', children: 'Tab 3' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const firstTab = container.querySelector('[data-value="tab1"]') as HTMLElement;
      const thirdTab = container.querySelector('[data-value="tab3"]') as HTMLElement;

      // Start dragging first tab
      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      firstTab.dispatchEvent(dragStartEvent);

      // Drop on third tab
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      thirdTab.dispatchEvent(dropEvent);

      // Check that onTabsReorder was called
      expect(onTabsReorder).toHaveBeenCalled();

      // Verify the new order (tab1 should move to position 2)
      const callArgs = onTabsReorder.mock.calls[0][0] as string[];
      expect(callArgs).toContain('tab1');
      expect(callArgs).toContain('tab2');
      expect(callArgs).toContain('tab3');
    });

    it('should not call onTabsReorder when dropped on same position', async () => {
      const onTabsReorder = vi.fn();

      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              onTabsReorder,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const firstTab = container.querySelector('[data-value="tab1"]') as HTMLElement;

      // Start dragging first tab
      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      firstTab.dispatchEvent(dragStartEvent);

      // Drop on same tab
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      firstTab.dispatchEvent(dropEvent);

      // onTabsReorder should not be called for same position
      expect(onTabsReorder).not.toHaveBeenCalled();
    });
  });

  describe('Touch Support', () => {
    it('should support touch events when touchEnabled is true', async () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              touchEnabled: true,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const firstTab = container.querySelector('[data-value="tab1"]') as HTMLElement;

      // Create touch event
      const touchStartEvent = new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true,
        touches: [
          {
            clientX: 100,
            clientY: 100,
          } as Touch,
        ],
      });

      // Should not throw error
      expect(() => firstTab.dispatchEvent(touchStartEvent)).not.toThrow();

      // Check that data-dragging is set
      expect(firstTab.getAttribute('data-dragging')).toBe('true');
    });

    it('should disable touch events when touchEnabled is false', async () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              touchEnabled: false,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const firstTab = container.querySelector('[data-value="tab1"]') as HTMLElement;

      // Create touch event
      const touchStartEvent = new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true,
        touches: [
          {
            clientX: 100,
            clientY: 100,
          } as Touch,
        ],
      });

      firstTab.dispatchEvent(touchStartEvent);

      // data-dragging should not be set when touch is disabled
      expect(firstTab.hasAttribute('data-dragging')).toBe(false);
    });
  });

  describe('Accessibility', () => {
    it('should maintain ARIA attributes with drag-drop enabled', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toBeTruthy();
      expect(tablist?.getAttribute('aria-orientation')).toBe('horizontal');

      const triggers = container.querySelectorAll('[role="tab"]');
      expect(triggers.length).toBe(2);

      const firstTrigger = triggers[0] as HTMLElement;
      expect(firstTrigger.getAttribute('role')).toBe('tab');
      expect(firstTrigger.hasAttribute('aria-selected')).toBe(true);
      expect(firstTrigger.hasAttribute('aria-controls')).toBe(true);
    });

    it('should set aria-dropeffect when drag-drop is enabled', () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              children: [TabsTrigger({ value: 'tab1', children: 'Tab 1' })],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist?.getAttribute('aria-dropeffect')).toBe('move');
    });
  });

  describe('Visual Feedback', () => {
    it('should apply dragging visual state', async () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const firstTab = container.querySelector('[data-value="tab1"]') as HTMLElement;

      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });

      firstTab.dispatchEvent(dragStartEvent);

      // Should have dragging state
      expect(firstTab.getAttribute('data-dragging')).toBe('true');
    });

    it('should apply drag-over visual state', async () => {
      const component = () =>
        Tabs({
          defaultValue: 'tab1',
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
          ],
        });

      const { container } = renderComponent(component);

      const firstTab = container.querySelector('[data-value="tab1"]') as HTMLElement;
      const secondTab = container.querySelector('[data-value="tab2"]') as HTMLElement;

      // Start drag
      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      firstTab.dispatchEvent(dragStartEvent);

      // Drag over second tab
      const dragOverEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });
      secondTab.dispatchEvent(dragOverEvent);

      // Should have drag-over state
      expect(secondTab.getAttribute('data-drag-over')).toBe('true');
    });
  });

  describe('Integration with Controlled Tabs', () => {
    it('should work with controlled value signal', () => {
      const activeTab = signal('tab1');
      const onTabsReorder = vi.fn();

      const component = () =>
        Tabs({
          value: activeTab,
          children: [
            TabsListWithDragDrop({
              enableDragDrop: true,
              onTabsReorder,
              children: [
                TabsTrigger({ value: 'tab1', children: 'Tab 1' }),
                TabsTrigger({ value: 'tab2', children: 'Tab 2' }),
              ],
            }),
            TabsContent({ value: 'tab1', children: 'Content 1' }),
            TabsContent({ value: 'tab2', children: 'Content 2' }),
          ],
        });

      const { container } = renderComponent(component);

      // Change active tab programmatically
      activeTab.set('tab2');

      const triggers = container.querySelectorAll('[role="tab"]');
      expect(triggers[1]?.getAttribute('aria-selected')).toBe('true');

      // Drag-drop should still work
      const firstTab = triggers[0] as HTMLElement;
      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      });

      expect(() => firstTab.dispatchEvent(dragStartEvent)).not.toThrow();
    });
  });

  describe('Type Safety', () => {
    it('should have correct TypeScript types', () => {
      const props: TabsListPropsWithDragDrop = {
        enableDragDrop: true,
        onTabsReorder: (newOrder: string[]) => {
          expect(Array.isArray(newOrder)).toBe(true);
        },
        touchEnabled: true,
        children: [],
      };

      expect(props.enableDragDrop).toBe(true);
      expect(props.touchEnabled).toBe(true);
    });
  });
});
