/**
 * DraggableTabs Component Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DraggableTabs, type DraggableTabItem } from '../../src/components/navigation/DraggableTabs.js';
import { createRoot } from '../../src/core/reactivity/batch.js';

describe('DraggableTabs Component', () => {
  let dispose: (() => void) | undefined;

  const mockTabs: DraggableTabItem[] = [
    { id: 'tab1', label: 'Tab 1', closeable: true, pinned: false },
    { id: 'tab2', label: 'Tab 2', closeable: true, pinned: false },
    { id: 'tab3', label: 'Tab 3', closeable: false, pinned: true },
    { id: 'tab4', label: 'Tab 4', closeable: true, pinned: false },
  ];

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
    document.body.innerHTML = '';
  });

  describe('Component Creation', () => {
    it('should create DraggableTabs component', () => {
      expect(DraggableTabs).toBeTypeOf('function');
    });

    it('should render without crashing', () => {
      expect(() => {
        dispose = createRoot(() => {
          const element = DraggableTabs({
            tabs: mockTabs,
            activeTab: 'tab1',
          });
          document.body.appendChild(element as HTMLElement);
        });
      }).not.toThrow();
    });

    it('should have display name', () => {
      expect(DraggableTabs.displayName).toBe('DraggableTabs');
    });
  });

  describe('Props', () => {
    it('should accept tabs prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
          });
        });
      }).not.toThrow();
    });

    it('should accept activeTab prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            activeTab: 'tab2',
          });
        });
      }).not.toThrow();
    });

    it('should accept onTabChange callback', () => {
      const onTabChange = vi.fn();
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            onTabChange,
          });
        });
      }).not.toThrow();
    });

    it('should accept onTabReorder callback', () => {
      const onTabReorder = vi.fn();
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            onTabReorder,
          });
        });
      }).not.toThrow();
    });

    it('should accept onTabClose callback', () => {
      const onTabClose = vi.fn();
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            onTabClose,
          });
        });
      }).not.toThrow();
    });

    it('should accept onTabAdd callback', () => {
      const onTabAdd = vi.fn();
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            onTabAdd,
            showAddButton: true,
          });
        });
      }).not.toThrow();
    });

    it('should accept maxTabs prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            maxTabs: 10,
          });
        });
      }).not.toThrow();
    });

    it('should accept showAddButton prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            showAddButton: true,
          });
        });
      }).not.toThrow();
    });

    it('should accept variant prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            variant: 'enclosed',
          });
        });
      }).not.toThrow();
    });

    it('should accept size prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            size: 'lg',
          });
        });
      }).not.toThrow();
    });

    it('should accept touchEnabled prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            touchEnabled: false,
          });
        });
      }).not.toThrow();
    });

    it('should accept animationDuration prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            animationDuration: 300,
          });
        });
      }).not.toThrow();
    });

    it('should accept className prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            className: 'custom-tabs',
          });
        });
      }).not.toThrow();
    });
  });

  describe('Tab Items', () => {
    it('should render all tabs', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const tabButtons = document.querySelectorAll('[data-tab-id]');
      expect(tabButtons.length).toBe(mockTabs.length);
    });

    it('should render tab labels', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      mockTabs.forEach((tab) => {
        const tabButton = document.querySelector(`[data-tab-id="${tab.id}"]`);
        expect(tabButton?.textContent).toContain(tab.label);
      });
    });

    it('should mark active tab with data-active attribute', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab2',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const activeTab = document.querySelector('[data-tab-id="tab2"]');
      expect(activeTab?.getAttribute('data-active')).toBe('true');
    });

    it('should mark pinned tabs with data-pinned attribute', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const pinnedTab = document.querySelector('[data-tab-id="tab3"]');
      expect(pinnedTab?.getAttribute('data-pinned')).toBe('true');
    });

    it('should set draggable attribute correctly', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const draggableTab = document.querySelector('[data-tab-id="tab1"]');
      const pinnedTab = document.querySelector('[data-tab-id="tab3"]');

      expect(draggableTab?.getAttribute('draggable')).toBe('true');
      expect(pinnedTab?.getAttribute('draggable')).toBe('false');
    });
  });

  describe('Close Buttons', () => {
    it('should render close buttons for closeable tabs', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const tab1 = document.querySelector('[data-tab-id="tab1"]');
      const closeButton = tab1?.querySelector('button[aria-label*="Close"]');
      expect(closeButton).toBeTruthy();
    });

    it('should not render close buttons for non-closeable tabs', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const tab3 = document.querySelector('[data-tab-id="tab3"]');
      const closeButton = tab3?.querySelector('button[aria-label*="Close"]');
      expect(closeButton).toBeFalsy();
    });

    it('should not render close buttons for pinned tabs', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const pinnedTab = document.querySelector('[data-tab-id="tab3"]');
      const closeButton = pinnedTab?.querySelector('button[aria-label*="Close"]');
      expect(closeButton).toBeFalsy();
    });
  });

  describe('Add Button', () => {
    it('should render add button when showAddButton is true', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
          showAddButton: true,
        });
        document.body.appendChild(element as HTMLElement);
      });

      const addButton = document.querySelector('button[aria-label="Add tab"]');
      expect(addButton).toBeTruthy();
    });

    it('should not render add button when showAddButton is false', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
          showAddButton: false,
        });
        document.body.appendChild(element as HTMLElement);
      });

      const addButton = document.querySelector('button[aria-label="Add tab"]');
      expect(addButton).toBeFalsy();
    });

    it('should disable add button when max tabs reached', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
          showAddButton: true,
          maxTabs: 4,
        });
        document.body.appendChild(element as HTMLElement);
      });

      const addButton = document.querySelector('button[aria-label="Add tab"]') as HTMLButtonElement;
      expect(addButton?.disabled).toBe(true);
    });

    it('should enable add button when below max tabs', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
          showAddButton: true,
          maxTabs: 10,
        });
        document.body.appendChild(element as HTMLElement);
      });

      const addButton = document.querySelector('button[aria-label="Add tab"]') as HTMLButtonElement;
      expect(addButton?.disabled).toBe(false);
    });
  });

  describe('Accessibility', () => {
    it('should have role="tablist"', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const tablist = document.querySelector('[role="tablist"]');
      expect(tablist).toBeTruthy();
    });

    it('should have aria-orientation="horizontal"', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const tablist = document.querySelector('[role="tablist"]');
      expect(tablist?.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should have aria-label on close buttons', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const tab1 = document.querySelector('[data-tab-id="tab1"]');
      const closeButton = tab1?.querySelector('button[aria-label*="Close"]');
      expect(closeButton?.getAttribute('aria-label')).toContain('Close');
    });

    it('should have aria-label on add button', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
          showAddButton: true,
        });
        document.body.appendChild(element as HTMLElement);
      });

      const addButton = document.querySelector('button[aria-label="Add tab"]');
      expect(addButton?.getAttribute('aria-label')).toBe('Add tab');
    });
  });

  describe('Tab Configuration', () => {
    it('should handle tabs with icons', () => {
      const tabsWithIcons: DraggableTabItem[] = [
        {
          id: 'tab1',
          label: 'Home',
          icon: '🏠',
        },
      ];

      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: tabsWithIcons,
            activeTab: 'tab1',
          });
        });
      }).not.toThrow();
    });

    it('should handle disabled tabs', () => {
      const tabsWithDisabled: DraggableTabItem[] = [
        {
          id: 'tab1',
          label: 'Enabled',
          disabled: false,
        },
        {
          id: 'tab2',
          label: 'Disabled',
          disabled: true,
        },
      ];

      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: tabsWithDisabled,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const disabledTab = document.querySelector('[data-tab-id="tab2"]');
      expect(disabledTab?.getAttribute('data-disabled')).toBe('true');
    });

    it('should handle tabs with custom data', () => {
      const tabsWithData: DraggableTabItem[] = [
        {
          id: 'tab1',
          label: 'Tab 1',
          data: { custom: 'value' },
        },
      ];

      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: tabsWithData,
            activeTab: 'tab1',
          });
        });
      }).not.toThrow();
    });
  });

  describe('Empty State', () => {
    it('should handle empty tabs array', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: [],
          });
        });
      }).not.toThrow();
    });

    it('should render no tabs when array is empty', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: [],
        });
        document.body.appendChild(element as HTMLElement);
      });

      const tabButtons = document.querySelectorAll('[data-tab-id]');
      expect(tabButtons.length).toBe(0);
    });
  });

  describe('Size Variants', () => {
    it('should accept size="sm"', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            size: 'sm',
          });
        });
      }).not.toThrow();
    });

    it('should accept size="md"', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            size: 'md',
          });
        });
      }).not.toThrow();
    });

    it('should accept size="lg"', () => {
      expect(() => {
        dispose = createRoot(() => {
          DraggableTabs({
            tabs: mockTabs,
            size: 'lg',
          });
        });
      }).not.toThrow();
    });
  });

  describe('Type Safety', () => {
    it('should have correct TypeScript types for DraggableTabItem', () => {
      const item: DraggableTabItem = {
        id: 'test',
        label: 'Test',
        closeable: true,
        pinned: false,
        icon: '📄',
        disabled: false,
        data: { key: 'value' },
      };

      expect(item.id).toBe('test');
      expect(item.label).toBe('Test');
    });

    it('should allow minimal tab item', () => {
      const item: DraggableTabItem = {
        id: 'test',
        label: 'Test',
      };

      expect(item.id).toBe('test');
      expect(item.label).toBe('Test');
    });
  });

  describe('Drag and Drop Attributes', () => {
    it('should set data-tab-index for each tab', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      mockTabs.forEach((tab, index) => {
        const tabButton = document.querySelector(`[data-tab-id="${tab.id}"]`);
        expect(tabButton?.getAttribute('data-tab-index')).toBe(String(index));
      });
    });

    it('should have drag event handlers on draggable tabs', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const draggableTab = document.querySelector('[data-tab-id="tab1"]') as HTMLElement;
      expect(draggableTab?.draggable).toBe(true);
    });

    it('should not have drag event handlers on pinned tabs', () => {
      dispose = createRoot(() => {
        const element = DraggableTabs({
          tabs: mockTabs,
          activeTab: 'tab1',
        });
        document.body.appendChild(element as HTMLElement);
      });

      const pinnedTab = document.querySelector('[data-tab-id="tab3"]') as HTMLElement;
      expect(pinnedTab?.draggable).toBe(false);
    });
  });
});
