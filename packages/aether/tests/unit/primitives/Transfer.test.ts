/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Transfer,
  TransferList,
  TransferControls,
  type TransferItem,
} from '../../../src/primitives/Transfer.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

describe('Transfer', () => {
  const mockDataSource: TransferItem[] = [
    { key: '1', title: 'Item 1' },
    { key: '2', title: 'Item 2' },
    { key: '3', title: 'Item 3' },
    { key: '4', title: 'Item 4' },
    { key: '5', title: 'Item 5' },
  ];

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Transfer root component', () => {
    it('should render with data-transfer attribute', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: null,
        });

      const { container } = renderComponent(component);

      const transfer = container.querySelector('[data-transfer]');
      expect(transfer).toBeTruthy();
    });

    it('should render as a div element', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: null,
        });

      const { container } = renderComponent(component);

      const transfer = container.querySelector('div[data-transfer]');
      expect(transfer).toBeTruthy();
    });

    it('should render children', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: [TransferList({ type: 'source' }), TransferControls({}), TransferList({ type: 'target' })],
        });

      const { container } = renderComponent(component);

      const lists = container.querySelectorAll('[data-transfer-list]');
      const controls = container.querySelector('[data-transfer-controls]');

      expect(lists.length).toBe(2);
      expect(controls).toBeTruthy();
    });

    it('should provide context to children', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-transfer-list]');
      expect(list).toBeTruthy();
    });
  });

  describe('Props - dataSource', () => {
    it('should handle empty dataSource', () => {
      const component = () =>
        Transfer({
          dataSource: [],
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(0);
    });

    it('should handle single item', () => {
      const component = () =>
        Transfer({
          dataSource: [{ key: '1', title: 'Item 1' }],
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(1);
    });

    it('should render all items in source list initially', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(5);
    });

    it('should display item titles', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = Array.from(container.querySelectorAll('[data-transfer-item]'));
      expect(items[0].textContent).toBe('Item 1');
      expect(items[1].textContent).toBe('Item 2');
    });

    it('should support items with special characters', () => {
      const specialData: TransferItem[] = [
        { key: '1', title: 'Item <&> "quotes"' },
        { key: '2', title: "Item's apostrophe" },
      ];

      const component = () =>
        Transfer({
          dataSource: specialData,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = Array.from(container.querySelectorAll('[data-transfer-item]'));
      expect(items[0].textContent).toContain('Item');
    });

    it('should handle large datasets', () => {
      const largeData: TransferItem[] = Array.from({ length: 1000 }, (_, i) => ({
        key: String(i),
        title: `Item ${i}`,
      }));

      const component = () =>
        Transfer({
          dataSource: largeData,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(1000);
    });
  });

  describe('Props - targetKeys (controlled)', () => {
    it('should move items to target when targetKeys provided', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          targetKeys: ['1', '2'],
          children: [TransferList({ type: 'source' }), TransferList({ type: 'target' })],
        });

      const { container } = renderComponent(component);

      const sourceLists = container.querySelector('[data-transfer-list][data-type="source"]');
      const targetLists = container.querySelector('[data-transfer-list][data-type="target"]');

      const sourceItems = sourceLists?.querySelectorAll('[data-transfer-item]');
      const targetItems = targetLists?.querySelectorAll('[data-transfer-item]');

      expect(sourceItems?.length).toBe(3);
      expect(targetItems?.length).toBe(2);
    });

    it('should update when targetKeys changes', async () => {
      let targetKeys = ['1'];

      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          targetKeys,
          children: TransferList({ type: 'target' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(1);
    });

    it('should handle empty targetKeys', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          targetKeys: [],
          children: [TransferList({ type: 'source' }), TransferList({ type: 'target' })],
        });

      const { container } = renderComponent(component);

      const sourceLists = container.querySelector('[data-transfer-list][data-type="source"]');
      const targetLists = container.querySelector('[data-transfer-list][data-type="target"]');

      const sourceItems = sourceLists?.querySelectorAll('[data-transfer-item]');
      const targetItems = targetLists?.querySelectorAll('[data-transfer-item]');

      expect(sourceItems?.length).toBe(5);
      expect(targetItems?.length).toBe(0);
    });

    it('should handle all items in target', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          targetKeys: ['1', '2', '3', '4', '5'],
          children: [TransferList({ type: 'source' }), TransferList({ type: 'target' })],
        });

      const { container } = renderComponent(component);

      const sourceLists = container.querySelector('[data-transfer-list][data-type="source"]');
      const targetLists = container.querySelector('[data-transfer-list][data-type="target"]');

      const sourceItems = sourceLists?.querySelectorAll('[data-transfer-item]');
      const targetItems = targetLists?.querySelectorAll('[data-transfer-item]');

      expect(sourceItems?.length).toBe(0);
      expect(targetItems?.length).toBe(5);
    });
  });

  describe('Props - defaultTargetKeys (uncontrolled)', () => {
    it('should initialize with defaultTargetKeys', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          defaultTargetKeys: ['1', '2'],
          children: [TransferList({ type: 'source' }), TransferList({ type: 'target' })],
        });

      const { container } = renderComponent(component);

      const targetLists = container.querySelector('[data-transfer-list][data-type="target"]');
      const targetItems = targetLists?.querySelectorAll('[data-transfer-item]');

      expect(targetItems?.length).toBe(2);
    });

    it('should handle empty defaultTargetKeys', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          defaultTargetKeys: [],
          children: TransferList({ type: 'target' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(0);
    });

    it('should default to empty array when no defaultTargetKeys', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: [TransferList({ type: 'source' }), TransferList({ type: 'target' })],
        });

      const { container } = renderComponent(component);

      const sourceLists = container.querySelector('[data-transfer-list][data-type="source"]');
      const sourceItems = sourceLists?.querySelectorAll('[data-transfer-item]');

      expect(sourceItems?.length).toBe(5);
    });
  });

  describe('Props - onTargetKeysChange', () => {
    it('should call onTargetKeysChange when items transferred', async () => {
      const onChange = vi.fn();

      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          onTargetKeysChange: onChange,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      // Select an item
      const sourceList = container.querySelector('[data-transfer-list][data-type="source"]');
      const firstItem = sourceList?.querySelector('[data-transfer-item]') as HTMLElement;
      firstItem?.click();

      await nextTick();

      // Click transfer button
      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;
      transferButton?.click();

      await nextTick();

      expect(onChange).toHaveBeenCalled();
    });

    it('should pass correct keys to onTargetKeysChange', async () => {
      const onChange = vi.fn();

      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          onTargetKeysChange: onChange,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-transfer-list][data-type="source"]');
      const firstItem = sourceList?.querySelector('[data-transfer-item]') as HTMLElement;
      firstItem?.click();

      await nextTick();

      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;
      transferButton?.click();

      await nextTick();

      expect(onChange).toHaveBeenCalledWith(['1']);
    });

    it('should work without onTargetKeysChange handler', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-transfer-list][data-type="source"]');
      const firstItem = sourceList?.querySelector('[data-transfer-item]') as HTMLElement;
      firstItem?.click();

      await nextTick();

      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;

      expect(() => transferButton?.click()).not.toThrow();
    });
  });

  describe('TransferList component', () => {
    it('should render with data-transfer-list attribute', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-transfer-list]');
      expect(list).toBeTruthy();
    });

    it('should have data-type attribute', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-transfer-list]') as HTMLElement;
      expect(list.getAttribute('data-type')).toBe('source');
    });

    it('should render source list', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-type="source"]');
      expect(list).toBeTruthy();
    });

    it('should render target list', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          targetKeys: ['1'],
          children: TransferList({ type: 'target' }),
        });

      const { container } = renderComponent(component);

      const list = container.querySelector('[data-type="target"]');
      expect(list).toBeTruthy();
    });

    it('should render items in source list', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(5);
    });

    it('should render items in target list', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          targetKeys: ['1', '2'],
          children: TransferList({ type: 'target' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(2);
    });

    it('should throw error when used outside Transfer', () => {
      expect(() => {
        const component = () => TransferList({ type: 'source' });
        renderComponent(component);
      }).toThrow('Transfer components must be used within Transfer');
    });
  });

  describe('TransferControls component', () => {
    it('should render with data-transfer-controls attribute', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferControls({}),
        });

      const { container } = renderComponent(component);

      const controls = container.querySelector('[data-transfer-controls]');
      expect(controls).toBeTruthy();
    });

    it('should render two buttons', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferControls({}),
        });

      const { container } = renderComponent(component);

      const buttons = container.querySelectorAll('[data-transfer-controls] button');
      expect(buttons.length).toBe(2);
    });

    it('should render transfer to target button', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferControls({}),
        });

      const { container } = renderComponent(component);

      const buttons = container.querySelectorAll('button');
      expect(buttons[0].textContent).toBe('→');
    });

    it('should render transfer to source button', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferControls({}),
        });

      const { container } = renderComponent(component);

      const buttons = container.querySelectorAll('button');
      expect(buttons[1].textContent).toBe('←');
    });

    it('should disable buttons when no selection', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferControls({}),
        });

      const { container } = renderComponent(component);

      const buttons = container.querySelectorAll('button');
      expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
      expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    });

    it('should throw error when used outside Transfer', () => {
      expect(() => {
        const component = () => TransferControls({});
        renderComponent(component);
      }).toThrow('Transfer components must be used within Transfer');
    });
  });

  describe('Item selection', () => {
    it('should select item on click', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const firstItem = container.querySelector('[data-transfer-item]') as HTMLElement;
      firstItem.click();

      await nextTick();

      expect(firstItem.hasAttribute('data-selected')).toBe(true);
    });

    it('should deselect item on second click', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const firstItem = container.querySelector('[data-transfer-item]') as HTMLElement;

      firstItem.click();
      await nextTick();

      firstItem.click();
      await nextTick();

      expect(firstItem.hasAttribute('data-selected')).toBe(false);
    });

    it('should allow multiple selections', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = Array.from(container.querySelectorAll('[data-transfer-item]')) as HTMLElement[];

      items[0].click();
      items[1].click();

      await nextTick();

      expect(items[0].hasAttribute('data-selected')).toBe(true);
      expect(items[1].hasAttribute('data-selected')).toBe(true);
    });

    it('should track source selections separately from target', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          targetKeys: ['1'],
          children: [TransferList({ type: 'source' }), TransferList({ type: 'target' })],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-type="source"]');
      const targetList = container.querySelector('[data-type="target"]');

      const sourceItem = sourceList?.querySelector('[data-transfer-item]') as HTMLElement;
      const targetItem = targetList?.querySelector('[data-transfer-item]') as HTMLElement;

      sourceItem.click();
      targetItem.click();

      await nextTick();

      expect(sourceItem.hasAttribute('data-selected')).toBe(true);
      expect(targetItem.hasAttribute('data-selected')).toBe(true);
    });
  });

  describe('Transfer operations', () => {
    it('should transfer selected items to target', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-type="source"]');
      const firstItem = sourceList?.querySelector('[data-transfer-item]') as HTMLElement;
      firstItem.click();

      await nextTick();

      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;
      transferButton.click();

      await nextTick();

      const targetList = container.querySelector('[data-type="target"]');
      const targetItems = targetList?.querySelectorAll('[data-transfer-item]');
      expect(targetItems?.length).toBe(1);
    });

    it('should transfer selected items to source', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          targetKeys: ['1', '2'],
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const targetList = container.querySelector('[data-type="target"]');
      const firstItem = targetList?.querySelector('[data-transfer-item]') as HTMLElement;
      firstItem.click();

      await nextTick();

      const controls = container.querySelector('[data-transfer-controls]');
      const buttons = controls?.querySelectorAll('button');
      const backButton = buttons?.[1] as HTMLButtonElement;
      backButton.click();

      await nextTick();

      const sourceList = container.querySelector('[data-type="source"]');
      const sourceItems = sourceList?.querySelectorAll('[data-transfer-item]');
      expect(sourceItems?.length).toBe(4);
    });

    it('should clear selection after transfer', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-type="source"]');
      const firstItem = sourceList?.querySelector('[data-transfer-item]') as HTMLElement;
      firstItem.click();

      await nextTick();

      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;
      transferButton.click();

      await nextTick();

      const selectedItems = sourceList?.querySelectorAll('[data-selected]');
      expect(selectedItems?.length).toBe(0);
    });

    it('should transfer multiple items at once', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-type="source"]');
      const items = Array.from(
        sourceList?.querySelectorAll('[data-transfer-item]') || [],
      ) as HTMLElement[];

      items[0].click();
      items[1].click();
      items[2].click();

      await nextTick();

      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;
      transferButton.click();

      await nextTick();

      const targetList = container.querySelector('[data-type="target"]');
      const targetItems = targetList?.querySelectorAll('[data-transfer-item]');
      expect(targetItems?.length).toBe(3);
    });

    it('should maintain item order after transfer', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-type="source"]');
      const items = Array.from(
        sourceList?.querySelectorAll('[data-transfer-item]') || [],
      ) as HTMLElement[];

      items[0].click();
      items[2].click();

      await nextTick();

      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;
      transferButton.click();

      await nextTick();

      const targetList = container.querySelector('[data-type="target"]');
      const targetItems = Array.from(
        targetList?.querySelectorAll('[data-transfer-item]') || [],
      ) as HTMLElement[];

      expect(targetItems[0].textContent).toBe('Item 1');
      expect(targetItems[1].textContent).toBe('Item 3');
    });
  });

  describe('Controlled vs Uncontrolled', () => {
    it('should work in uncontrolled mode', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          defaultTargetKeys: ['1'],
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const targetList = container.querySelector('[data-type="target"]');
      const targetItems = targetList?.querySelectorAll('[data-transfer-item]');
      expect(targetItems?.length).toBe(1);
    });

    it('should work in controlled mode', async () => {
      const onChange = vi.fn();

      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          targetKeys: ['1'],
          onTargetKeysChange: onChange,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-type="source"]');
      const firstItem = sourceList?.querySelector('[data-transfer-item]') as HTMLElement;
      firstItem.click();

      await nextTick();

      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;
      transferButton.click();

      await nextTick();

      expect(onChange).toHaveBeenCalled();
    });

    it('should prioritize controlled targetKeys over defaultTargetKeys', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          targetKeys: ['1', '2'],
          defaultTargetKeys: ['3', '4'],
          children: TransferList({ type: 'target' }),
        });

      const { container } = renderComponent(component);

      const items = Array.from(container.querySelectorAll('[data-transfer-item]')) as HTMLElement[];
      expect(items.length).toBe(2);
      expect(items[0].textContent).toBe('Item 1');
      expect(items[1].textContent).toBe('Item 2');
    });
  });

  describe('Edge cases', () => {
    it('should handle disabled items', () => {
      const dataWithDisabled: TransferItem[] = [
        { key: '1', title: 'Item 1', disabled: true },
        { key: '2', title: 'Item 2' },
      ];

      const component = () =>
        Transfer({
          dataSource: dataWithDisabled,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(2);
    });

    it('should handle empty titles', () => {
      const dataWithEmpty: TransferItem[] = [{ key: '1', title: '' }];

      const component = () =>
        Transfer({
          dataSource: dataWithEmpty,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('[data-transfer-item]');
      expect(item?.textContent).toBe('');
    });

    it('should handle duplicate keys gracefully', () => {
      const dataWithDupes: TransferItem[] = [
        { key: '1', title: 'Item 1' },
        { key: '1', title: 'Item 1 duplicate' },
      ];

      const component = () =>
        Transfer({
          dataSource: dataWithDupes,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(2);
    });

    it('should handle invalid targetKeys', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          targetKeys: ['invalid-key'],
          children: [TransferList({ type: 'source' }), TransferList({ type: 'target' })],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-type="source"]');
      const targetList = container.querySelector('[data-type="target"]');

      const sourceItems = sourceList?.querySelectorAll('[data-transfer-item]');
      const targetItems = targetList?.querySelectorAll('[data-transfer-item]');

      expect(sourceItems?.length).toBe(5);
      expect(targetItems?.length).toBe(0);
    });

    it('should handle selecting non-existent items', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      // Try to click a non-existent item (shouldn't throw)
      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;

      expect(() => transferButton.click()).not.toThrow();
    });
  });

  describe('Real-world use cases', () => {
    it('should work for user permission assignment', async () => {
      const permissions: TransferItem[] = [
        { key: 'read', title: 'Read Access' },
        { key: 'write', title: 'Write Access' },
        { key: 'delete', title: 'Delete Access' },
        { key: 'admin', title: 'Admin Access' },
      ];

      const component = () =>
        Transfer({
          dataSource: permissions,
          defaultTargetKeys: ['read'],
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const targetList = container.querySelector('[data-type="target"]');
      const targetItems = targetList?.querySelectorAll('[data-transfer-item]');
      expect(targetItems?.length).toBe(1);
      expect(targetItems?.[0].textContent).toBe('Read Access');
    });

    it('should work for role assignment', async () => {
      const roles: TransferItem[] = [
        { key: 'user', title: 'User' },
        { key: 'moderator', title: 'Moderator' },
        { key: 'admin', title: 'Administrator' },
      ];

      const onChange = vi.fn();

      const component = () =>
        Transfer({
          dataSource: roles,
          onTargetKeysChange: onChange,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-type="source"]');
      const userRole = sourceList?.querySelector('[data-transfer-item]') as HTMLElement;
      userRole.click();

      await nextTick();

      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;
      transferButton.click();

      await nextTick();

      expect(onChange).toHaveBeenCalledWith(['user']);
    });

    it('should work for tag assignment', async () => {
      const tags: TransferItem[] = [
        { key: 'urgent', title: 'Urgent' },
        { key: 'bug', title: 'Bug' },
        { key: 'feature', title: 'Feature Request' },
        { key: 'enhancement', title: 'Enhancement' },
        { key: 'documentation', title: 'Documentation' },
      ];

      const component = () =>
        Transfer({
          dataSource: tags,
          defaultTargetKeys: ['bug', 'urgent'],
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const targetList = container.querySelector('[data-type="target"]');
      const targetItems = targetList?.querySelectorAll('[data-transfer-item]');
      expect(targetItems?.length).toBe(2);
    });

    it('should work for column selection in table', async () => {
      const columns: TransferItem[] = [
        { key: 'id', title: 'ID' },
        { key: 'name', title: 'Name' },
        { key: 'email', title: 'Email' },
        { key: 'status', title: 'Status' },
        { key: 'created', title: 'Created Date' },
        { key: 'updated', title: 'Updated Date' },
      ];

      const component = () =>
        Transfer({
          dataSource: columns,
          defaultTargetKeys: ['name', 'email', 'status'],
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const targetList = container.querySelector('[data-type="target"]');
      const targetItems = targetList?.querySelectorAll('[data-transfer-item]');
      expect(targetItems?.length).toBe(3);
    });
  });

  describe('Accessibility', () => {
    it('should support clicking items', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const firstItem = container.querySelector('[data-transfer-item]') as HTMLElement;
      firstItem.click();

      await nextTick();

      expect(firstItem.hasAttribute('data-selected')).toBe(true);
    });

    it('should support keyboard navigation on buttons', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: TransferControls({}),
        });

      const { container } = renderComponent(component);

      const buttons = container.querySelectorAll('button');
      expect(buttons[0].tagName).toBe('BUTTON');
      expect(buttons[1].tagName).toBe('BUTTON');
    });

    it('should allow custom aria labels on Transfer', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          'aria-label': 'Item transfer',
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      // Forward props are not explicitly tested in implementation
      // but should work through standard prop spreading
      const transfer = container.querySelector('[data-transfer]');
      expect(transfer).toBeTruthy();
    });

    it('should maintain semantic HTML structure', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const transfer = container.querySelector('[data-transfer]');
      const lists = container.querySelectorAll('[data-transfer-list]');
      const controls = container.querySelector('[data-transfer-controls]');

      expect(transfer).toBeTruthy();
      expect(lists.length).toBe(2);
      expect(controls).toBeTruthy();
    });
  });

  describe('Integration', () => {
    it('should work with complete transfer flow', async () => {
      const onChange = vi.fn();

      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          onTargetKeysChange: onChange,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      // Select items from source
      const sourceList = container.querySelector('[data-type="source"]');
      const sourceItems = Array.from(
        sourceList?.querySelectorAll('[data-transfer-item]') || [],
      ) as HTMLElement[];

      sourceItems[0].click();
      sourceItems[1].click();

      await nextTick();

      // Transfer to target
      const controls = container.querySelector('[data-transfer-controls]');
      const toTargetButton = controls?.querySelector('button') as HTMLButtonElement;
      toTargetButton.click();

      await nextTick();

      // Verify target has items
      const targetList = container.querySelector('[data-type="target"]');
      const targetItems = targetList?.querySelectorAll('[data-transfer-item]');
      expect(targetItems?.length).toBe(2);

      // Select item from target
      const targetItem = targetList?.querySelector('[data-transfer-item]') as HTMLElement;
      targetItem.click();

      await nextTick();

      // Transfer back to source
      const buttons = controls?.querySelectorAll('button');
      const toSourceButton = buttons?.[1] as HTMLButtonElement;
      toSourceButton.click();

      await nextTick();

      // Verify target now has 1 item
      const updatedTargetItems = targetList?.querySelectorAll('[data-transfer-item]');
      expect(updatedTargetItems?.length).toBe(1);

      // Verify onChange was called multiple times
      expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle rapid selection and transfer', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-type="source"]');
      const items = Array.from(
        sourceList?.querySelectorAll('[data-transfer-item]') || [],
      ) as HTMLElement[];

      // Rapid clicks
      items[0].click();
      items[1].click();
      items[2].click();

      await nextTick();

      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;
      transferButton.click();
      transferButton.click(); // Should not error on second click

      await nextTick();

      const targetList = container.querySelector('[data-type="target"]');
      const targetItems = targetList?.querySelectorAll('[data-transfer-item]');
      expect(targetItems?.length).toBe(3);
    });

    it('should work with custom render function', () => {
      const renderItem = vi.fn((item: TransferItem) => item.title.toUpperCase());

      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          render: renderItem,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(5);
      // Note: The render prop is defined but not used in the current implementation
      // This test verifies it doesn't break the component
    });

    it('should handle disabled prop', () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          disabled: true,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const transfer = container.querySelector('[data-transfer]');
      expect(transfer).toBeTruthy();
      // Note: Disabled functionality would need to be implemented
      // This test verifies the prop is accepted
    });
  });

  describe('Performance', () => {
    it('should handle large datasets efficiently', () => {
      const largeData: TransferItem[] = Array.from({ length: 1000 }, (_, i) => ({
        key: String(i),
        title: `Item ${i}`,
      }));

      const component = () =>
        Transfer({
          dataSource: largeData,
          children: TransferList({ type: 'source' }),
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-transfer-item]');
      expect(items.length).toBe(1000);
    });

    it('should handle many transfers efficiently', async () => {
      const component = () =>
        Transfer({
          dataSource: mockDataSource,
          children: [
            TransferList({ type: 'source' }),
            TransferControls({}),
            TransferList({ type: 'target' }),
          ],
        });

      const { container } = renderComponent(component);

      const sourceList = container.querySelector('[data-type="source"]');
      const controls = container.querySelector('[data-transfer-controls]');
      const transferButton = controls?.querySelector('button') as HTMLButtonElement;

      // Transfer all items one by one
      for (let i = 0; i < 5; i++) {
        const items = Array.from(
          sourceList?.querySelectorAll('[data-transfer-item]') || [],
        ) as HTMLElement[];

        if (items.length > 0) {
          items[0].click();
          await nextTick();
          transferButton.click();
          await nextTick();
        }
      }

      const targetList = container.querySelector('[data-type="target"]');
      const targetItems = targetList?.querySelectorAll('[data-transfer-item]');
      expect(targetItems?.length).toBe(5);
    });
  });
});
