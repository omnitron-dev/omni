/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Tree, TreeItem, TreeTrigger, TreeContent, TreeLabel } from '../../../src/primitives/Tree.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

describe('Tree', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render tree with correct role', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item 1' }),
            }),
        });

      const { container } = renderComponent(component);

      const tree = container.querySelector('[data-tree]');
      expect(tree).toBeTruthy();
      expect(tree?.getAttribute('role')).toBe('tree');
      expect(tree?.getAttribute('aria-label')).toBe('Tree view');
    });

    it('should render tree items', () => {
      const component = () =>
        Tree({
          children: () => [
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item 1' }),
            }),
            TreeItem({
              value: 'item2',
              children: () => TreeLabel({ children: 'Item 2' }),
            }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-tree-item]');
      expect(items.length).toBe(2);
    });
  });

  describe('TreeItem', () => {
    it('should render with treeitem role', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item 1' }),
            }),
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('[data-tree-item]');
      expect(item?.getAttribute('role')).toBe('treeitem');
      expect(item?.getAttribute('data-value')).toBe('item1');
    });

    it('should not be expanded initially', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [TreeTrigger({ children: 'Folder' }), TreeContent({ children: () => 'Content' })],
            }),
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('[data-tree-item]');
      expect(item?.hasAttribute('data-expanded')).toBe(false);
      expect(item?.getAttribute('aria-expanded')).toBe('false');
    });

    it('should not be selected initially', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item 1' }),
            }),
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('[data-tree-item]');
      expect(item?.hasAttribute('data-selected')).toBe(false);
      expect(item?.getAttribute('aria-selected')).toBe('false');
    });

    it('should support disabled state', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'item1',
              disabled: true,
              children: () => TreeLabel({ children: 'Disabled Item' }),
            }),
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('[data-tree-item]');
      expect(item?.hasAttribute('data-disabled')).toBe(true);
      expect(item?.getAttribute('aria-disabled')).toBe('true');
    });
  });

  describe('TreeTrigger', () => {
    it('should render as button', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [TreeTrigger({ children: 'Folder' }), TreeContent({ children: () => 'Content' })],
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-tree-trigger]');
      expect(trigger).toBeTruthy();
      expect(trigger?.tagName).toBe('BUTTON');
      expect(trigger?.getAttribute('type')).toBe('button');
    });

    it('should have closed state initially', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [TreeTrigger({ children: 'Folder' }), TreeContent({ children: () => 'Content' })],
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-tree-trigger]');
      expect(trigger?.getAttribute('data-state')).toBe('closed');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    });

    it('should expand on click', async () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [TreeTrigger({ children: 'Folder' }), TreeContent({ children: () => 'Content' })],
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-tree-trigger]') as HTMLButtonElement;
      trigger.click();
      await nextTick();

      expect(trigger.getAttribute('data-state')).toBe('open');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');

      const item = container.querySelector('[data-tree-item]');
      expect(item?.hasAttribute('data-expanded')).toBe(true);
    });

    it('should toggle expansion state', async () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [TreeTrigger({ children: 'Folder' }), TreeContent({ children: () => 'Content' })],
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-tree-trigger]') as HTMLButtonElement;

      // Expand
      trigger.click();
      await nextTick();
      expect(trigger.getAttribute('data-state')).toBe('open');

      // Collapse
      trigger.click();
      await nextTick();
      expect(trigger.getAttribute('data-state')).toBe('closed');
    });

    it('should not expand when disabled', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'folder1',
              disabled: true,
              children: () => [TreeTrigger({ children: 'Folder' }), TreeContent({ children: () => 'Content' })],
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-tree-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);

      trigger.click();
      expect(trigger.getAttribute('data-state')).toBe('closed');
    });
  });

  describe('TreeContent', () => {
    it('should not render when collapsed', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [TreeTrigger({ children: 'Folder' }), TreeContent({ children: () => 'Hidden Content' })],
            }),
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-tree-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.style.display).toBe('none');
      expect(content.getAttribute('data-state')).toBe('closed');
      expect(content.getAttribute('aria-hidden')).toBe('true');
    });

    it('should render when expanded', async () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [TreeTrigger({ children: 'Folder' }), TreeContent({ children: () => 'Visible Content' })],
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-tree-trigger]') as HTMLButtonElement;
      trigger.click();
      await nextTick();

      const content = container.querySelector('[data-tree-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.style.display).toBe('block');
      expect(content.textContent).toBe('Visible Content');
      expect(content.getAttribute('data-state')).toBe('open');
      expect(content.getAttribute('aria-hidden')).toBe('false');
      expect(content.getAttribute('role')).toBe('group');
    });
  });

  describe('TreeLabel', () => {
    it('should render label', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Label Text' }),
            }),
        });

      const { container } = renderComponent(component);

      const label = container.querySelector('[data-tree-label]');
      expect(label).toBeTruthy();
      expect(label?.textContent).toBe('Label Text');
    });

    it('should be clickable', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Clickable Label' }),
            }),
        });

      const { container } = renderComponent(component);

      const label = container.querySelector('[data-tree-label]') as HTMLElement;
      expect(label.getAttribute('tabIndex')).toBe('0');
    });

    it('should select item on click', async () => {
      const component = () =>
        Tree({
          children: () => [
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item 1' }),
            }),
            TreeItem({
              value: 'item2',
              children: () => TreeLabel({ children: 'Item 2' }),
            }),
          ],
        });

      const { container } = renderComponent(component);

      const labels = container.querySelectorAll('[data-tree-label]') as NodeListOf<HTMLElement>;
      labels[1]?.click();
      await nextTick();

      const items = container.querySelectorAll('[data-tree-item]');
      expect(items[0]?.hasAttribute('data-selected')).toBe(false);
      expect(items[1]?.hasAttribute('data-selected')).toBe(true);
      expect(items[1]?.getAttribute('aria-selected')).toBe('true');
    });

    it('should not be clickable when disabled', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'item1',
              disabled: true,
              children: () => TreeLabel({ children: 'Disabled Label' }),
            }),
        });

      const { container } = renderComponent(component);

      const label = container.querySelector('[data-tree-label]') as HTMLElement;
      expect(label.hasAttribute('tabIndex')).toBe(false);
    });
  });

  describe('Expansion control', () => {
    it('should support controlled expanded state', () => {
      const expanded = signal<string[]>([]);

      const component = () =>
        Tree({
          expanded,
          onExpandedChange: (value) => expanded.set(value),
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [TreeTrigger({ children: 'Folder' }), TreeContent({ children: () => 'Content' })],
            }),
        });

      const { container } = renderComponent(component);

      // Initially collapsed
      let content = container.querySelector('[data-tree-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.style.display).toBe('none');

      // Expand externally
      expanded.set(['folder1']);

      content = container.querySelector('[data-tree-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.style.display).toBe('block');

      // Collapse externally
      expanded.set([]);

      content = container.querySelector('[data-tree-content]') as HTMLElement;
      expect(content).toBeTruthy();
      expect(content.style.display).toBe('none');
    });

    it('should support defaultExpanded for uncontrolled mode', () => {
      const component = () =>
        Tree({
          defaultExpanded: ['folder1'],
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [TreeTrigger({ children: 'Folder' }), TreeContent({ children: () => 'Content' })],
            }),
        });

      const { container } = renderComponent(component);

      const content = container.querySelector('[data-tree-content]');
      expect(content).toBeTruthy();
      expect(content?.textContent).toBe('Content');
    });

    it('should support multiple expanded items', () => {
      const component = () =>
        Tree({
          defaultExpanded: ['folder1', 'folder2'],
          children: () => [
            TreeItem({
              value: 'folder1',
              children: () => [TreeTrigger({ children: 'Folder 1' }), TreeContent({ children: () => 'Content 1' })],
            }),
            TreeItem({
              value: 'folder2',
              children: () => [TreeTrigger({ children: 'Folder 2' }), TreeContent({ children: () => 'Content 2' })],
            }),
          ],
        });

      const { container } = renderComponent(component);

      const contents = container.querySelectorAll('[data-tree-content]');
      expect(contents.length).toBe(2);
      expect(contents[0]?.textContent).toBe('Content 1');
      expect(contents[1]?.textContent).toBe('Content 2');
    });
  });

  describe('Selection control', () => {
    it('should support controlled selected state', () => {
      const selected = signal('');

      const component = () =>
        Tree({
          selected,
          onSelectedChange: (value) => selected.set(value),
          children: () => [
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item 1' }),
            }),
            TreeItem({
              value: 'item2',
              children: () => TreeLabel({ children: 'Item 2' }),
            }),
          ],
        });

      const { container } = renderComponent(component);

      // Initially nothing selected
      let items = container.querySelectorAll('[data-tree-item]');
      expect(items[0]?.hasAttribute('data-selected')).toBe(false);
      expect(items[1]?.hasAttribute('data-selected')).toBe(false);

      // Select externally
      selected.set('item2');

      items = container.querySelectorAll('[data-tree-item]');
      expect(items[0]?.hasAttribute('data-selected')).toBe(false);
      expect(items[1]?.hasAttribute('data-selected')).toBe(true);
    });

    it('should support defaultSelected for uncontrolled mode', () => {
      const component = () =>
        Tree({
          defaultSelected: 'item2',
          children: () => [
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item 1' }),
            }),
            TreeItem({
              value: 'item2',
              children: () => TreeLabel({ children: 'Item 2' }),
            }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-tree-item]');
      expect(items[0]?.hasAttribute('data-selected')).toBe(false);
      expect(items[1]?.hasAttribute('data-selected')).toBe(true);
    });

    it('should call onSelectedChange when item is clicked', () => {
      let selectedValue = '';

      const component = () =>
        Tree({
          onSelectedChange: (value) => {
            selectedValue = value;
          },
          children: () =>
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item 1' }),
            }),
        });

      const { container } = renderComponent(component);

      const label = container.querySelector('[data-tree-label]') as HTMLElement;
      label.click();

      expect(selectedValue).toBe('item1');
    });

    it('should only allow single selection', async () => {
      const component = () =>
        Tree({
          children: () => [
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item 1' }),
            }),
            TreeItem({
              value: 'item2',
              children: () => TreeLabel({ children: 'Item 2' }),
            }),
            TreeItem({
              value: 'item3',
              children: () => TreeLabel({ children: 'Item 3' }),
            }),
          ],
        });

      const { container } = renderComponent(component);

      const labels = container.querySelectorAll('[data-tree-label]') as NodeListOf<HTMLElement>;

      // Select first
      labels[0]?.click();
      await nextTick();
      let items = container.querySelectorAll('[data-tree-item]');
      expect(items[0]?.hasAttribute('data-selected')).toBe(true);
      expect(items[1]?.hasAttribute('data-selected')).toBe(false);

      // Select second (should deselect first)
      labels[1]?.click();
      await nextTick();
      items = container.querySelectorAll('[data-tree-item]');
      expect(items[0]?.hasAttribute('data-selected')).toBe(false);
      expect(items[1]?.hasAttribute('data-selected')).toBe(true);
    });
  });

  describe('Nested tree structure', () => {
    it('should render nested tree items', async () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [
                TreeTrigger({ children: 'Folder' }),
                TreeContent({
                  children: () => [
                    TreeItem({
                      value: 'file1',
                      children: () => TreeLabel({ children: 'File 1' }),
                    }),
                    TreeItem({
                      value: 'file2',
                      children: () => TreeLabel({ children: 'File 2' }),
                    }),
                  ],
                }),
              ],
            }),
        });

      const { container } = renderComponent(component);

      // Initially, nested items exist but content is hidden (visibility toggle pattern)
      const items = container.querySelectorAll('[data-tree-item]');
      expect(items.length).toBe(3); // All items in DOM (parent + 2 children)

      const content = container.querySelector('[data-tree-content]') as HTMLElement;
      expect(content.style.display).toBe('none'); // Content is hidden

      // Expand parent
      const trigger = container.querySelector('[data-tree-trigger]') as HTMLButtonElement;
      trigger.click();
      await nextTick();

      // Now content is visible
      expect(content.style.display).toBe('block'); // Content is visible
      expect(items.length).toBe(3); // Still 3 items (they were always in DOM)
    });

    it('should support deeply nested structures', () => {
      const component = () =>
        Tree({
          defaultExpanded: ['folder1', 'subfolder1'],
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [
                TreeTrigger({ children: 'Folder' }),
                TreeContent({
                  children: () =>
                    TreeItem({
                      value: 'subfolder1',
                      children: () => [
                        TreeTrigger({ children: 'Subfolder' }),
                        TreeContent({
                          children: () =>
                            TreeItem({
                              value: 'file1',
                              children: () => TreeLabel({ children: 'File' }),
                            }),
                        }),
                      ],
                    }),
                }),
              ],
            }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-tree-item]');
      expect(items.length).toBe(3); // All three levels

      const labels = container.querySelectorAll('[data-tree-label]');
      expect(labels.length).toBe(1); // Only the deepest item has a label
    });
  });

  describe('ARIA attributes', () => {
    it('should have proper ARIA on tree', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item' }),
            }),
        });

      const { container } = renderComponent(component);

      const tree = container.querySelector('[data-tree]');
      expect(tree?.getAttribute('role')).toBe('tree');
      expect(tree?.getAttribute('aria-label')).toBe('Tree view');
    });

    it('should have proper ARIA on tree item', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item' }),
            }),
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('[data-tree-item]');
      expect(item?.getAttribute('role')).toBe('treeitem');
      expect(item?.getAttribute('aria-expanded')).toBe('false');
      expect(item?.getAttribute('aria-selected')).toBe('false');
    });

    it('should update ARIA when expanded', async () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'folder1',
              children: () => [TreeTrigger({ children: 'Folder' }), TreeContent({ children: () => 'Content' })],
            }),
        });

      const { container } = renderComponent(component);

      const trigger = container.querySelector('[data-tree-trigger]') as HTMLButtonElement;
      const item = container.querySelector('[data-tree-item]');

      expect(item?.getAttribute('aria-expanded')).toBe('false');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      trigger.click();
      await nextTick();

      expect(item?.getAttribute('aria-expanded')).toBe('true');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('should update ARIA when selected', async () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'item1',
              children: () => TreeLabel({ children: 'Item' }),
            }),
        });

      const { container } = renderComponent(component);

      const label = container.querySelector('[data-tree-label]') as HTMLElement;
      const item = container.querySelector('[data-tree-item]');

      expect(item?.getAttribute('aria-selected')).toBe('false');

      label.click();
      await nextTick();

      expect(item?.getAttribute('aria-selected')).toBe('true');
    });

    it('should have proper ARIA on disabled item', () => {
      const component = () =>
        Tree({
          children: () =>
            TreeItem({
              value: 'item1',
              disabled: true,
              children: () => TreeLabel({ children: 'Disabled' }),
            }),
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('[data-tree-item]');
      expect(item?.getAttribute('aria-disabled')).toBe('true');
    });
  });

  describe('Mixed tree structure', () => {
    it('should handle mix of folders and files', () => {
      const component = () =>
        Tree({
          defaultExpanded: ['folder1'],
          children: () => [
            TreeItem({
              value: 'folder1',
              children: () => [
                TreeTrigger({ children: '📁 Folder' }),
                TreeContent({
                  children: () => [
                    TreeItem({
                      value: 'file1',
                      children: () => TreeLabel({ children: '📄 File 1' }),
                    }),
                    TreeItem({
                      value: 'file2',
                      children: () => TreeLabel({ children: '📄 File 2' }),
                    }),
                  ],
                }),
              ],
            }),
            TreeItem({
              value: 'file3',
              children: () => TreeLabel({ children: '📄 File 3' }),
            }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-tree-item]');
      expect(items.length).toBe(4); // 1 folder + 3 files

      const labels = container.querySelectorAll('[data-tree-label]');
      expect(labels.length).toBe(3); // 3 file labels

      const triggers = container.querySelectorAll('[data-tree-trigger]');
      expect(triggers.length).toBe(1); // 1 folder trigger
    });
  });
});
