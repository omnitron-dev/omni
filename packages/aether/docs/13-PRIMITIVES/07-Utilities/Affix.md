### Affix

Sticky/fixed positioning component that affixes an element when scrolling.

#### Features

- Auto-affix on scroll
- Configurable offset (top/bottom)
- Scroll event handling
- Position change callbacks
- Smooth transitions
- Window and container scrolling support

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Affix } from 'aether/primitives';

const Example233 = defineComponent(() => {
  return () => (
    <Affix offsetTop={20}>
      <div class="sticky-header">
        <h2>Sticky Header</h2>
        <nav>
          <a href="#section1">Section 1</a>
          <a href="#section2">Section 2</a>
          <a href="#section3">Section 3</a>
        </nav>
      </div>
    </Affix>
  );
});
```

#### Advanced Usage

```typescript
// Affix with state change callback
const Example234 = defineComponent(() => {
  const isAffixed = signal(false);

  const handleChange = (affixed: boolean) => {
    isAffixed.set(affixed);
    console.log('Affix state changed:', affixed);
  };

  return () => (
    <>
      <Affix offsetTop={0} onChange={handleChange}>
        <div class={`toolbar ${isAffixed() ? 'affixed' : ''}`}>
          <button>Action 1</button>
          <button>Action 2</button>
          <button>Action 3</button>
        </div>
      </Affix>

      <div class="content">
        {/* Long content that scrolls */}
      </div>
    </>
  );
});
```

**API:**

**`<Affix>`** - Affix container
- `offsetTop?: number` - Offset from top when affixed
- `offsetBottom?: number` - Offset from bottom when affixed
- `onChange?: (affixed: boolean) => void` - Affix state change callback

---

