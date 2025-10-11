### Transfer

Transfer items between two lists with selection, search, and bi-directional transfer.

#### Features

- Dual list box pattern
- Item selection and transfer
- Search/filter support
- Bi-directional transfer
- Custom item rendering
- Batch transfer
- Keyboard navigation
- ARIA support

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Transfer } from 'aether/primitives';

const Example231 = defineComponent(() => {
  const dataSource = [
    { key: '1', title: 'Item 1', description: 'Description 1' },
    { key: '2', title: 'Item 2', description: 'Description 2' },
    { key: '3', title: 'Item 3', description: 'Description 3' },
    { key: '4', title: 'Item 4', description: 'Description 4' },
  ];

  const targetKeys = signal(['2']);

  return () => (
    <Transfer
      dataSource={dataSource}
      targetKeys={targetKeys()}
      onTargetKeysChange={(keys) => targetKeys.set(keys)}
      render={(item) => item.title}
    />
  );
});
```

#### Advanced Usage

```typescript
// With search and custom rendering
const Example232 = defineComponent(() => {
  const allItems = signal([
    { key: '1', title: 'Document.pdf', size: '2.4 MB', type: 'pdf' },
    { key: '2', title: 'Image.png', size: '1.2 MB', type: 'image' },
    { key: '3', title: 'Video.mp4', size: '15.8 MB', type: 'video' },
  ]);

  const selectedKeys = signal([]);

  const renderItem = (item) => (
    <div class="transfer-item">
      <div class="item-icon">{getFileIcon(item.type)}</div>
      <div class="item-details">
        <div class="item-title">{item.title}</div>
        <div class="item-meta">{item.size}</div>
      </div>
    </div>
  );

  const handleChange = (newTargetKeys) => {
    selectedKeys.set(newTargetKeys);
    console.log('Selected items:', newTargetKeys);
  };

  return () => (
    <Transfer
      dataSource={allItems()}
      targetKeys={selectedKeys()}
      onTargetKeysChange={handleChange}
      render={renderItem}
      showSearch={true}
      filterOption={(inputValue, item) =>
        item.title.toLowerCase().includes(inputValue.toLowerCase())
      }
      titles={['Available Files', 'Selected Files']}
    />
  );
});
```

**API:**

**`<Transfer>`** - Root container
- `dataSource: TransferItem[]` - All available items
- `targetKeys?: string[]` - Controlled selected keys
- `onTargetKeysChange?: (keys: string[]) => void` - Selection callback
- `defaultTargetKeys?: string[]` - Initial selection (uncontrolled)
- `render: (item: TransferItem) => any` - Item renderer
- `showSearch?: boolean` - Show search inputs
- `filterOption?: (inputValue: string, item: TransferItem) => boolean` - Custom filter
- `titles?: [string, string]` - List titles

**`<Transfer.Source>`** - Source list container

**`<Transfer.Target>`** - Target list container

**`<Transfer.Controls>`** - Transfer control buttons

---

