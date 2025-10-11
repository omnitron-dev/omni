### Masonry

Pinterest-style masonry grid layout for displaying items of varying heights.

#### Features

- Multi-column layout
- Auto-positioned items
- Configurable columns and gap
- Responsive column count
- Auto-height calculation
- Resize observer integration
- Smooth animations

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Masonry } from 'aether/primitives';

const Example239 = defineComponent(() => {
  const items = signal([
    { id: 1, content: 'Short item', height: 200 },
    { id: 2, content: 'Medium item', height: 300 },
    { id: 3, content: 'Tall item', height: 400 },
    { id: 4, content: 'Short item', height: 180 },
    // ... more items
  ]);

  return () => (
    <Masonry columns={3} gap={16}>
      <For each={items()}>
        {(item) => (
          <div class="masonry-item" style={{ height: `${item.height}px` }}>
            {item.content}
          </div>
        )}
      </For>
    </Masonry>
  );
});
```

#### Advanced Usage

```typescript
// Responsive masonry grid
const Example240 = defineComponent(() => {
  const photos = signal([
    { id: 1, src: '/photos/1.jpg', caption: 'Beautiful sunset' },
    { id: 2, src: '/photos/2.jpg', caption: 'Mountain view' },
    { id: 3, src: '/photos/3.jpg', caption: 'City lights' },
    // ... more photos
  ]);

  const columns = createMediaQuery({
    '(max-width: 640px)': 1,
    '(max-width: 1024px)': 2,
    '(min-width: 1024px)': 3
  });

  return () => (
    <Masonry columns={columns()} gap={20} class="photo-grid">
      <For each={photos()}>
        {(photo) => (
          <div class="photo-card">
            <img src={photo.src} alt={photo.caption} />
            <div class="photo-caption">{photo.caption}</div>
          </div>
        )}
      </For>
    </Masonry>
  );
});
```

**API:**

**`<Masonry>`** - Masonry grid container
- `columns: number` - Number of columns
- `gap?: number` - Gap between items in pixels (default: 16)

---

