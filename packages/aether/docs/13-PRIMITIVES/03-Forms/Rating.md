### Rating

An input for displaying and capturing user ratings with stars or custom icons.

#### Features

- Controlled and uncontrolled modes
- Half-star ratings support
- Custom icons (stars, hearts, thumbs, etc.)
- Hover preview effects
- Read-only display mode
- Keyboard navigation (Arrow keys, Home/End)
- Touch support
- Disabled state
- ARIA accessibility

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Rating } from 'aether/primitives';

export const ProductRating = defineComponent(() => {
  const rating = signal(3);

  return () => (
    <div class="rating-container">
      <label>Rate this product:</label>
      <Rating
        bind:value={rating}
        max={5}
        class="rating-root"
      >
        {(index, filled) => (
          <Rating.Item index={index} class="rating-item">
            {filled ? '★' : '☆'}
          </Rating.Item>
        )}
      </Rating>
      <p>Your rating: {rating()} / 5</p>
    </div>
  );
});
```

#### Half-Star Ratings

```typescript
import { defineComponent, signal } from 'aether';
import { Rating } from 'aether/primitives';

export const ReviewRating = defineComponent(() => {
  const rating = signal(3.5);

  return () => (
    <div class="rating-container">
      <label>Overall rating:</label>
      <Rating
        bind:value={rating}
        max={5}
        allowHalf={true}
        class="rating-root"
      >
        {(index, filled) => {
          const isHalfFilled = rating() === index - 0.5;
          return (
            <Rating.Item index={index} class="rating-item">
              {filled ? (
                <span class="star-filled">★</span>
              ) : isHalfFilled ? (
                <span class="star-half">
                  <span class="star-half-filled">★</span>
                  <span class="star-half-empty">★</span>
                </span>
              ) : (
                <span class="star-empty">☆</span>
              )}
            </Rating.Item>
          );
        }}
      </Rating>
      <p>{rating()} stars</p>
    </div>
  );
});
```

#### Read-Only Display

```typescript
import { defineComponent } from 'aether';
import { Rating } from 'aether/primitives';

export const ProductCard = defineComponent((props: { rating: number; reviews: number }) => {
  return () => (
    <div class="product-card">
      <h3>Product Name</h3>
      <div class="rating-display">
        <Rating
          value={props.rating}
          max={5}
          readOnly={true}
          allowHalf={true}
          class="rating-root rating-readonly"
        >
          {(index, filled) => (
            <Rating.Item index={index} class="rating-item">
              {filled ? '★' : '☆'}
            </Rating.Item>
          )}
        </Rating>
        <span class="rating-text">
          {props.rating} ({props.reviews} reviews)
        </span>
      </div>
    </div>
  );
});
```

#### Custom Icons - Hearts

```typescript
import { defineComponent, signal } from 'aether';
import { Rating } from 'aether/primitives';

export const FavoriteRating = defineComponent(() => {
  const favorite = signal(4);

  return () => (
    <div class="rating-container">
      <label>How much do you like this?</label>
      <Rating
        bind:value={favorite}
        max={5}
        class="rating-root rating-hearts"
      >
        {(index, filled) => (
          <Rating.Item index={index} class="rating-item">
            {filled ? '❤️' : '🤍'}
          </Rating.Item>
        )}
      </Rating>
    </div>
  );
});
```

#### Custom Icons - Thumbs Up

```typescript
import { defineComponent, signal } from 'aether';
import { Rating } from 'aether/primitives';

export const QualityRating = defineComponent(() => {
  const quality = signal(3);

  const getIcon = (index: number, filled: boolean) => {
    if (quality() >= index) {
      return '👍';
    }
    return '👎';
  };

  return () => (
    <div class="rating-container">
      <label>Quality rating:</label>
      <Rating
        bind:value={quality}
        max={5}
        class="rating-root rating-thumbs"
      >
        {(index, filled) => (
          <Rating.Item index={index} class="rating-item">
            {getIcon(index, filled)}
          </Rating.Item>
        )}
      </Rating>
    </div>
  );
});
```

#### Controlled Mode with Callback

```typescript
import { defineComponent, signal } from 'aether';
import { Rating } from 'aether/primitives';

export const FeedbackRating = defineComponent(() => {
  const rating = signal(0);
  const submitted = signal(false);

  const handleRatingChange = (value: number) => {
    rating.set(value);
    submitted.set(false);
  };

  const submitFeedback = () => {
    console.log('Submitting rating:', rating());
    submitted.set(true);
  };

  return () => (
    <div class="feedback-form">
      <h3>Rate your experience</h3>
      <Rating
        value={rating()}
        onValueChange={handleRatingChange}
        max={5}
        class="rating-root"
      >
        {(index, filled) => (
          <Rating.Item index={index} class="rating-item">
            {filled ? '★' : '☆'}
          </Rating.Item>
        )}
      </Rating>
      <button
        onClick={submitFeedback}
        disabled={rating() === 0}
        class="submit-button"
      >
        Submit Feedback
      </button>
      {submitted() && <p class="success">Thank you for your feedback!</p>}
    </div>
  );
});
```

#### Uncontrolled Mode

```typescript
import { defineComponent } from 'aether';
import { Rating } from 'aether/primitives';

export const SimpleRating = defineComponent(() => {
  const handleChange = (value: number) => {
    console.log('Rating changed to:', value);
  };

  return () => (
    <Rating
      defaultValue={3}
      onValueChange={handleChange}
      max={5}
      class="rating-root"
    >
      {(index, filled) => (
        <Rating.Item index={index} class="rating-item">
          {filled ? '★' : '☆'}
        </Rating.Item>
      )}
    </Rating>
  );
});
```

#### Disabled State

```typescript
import { defineComponent } from 'aether';
import { Rating } from 'aether/primitives';

export const DisabledRating = defineComponent(() => {
  return () => (
    <div class="rating-container">
      <label>Rating (coming soon):</label>
      <Rating
        value={0}
        max={5}
        disabled={true}
        class="rating-root"
      >
        {(index, filled) => (
          <Rating.Item index={index} class="rating-item">
            {filled ? '★' : '☆'}
          </Rating.Item>
        )}
      </Rating>
    </div>
  );
});
```

#### Styling Example

```css
.rating-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.rating-root {
  display: inline-flex;
  gap: var(--spacing-1);
  padding: var(--spacing-1);

  outline: none;
}

.rating-root:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-100);
  border-radius: var(--radius-sm);
}

.rating-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  font-size: 24px;
  cursor: pointer;

  transition: transform var(--transition-fast);
  user-select: none;
}

.rating-item:hover {
  transform: scale(1.1);
}

.rating-item[data-filled] {
  color: var(--color-warning-500);
}

.rating-item:not([data-filled]) {
  color: var(--color-border);
}

/* Half-star support */
.star-half {
  position: relative;
  display: inline-block;
}

.star-half-filled {
  position: absolute;
  top: 0;
  left: 0;
  width: 50%;
  overflow: hidden;
  color: var(--color-warning-500);
}

.star-half-empty {
  color: var(--color-border);
}

/* Read-only state */
.rating-readonly .rating-item {
  cursor: default;
}

.rating-readonly .rating-item:hover {
  transform: none;
}

/* Disabled state */
.rating-root[data-disabled] {
  opacity: 0.5;
}

.rating-root[data-disabled] .rating-item {
  cursor: not-allowed;
}

.rating-root[data-disabled] .rating-item:hover {
  transform: none;
}

/* Hearts variant */
.rating-hearts .rating-item {
  font-size: 28px;
}

.rating-hearts .rating-item[data-filled] {
  animation: heartBeat 0.3s ease;
}

@keyframes heartBeat {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.2);
  }
}

/* Thumbs variant */
.rating-thumbs .rating-item {
  font-size: 20px;
}

/* Large size variant */
.rating-large .rating-item {
  font-size: 32px;
}

/* Small size variant */
.rating-small .rating-item {
  font-size: 16px;
}
```

#### API Reference

**`<Rating>`** - Root component

Props:
- `value?: number` - Controlled rating value
- `defaultValue?: number` - Initial value (uncontrolled)
- `onValueChange?: (value: number) => void` - Callback when rating changes
- `max?: number` - Maximum rating (default: 5)
- `allowHalf?: boolean` - Enable half-star ratings (default: false)
- `readOnly?: boolean` - Display-only mode (default: false)
- `disabled?: boolean` - Disabled state (default: false)
- `children?: ((index: number, filled: boolean) => any) | any` - Render function or static content

Attributes:
- `data-rating` - Present on root
- `data-readonly` - Present when read-only
- `data-disabled` - Present when disabled
- `role="slider"` - ARIA role
- `aria-valuenow` - Current value
- `aria-valuemin` - Minimum value (0)
- `aria-valuemax` - Maximum value
- `aria-readonly` - Read-only state
- `aria-disabled` - Disabled state
- `tabIndex={0}` - Keyboard focusable (when not read-only/disabled)

**`<Rating.Item>`** - Individual rating item

Props:
- `index: number` - Item position (1-based)
- `children?: any` - Icon or content to display

Attributes:
- `data-rating-item` - Present on item
- `data-index` - Item index
- `data-filled` - Present when item is filled
- `data-half-filled` - Present when item is half-filled

#### Keyboard Navigation

When focused, the Rating component supports:

- **Arrow Right / Arrow Up** - Increase rating by one step (0.5 or 1)
- **Arrow Left / Arrow Down** - Decrease rating by one step (0.5 or 1)
- **Home** - Set rating to 0
- **End** - Set rating to maximum
- **Tab** - Move focus away from rating

Notes:
- Keyboard navigation respects the `allowHalf` setting
- Read-only and disabled ratings are not keyboard navigable
- The root element receives focus, not individual items

#### Mouse/Touch Interaction

- **Click** - Set rating to clicked value
- **Click (left half)** - Set to half value when `allowHalf={true}`
- **Hover** - Preview rating before clicking
- **Mouse leave** - Clear hover preview

#### Accessibility Features

1. **ARIA Attributes**:
   - Uses `role="slider"` for proper screen reader announcement
   - Provides `aria-valuenow`, `aria-valuemin`, `aria-valuemax`
   - Includes `aria-label="Rating"` for context
   - Sets `aria-readonly` and `aria-disabled` appropriately

2. **Keyboard Support**:
   - Full keyboard navigation with arrow keys
   - Home/End keys for quick min/max values
   - Focusable with visible focus indicator

3. **Screen Reader Support**:
   - Announces current rating value
   - Announces changes as user navigates
   - Clearly indicates read-only and disabled states

4. **Visual Feedback**:
   - Hover effects show preview
   - Focus indicators for keyboard users
   - Clear filled/unfilled states
   - Support for custom icons and colors

#### Form Integration

The Rating component integrates with forms naturally:

```typescript
import { defineComponent, signal } from 'aether';
import { Rating } from 'aether/primitives';

export const ReviewForm = defineComponent(() => {
  const rating = signal(0);
  const comment = signal('');

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    console.log('Submit:', { rating: rating(), comment: comment() });
  };

  return () => (
    <form onSubmit={handleSubmit} class="review-form">
      <div class="form-field">
        <label>Rating *</label>
        <Rating
          bind:value={rating}
          max={5}
          class="rating-root"
        >
          {(index, filled) => (
            <Rating.Item index={index} class="rating-item">
              {filled ? '★' : '☆'}
            </Rating.Item>
          )}
        </Rating>
        {rating() === 0 && (
          <span class="error">Please select a rating</span>
        )}
      </div>

      <div class="form-field">
        <label for="comment">Comment</label>
        <textarea
          id="comment"
          bind:value={comment}
          placeholder="Tell us more..."
          class="textarea"
        />
      </div>

      <button type="submit" disabled={rating() === 0}>
        Submit Review
      </button>
    </form>
  );
});
```

#### Advanced: Custom Rendering with SVG Icons

```typescript
import { defineComponent, signal } from 'aether';
import { Rating } from 'aether/primitives';

const StarIcon = ({ filled }: { filled: boolean }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    stroke-width="2"
  >
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

export const SvgRating = defineComponent(() => {
  const rating = signal(4);

  return () => (
    <Rating
      bind:value={rating}
      max={5}
      class="rating-root rating-svg"
    >
      {(index, filled) => (
        <Rating.Item index={index} class="rating-item">
          <StarIcon filled={filled} />
        </Rating.Item>
      )}
    </Rating>
  );
});
```

```css
.rating-svg .rating-item {
  color: var(--color-warning-500);
}

.rating-svg .rating-item:not([data-filled]) {
  color: var(--color-border);
}
```

#### Best Practices

1. **Choose Appropriate Maximum**:
   - 5 stars: Standard for most ratings (products, services)
   - 10 stars: More granular feedback
   - 3-4 stars: Simple satisfaction scales

2. **Half-Star Usage**:
   - Enable for display of aggregate ratings (e.g., 4.5 average)
   - Consider disabling for user input (simpler interaction)
   - Use hover detection to show which half will be selected

3. **Icon Selection**:
   - Stars: Universal, works for most rating scenarios
   - Hearts: Favorites, likes, emotional responses
   - Thumbs: Quality, approval ratings
   - Custom: Match your brand and context

4. **Read-Only Display**:
   - Use for showing existing ratings (product pages, reviews)
   - Combine with review count for context
   - Consider showing average of multiple ratings

5. **Labels and Context**:
   - Always provide a label explaining what is being rated
   - Show the current value numerically for clarity
   - Consider showing what each level means (1="Poor", 5="Excellent")

6. **Validation**:
   - Mark as required in forms if needed
   - Show validation errors clearly
   - Consider requiring ratings before form submission

7. **Mobile Considerations**:
   - Ensure touch targets are large enough (min 44x44px)
   - Half-star selection may be difficult on mobile
   - Consider disabling allowHalf for touch devices

8. **Performance**:
   - Render function is called for each item
   - Keep icon rendering lightweight
   - Consider memoizing expensive icon components

#### Comparison with Similar Controls

**Rating vs Slider**:
- Rating: Discrete values, visual metaphor (stars), common for feedback
- Slider: Continuous or discrete range, better for numeric values
- Use Rating for: Reviews, satisfaction scores, quality ratings
- Use Slider for: Volume, brightness, price ranges, percentages

**Rating vs Radio Group**:
- Rating: Visual, compact, hover preview
- Radio Group: Text labels, more descriptive options
- Use Rating for: Numeric scales (1-5), universal rating patterns
- Use Radio Group for: Named options ("Poor", "Good", "Excellent")

**Rating vs Toggle Group**:
- Rating: Sequential selection, single axis
- Toggle Group: Independent categories, can be multi-select
- Use Rating for: Single dimensional feedback
- Use Toggle Group for: Multiple choice, filtering, preferences

---
