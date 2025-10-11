### Rating

A star rating component with support for half-star ratings, hover preview, and keyboard navigation.

#### Features

- Full and half-star rating support
- Hover preview functionality
- Keyboard navigation (arrows, Home, End)
- Controlled and uncontrolled modes
- Read-only mode for display
- Custom max rating
- ARIA radio group pattern
- Fractional values (0.5 increments)

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Rating } from 'aether/primitives';

const Example = defineComponent(() => {
  const rating = signal(3.5);

  return () => (
    <div>
      <Rating value={rating()} onValueChange={rating} max={5} allowHalf>
        <Rating.Item index={1} class="rating-star">★</Rating.Item>
        <Rating.Item index={2} class="rating-star">★</Rating.Item>
        <Rating.Item index={3} class="rating-star">★</Rating.Item>
        <Rating.Item index={4} class="rating-star">★</Rating.Item>
        <Rating.Item index={5} class="rating-star">★</Rating.Item>
      </Rating>

      <p>Rating: {rating()}/5</p>
    </div>
  );
});
```

#### Read-only Display

```typescript
const Example = defineComponent(() => {
  return () => (
    <Rating value={4.5} max={5} allowHalf readonly>
      <Rating.Item index={1}>★</Rating.Item>
      <Rating.Item index={2}>★</Rating.Item>
      <Rating.Item index={3}>★</Rating.Item>
      <Rating.Item index={4}>★</Rating.Item>
      <Rating.Item index={5}>★</Rating.Item>
    </Rating>
  );
});
```

#### API

**`<Rating>`** - Root component
- `value?: number` - Controlled rating value
- `onValueChange?: (value: number) => void` - Value change callback
- `defaultValue?: number` - Default rating value (uncontrolled)
- `max?: number` - Maximum rating (default: 5)
- `allowHalf?: boolean` - Allow half-star ratings (default: false)
- `readonly?: boolean` - Read-only mode (default: false)

**`<Rating.Item>`** - Individual rating item (star)
- `index: number` - Star index (1-based)

---

