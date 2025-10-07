# Animation Patterns

> CSS-based animations with Aether's reactive system

## Table of Contents

1. [Fade Transitions](#fade-transitions)
2. [Slide Animations](#slide-animations)
3. [List Transitions](#list-transitions)
4. [Scale Animations](#scale-animations)
5. [Gesture Animations](#gesture-animations)
6. [Complex Transitions](#complex-transitions)

---

## Fade Transitions

### Pattern: Simple Fade In/Out

```typescript
import { defineComponent, Show } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

const FadeExample = defineComponent(() => {
  const isVisible = signal(true);

  return () => (
    <div>
      <button onClick={() => isVisible.set(!isVisible())}>
        Toggle
      </button>

      <Show when={isVisible()}>
        <div
          className="fade-in"
          style={{
            animation: 'fadeIn 0.3s ease-in',
          }}
        >
          <p>This content fades in!</p>
        </div>
      </Show>
    </div>
  );
});
```

**CSS**:
```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}
```

### Pattern: Controlled Fade with Transition

```typescript
import { defineComponent } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

const ControlledFadeExample = defineComponent(() => {
  const opacity = signal(1);

  const fadeOut = () => {
    opacity.set(0);
  };

  const fadeIn = () => {
    opacity.set(1);
  };

  return () => (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={fadeIn}>Fade In</button>
        <button onClick={fadeOut}>Fade Out</button>
      </div>

      <div
        style={{
          opacity: opacity(),
          transition: 'opacity 0.5s ease-in-out',
          padding: '1rem',
          backgroundColor: '#f0f0f0',
        }}
      >
        <p>This content's opacity is controlled!</p>
      </div>
    </div>
  );
});
```

**Key Points**:
- Use `Show` for mount/unmount with CSS animation
- Use `signal` + `transition` CSS for smooth opacity changes
- `animation` for keyframe-based effects
- `transition` for property-based effects

---

## Slide Animations

### Pattern: Slide In from Side

```typescript
import { defineComponent, Show } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

type SlideDirection = 'left' | 'right' | 'top' | 'bottom';

const SlideExample = defineComponent(() => {
  const isVisible = signal(false);
  const direction = signal<SlideDirection>('right');

  const animationName = () => {
    return `slideIn${direction().charAt(0).toUpperCase() + direction().slice(1)}`;
  };

  return () => (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={() => isVisible.set(!isVisible())}>
          Toggle
        </button>
        <select
          value={direction()}
          onChange={(e) => direction.set((e.target as HTMLSelectElement).value as SlideDirection)}
        >
          <option value="left">From Left</option>
          <option value="right">From Right</option>
          <option value="top">From Top</option>
          <option value="bottom">From Bottom</option>
        </select>
      </div>

      <Show when={isVisible()}>
        <div
          style={{
            animation: `${animationName()} 0.3s ease-out`,
            padding: '1rem',
            backgroundColor: '#e0f2fe',
            border: '1px solid #0ea5e9',
            borderRadius: '0.25rem',
          }}
        >
          <p>Sliding in from {direction()}!</p>
        </div>
      </Show>
    </div>
  );
});
```

**CSS**:
```css
@keyframes slideInLeft {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes slideInRight {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes slideInTop {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes slideInBottom {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
```

### Pattern: Drawer with Transform

```typescript
import { defineComponent } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

const DrawerExample = defineComponent(() => {
  const isOpen = signal(false);

  return () => (
    <div>
      <button onClick={() => isOpen.set(!isOpen())}>
        {isOpen() ? 'Close' : 'Open'} Drawer
      </button>

      {/* Overlay */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          opacity: isOpen() ? 1 : 0,
          pointerEvents: isOpen() ? 'auto' : 'none',
          transition: 'opacity 0.3s ease-in-out',
          zIndex: 1000,
        }}
        onClick={() => isOpen.set(false)}
      />

      {/* Drawer */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '300px',
          backgroundColor: 'white',
          boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.1)',
          transform: isOpen() ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s ease-in-out',
          zIndex: 1001,
          padding: '2rem',
        }}
      >
        <h2 style={{ marginTop: 0 }}>Drawer Content</h2>
        <p>This is a sliding drawer!</p>
        <button onClick={() => isOpen.set(false)}>Close</button>
      </div>
    </div>
  );
});
```

**Key Points**:
- Use `transform` for GPU-accelerated animations
- Combine with `opacity` for smooth transitions
- Use `pointerEvents: 'none'` for hidden overlays
- `transition` for smooth state changes

---

## List Transitions

### Pattern: Animated List with Stagger

```typescript
import { defineComponent, For } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

interface Item {
  id: string;
  text: string;
  addedAt: number;
}

const ListTransitionExample = defineComponent(() => {
  const items = signal<Item[]>([
    { id: '1', text: 'Item 1', addedAt: Date.now() },
    { id: '2', text: 'Item 2', addedAt: Date.now() },
  ]);

  const addItem = () => {
    const newItem: Item = {
      id: crypto.randomUUID(),
      text: `Item ${items().length + 1}`,
      addedAt: Date.now(),
    };
    items.set([...items(), newItem]);
  };

  const removeItem = (id: string) => {
    items.set(items().filter((item) => item.id !== id));
  };

  return () => (
    <div>
      <button
        onClick={addItem}
        style={{
          marginBottom: '1rem',
          padding: '0.5rem 1rem',
          backgroundColor: '#10b981',
          color: 'white',
          border: 'none',
          borderRadius: '0.25rem',
          cursor: 'pointer',
        }}
      >
        Add Item
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <For each={items()}>
          {(item, index) => (
            <div
              key={item.id}
              style={{
                padding: '1rem',
                backgroundColor: '#f3f4f6',
                borderRadius: '0.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                animation: 'slideInLeft 0.3s ease-out',
                animationDelay: `${index() * 0.05}s`,
                animationFillMode: 'backwards',
              }}
            >
              <span>{item.text}</span>
              <button
                onClick={() => removeItem(item.id)}
                style={{
                  padding: '0.25rem 0.5rem',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.25rem',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                Remove
              </button>
            </div>
          )}
        </For>
      </div>
    </div>
  );
});
```

**CSS**:
```css
@keyframes slideInLeft {
  from {
    transform: translateX(-20px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
```

### Pattern: Fade and Scale on Add/Remove

```typescript
import { defineComponent, For } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

const FadeScaleListExample = defineComponent(() => {
  const items = signal<string[]>(['Alpha', 'Beta', 'Gamma']);

  const addItem = () => {
    const letters = ['Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
    const random = letters[Math.floor(Math.random() * letters.length)];
    items.set([...items(), random]);
  };

  const removeItem = (index: number) => {
    items.set(items().filter((_, i) => i !== index));
  };

  return () => (
    <div>
      <button
        onClick={addItem}
        style={{
          marginBottom: '1rem',
          padding: '0.5rem 1rem',
          backgroundColor: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '0.25rem',
          cursor: 'pointer',
        }}
      >
        Add Item
      </button>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: '1rem',
        }}
      >
        <For each={items()}>
          {(item, index) => (
            <div
              key={item + index()}
              style={{
                padding: '1rem',
                backgroundColor: '#dbeafe',
                border: '2px solid #3b82f6',
                borderRadius: '0.5rem',
                textAlign: 'center',
                cursor: 'pointer',
                animation: 'fadeScaleIn 0.3s ease-out',
              }}
              onClick={() => removeItem(index())}
            >
              <div style={{ fontWeight: 'bold' }}>{item}</div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                Click to remove
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
});
```

**CSS**:
```css
@keyframes fadeScaleIn {
  from {
    transform: scale(0.8);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
```

**Key Points**:
- Use `animation-delay` for staggered effects
- `animationFillMode: 'backwards'` to apply initial keyframe before animation starts
- Combine `transform: scale()` with `opacity` for smooth appearance
- Grid layout with `auto-fill` for responsive item placement

---

## Scale Animations

### Pattern: Button Press Effect

```typescript
import { defineComponent } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

const ScaleButtonExample = defineComponent(() => {
  const isPressed = signal(false);
  const count = signal(0);

  const handleClick = () => {
    isPressed.set(true);
    count.set(count() + 1);
    setTimeout(() => isPressed.set(false), 150);
  };

  return () => (
    <button
      onClick={handleClick}
      style={{
        padding: '1rem 2rem',
        fontSize: '1.25rem',
        fontWeight: 'bold',
        backgroundColor: '#3b82f6',
        color: 'white',
        border: 'none',
        borderRadius: '0.5rem',
        cursor: 'pointer',
        transform: isPressed() ? 'scale(0.95)' : 'scale(1)',
        transition: 'transform 0.1s ease-out',
      }}
    >
      Clicked {count()} times
    </button>
  );
});
```

### Pattern: Hover Scale Cards

```typescript
import { defineComponent, For } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

const HoverScaleCards = defineComponent(() => {
  const cards = signal([
    { id: 1, title: 'Card 1', color: '#ef4444' },
    { id: 2, title: 'Card 2', color: '#f59e0b' },
    { id: 3, title: 'Card 3', color: '#10b981' },
    { id: 4, title: 'Card 4', color: '#3b82f6' },
  ]);

  const hoveredCard = signal<number | null>(null);

  return () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '1rem',
      }}
    >
      <For each={cards()}>
        {(card) => (
          <div
            key={card.id}
            onMouseEnter={() => hoveredCard.set(card.id)}
            onMouseLeave={() => hoveredCard.set(null)}
            style={{
              padding: '2rem',
              backgroundColor: card.color,
              color: 'white',
              borderRadius: '0.5rem',
              textAlign: 'center',
              fontWeight: 'bold',
              cursor: 'pointer',
              transform: hoveredCard() === card.id ? 'scale(1.05)' : 'scale(1)',
              boxShadow:
                hoveredCard() === card.id
                  ? '0 10px 25px rgba(0, 0, 0, 0.2)'
                  : '0 4px 6px rgba(0, 0, 0, 0.1)',
              transition: 'transform 0.2s ease-out, box-shadow 0.2s ease-out',
            }}
          >
            {card.title}
          </div>
        )}
      </For>
    </div>
  );
});
```

**Key Points**:
- `scale()` for size transformations
- Short transition durations for responsive feel (100-200ms)
- Combine with `box-shadow` for depth effect
- Use hover signals for interactive scale effects

---

## Gesture Animations

### Pattern: Swipeable Card

```typescript
import { defineComponent } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';
import { swipe } from '@omnitron-dev/aether/utils';

const SwipeCardExample = defineComponent(() => {
  const position = signal(0);
  const isDragging = signal(false);

  const handleSwipe = (direction: 'left' | 'right' | 'up' | 'down', distance: number) => {
    console.log('Swiped', direction, 'with distance', distance);

    if (direction === 'left' && distance > 100) {
      // Swipe left - animate out
      position.set(-400);
      setTimeout(() => {
        alert('Card dismissed left!');
        position.set(0);
      }, 300);
    } else if (direction === 'right' && distance > 100) {
      // Swipe right - animate out
      position.set(400);
      setTimeout(() => {
        alert('Card dismissed right!');
        position.set(0);
      }, 300);
    } else {
      // Not enough distance - spring back
      position.set(0);
    }
  };

  return () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '400px',
        overflow: 'hidden',
      }}
    >
      <div
        ref={swipe({
          onSwipe: handleSwipe,
          threshold: 50,
        })}
        style={{
          width: '300px',
          padding: '2rem',
          backgroundColor: '#dbeafe',
          border: '2px solid #3b82f6',
          borderRadius: '1rem',
          textAlign: 'center',
          cursor: 'grab',
          transform: `translateX(${position()}px) rotate(${position() / 20}deg)`,
          transition: isDragging() ? 'none' : 'transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>Swipeable Card</h3>
        <p>Swipe left or right to dismiss!</p>
        <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
          (Swipe at least 100px)
        </p>
      </div>
    </div>
  );
});
```

### Pattern: Draggable Element

```typescript
import { defineComponent } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

const DraggableExample = defineComponent(() => {
  const position = signal({ x: 0, y: 0 });
  const isDragging = signal(false);
  const dragStart = signal({ x: 0, y: 0 });

  const handleMouseDown = (e: MouseEvent) => {
    isDragging.set(true);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragStart.set({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging()) return;
    position.set({
      x: e.clientX - dragStart().x,
      y: e.clientY - dragStart().y,
    });
  };

  const handleMouseUp = () => {
    isDragging.set(false);
  };

  // Add global listeners
  if (typeof window !== 'undefined') {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  return () => (
    <div
      style={{
        position: 'relative',
        height: '400px',
        border: '2px dashed #e5e7eb',
        borderRadius: '0.5rem',
      }}
    >
      <div
        onMouseDown={handleMouseDown}
        style={{
          position: 'absolute',
          left: `${position().x}px`,
          top: `${position().y}px`,
          width: '120px',
          height: '120px',
          backgroundColor: '#f59e0b',
          borderRadius: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isDragging() ? 'grabbing' : 'grab',
          userSelect: 'none',
          boxShadow: isDragging()
            ? '0 10px 25px rgba(0, 0, 0, 0.2)'
            : '0 4px 6px rgba(0, 0, 0, 0.1)',
          transform: isDragging() ? 'scale(1.05)' : 'scale(1)',
          transition: isDragging() ? 'none' : 'transform 0.2s, box-shadow 0.2s',
        }}
      >
        <span style={{ color: 'white', fontWeight: 'bold' }}>Drag me!</span>
      </div>
    </div>
  );
});
```

**Key Points**:
- Use `swipe` directive for swipe gestures
- Manual drag with mouse events for fine control
- `cursor: grab/grabbing` for visual feedback
- Disable transitions during drag for immediate response
- Spring-back animation with `cubic-bezier` easing

---

## Complex Transitions

### Pattern: Modal with Backdrop Animation

```typescript
import { defineComponent, Portal, Show } from '@omnitron-dev/aether';
import { signal } from '@omnitron-dev/aether/reactivity';

const AnimatedModalExample = defineComponent(() => {
  const isOpen = signal(false);
  const isAnimatingOut = signal(false);

  const closeModal = () => {
    isAnimatingOut.set(true);
    setTimeout(() => {
      isOpen.set(false);
      isAnimatingOut.set(false);
    }, 300);
  };

  return () => (
    <div>
      <button onClick={() => isOpen.set(true)}>Open Modal</button>

      <Show when={isOpen()}>
        <Portal>
          {/* Backdrop */}
          <div
            onClick={closeModal}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              animation: isAnimatingOut() ? 'fadeOut 0.3s ease-out' : 'fadeIn 0.3s ease-in',
              zIndex: 1000,
            }}
          />

          {/* Modal */}
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '90%',
              maxWidth: '500px',
              backgroundColor: 'white',
              borderRadius: '0.5rem',
              padding: '2rem',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              animation: isAnimatingOut()
                ? 'slideOutDown 0.3s ease-out'
                : 'slideInUp 0.3s ease-out',
              zIndex: 1001,
            }}
          >
            <h2 style={{ marginTop: 0 }}>Animated Modal</h2>
            <p>This modal has entrance and exit animations!</p>
            <button onClick={closeModal}>Close</button>
          </div>
        </Portal>
      </Show>
    </div>
  );
});
```

**CSS**:
```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes slideInUp {
  from {
    transform: translate(-50%, -40%);
    opacity: 0;
  }
  to {
    transform: translate(-50%, -50%);
    opacity: 1;
  }
}

@keyframes slideOutDown {
  from {
    transform: translate(-50%, -50%);
    opacity: 1;
  }
  to {
    transform: translate(-50%, -30%);
    opacity: 0;
  }
}
```

**Key Points**:
- Track `isAnimatingOut` state for exit animations
- Delay unmount until animation completes
- Different animations for enter/exit
- Portal for proper z-index management

---

## Summary

### Animation Techniques

✅ **CSS Animations** - Use `@keyframes` for complex sequences
✅ **CSS Transitions** - Use `transition` for smooth property changes
✅ **Transform** - GPU-accelerated with `translate`, `scale`, `rotate`
✅ **Reactive Values** - Signals control animated properties
✅ **Stagger Effects** - `animation-delay` for sequential animations
✅ **Gesture Support** - Built-in `swipe` and custom drag handlers
✅ **Exit Animations** - Track animation state for proper unmounting

### Best Practices

1. **Use `transform` over `left/top`** - Better performance
2. **Keep durations short** - 200-400ms for most UI animations
3. **Spring easing** - `cubic-bezier(0.68, -0.55, 0.265, 1.55)` for bounce
4. **Disable during interaction** - Set `transition: 'none'` while dragging
5. **Combine animations** - Multiple properties for richer effects
6. **Test on mobile** - Ensure touch gestures work smoothly

All patterns use standard CSS and Aether's reactive system - no external animation libraries needed!
