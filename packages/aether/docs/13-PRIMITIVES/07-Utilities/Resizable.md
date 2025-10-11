### Resizable

Split panes with draggable resize handles for flexible layouts.

#### Features

- Horizontal and vertical split layouts
- Draggable resize handles
- Min/max size constraints
- Controlled and uncontrolled modes
- Multiple panels support
- Keyboard accessible
- Touch-friendly

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Resizable } from 'aether/primitives';

const Example222 = defineComponent(() => {
  return () => (
    <Resizable orientation="horizontal" defaultSizes={[50, 50]}>
      <Resizable.Panel minSize={20} maxSize={80}>
        <div class="panel-content">Left Panel</div>
      </Resizable.Panel>

      <Resizable.Handle />

      <Resizable.Panel>
        <div class="panel-content">Right Panel</div>
      </Resizable.Panel>
    </Resizable>
  );
});
```

#### Advanced Usage

```typescript
// Controlled mode with size persistence
const Example223 = defineComponent(() => {
  const sizes = signal([30, 70]);

  const handleSizesChange = (newSizes: number[]) => {
    sizes.set(newSizes);
    localStorage.setItem('panel-sizes', JSON.stringify(newSizes));
  };

  return () => (
    <Resizable
      orientation="vertical"
      sizes={sizes()}
      onSizesChange={handleSizesChange}
    >
      <Resizable.Panel id="header" minSize={10}>
        <header>Header Content</header>
      </Resizable.Panel>

      <Resizable.Handle />

      <Resizable.Panel id="main">
        <main>Main Content</main>
      </Resizable.Panel>

      <Resizable.Handle />

      <Resizable.Panel id="footer" minSize={10} maxSize={30}>
        <footer>Footer Content</footer>
      </Resizable.Panel>
    </Resizable>
  );
});
```

**API:**

**`<Resizable>`** - Root container
- `sizes?: number[]` - Controlled panel sizes (percentages)
- `onSizesChange?: (sizes: number[]) => void` - Size change callback
- `defaultSizes?: number[]` - Initial sizes (uncontrolled)
- `orientation?: 'horizontal' | 'vertical'` - Layout direction (default: 'horizontal')

**`<Resizable.Panel>`** - Resizable panel
- `id?: string` - Panel identifier
- `minSize?: number` - Minimum size percentage
- `maxSize?: number` - Maximum size percentage

**`<Resizable.Handle>`** - Draggable resize handle
- `disabled?: boolean` - Disable resizing

---

