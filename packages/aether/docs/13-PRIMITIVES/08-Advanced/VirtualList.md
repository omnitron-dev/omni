### VirtualList

Virtualized list for efficiently rendering large datasets by only rendering visible items.

#### Features

- Window/scroll virtualization for performance
- Dynamic item heights support
- Overscan for smooth scrolling
- Horizontal and vertical scrolling
- Scroll to index/offset
- Infinite scroll support
- Item measurement and caching
- ARIA support

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { VirtualList } from 'aether/primitives';

const Example224 = defineComponent(() => {
  const items = signal(Array.from({ length: 10000 }, (_, i) => ({
    id: i,
    title: `Item ${i}`,
    description: `Description for item ${i}`
  })));

  return () => (
    <VirtualList
      count={items().length}
      height={600}
      itemSize={80}
      overscan={5}
    >
      {(index) => {
        const item = items()[index];
        return (
          <div class="virtual-item">
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </div>
        );
      }}
    </VirtualList>
  );
});
```

#### Advanced Usage - Dynamic Heights

```typescript
// Variable height items
const Example225 = defineComponent(() => {
  const items = signal(generateLargeDataset(10000));

  const getItemSize = (index: number) => {
    const item = items()[index];
    // Estimate height based on content
    return item.description.length > 100 ? 120 : 80;
  };

  return () => (
    <VirtualList
      count={items().length}
      height="100vh"
      itemSize={getItemSize}
      overscan={3}
      direction="vertical"
    >
      {(index) => {
        const item = items()[index];
        return (
          <div class="dynamic-item">
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <Show when={item.tags}>
              <div class="tags">
                <For each={item.tags}>
                  {(tag) => <span class="tag">{tag}</span>}
                </For>
              </div>
            </Show>
          </div>
        );
      }}
    </VirtualList>
  );
});
```

**API:**

**`<VirtualList>`** - Virtual list container
- `count: number` - Total number of items
- `children: (index: number) => any` - Item renderer function
- `height?: number | string` - Container height (required for vertical)
- `width?: number | string` - Container width (required for horizontal)
- `itemSize: number | ((index: number) => number)` - Fixed size or estimator function
- `overscan?: number` - Items to render outside viewport (default: 3)
- `direction?: 'vertical' | 'horizontal'` - Scroll direction (default: 'vertical')
- `scrollToIndex?: number` - Scroll to specific index
- `scrollBehavior?: ScrollBehavior` - Scroll behavior
- `onScroll?: (scrollOffset: number) => void` - Scroll callback

---

