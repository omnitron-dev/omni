### Slider

An input for selecting a value from a range.

#### Features

- Single and range sliders
- Keyboard navigation (Arrow keys, Page Up/Down, Home/End)
- Touch support
- Vertical/horizontal orientation
- Step increments
- Min/max values
- Disabled state

#### Basic Usage (Single Value)

```typescript
import { defineComponent, signal } from 'aether';
import { Slider } from 'aether/primitives';

export const VolumeSlider = defineComponent(() => {
  const volume = signal(50);

  return () => (
    <div class="slider-container">
      <label for="volume">Volume: {volume()}%</label>
      <Slider
        bind:value={volume}
        min={0}
        max={100}
        step={1}
        id="volume"
        class="slider-root"
      >
        <Slider.Track class="slider-track">
          <Slider.Range class="slider-range" />
        </Slider.Track>
        <Slider.Thumb class="slider-thumb" />
      </Slider>
    </div>
  );
});
```

#### Range Slider (Two Values)

```typescript
import { defineComponent, signal } from 'aether';
import { Slider } from 'aether/primitives';

export const PriceRangeSlider = defineComponent(() => {
  const priceRange = signal([20, 80]);

  return () => (
    <div class="slider-container">
      <label>
        Price Range: ${priceRange()[0]} - ${priceRange()[1]}
      </label>
      <Slider
        bind:value={priceRange}
        min={0}
        max={100}
        step={5}
        class="slider-root"
      >
        <Slider.Track class="slider-track">
          <Slider.Range class="slider-range" />
        </Slider.Track>
        <Slider.Thumb class="slider-thumb" />
        <Slider.Thumb class="slider-thumb" />
      </Slider>
    </div>
  );
});
```

#### Styling Example

```css
.slider-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.slider-root {
  position: relative;
  display: flex;
  align-items: center;

  width: 100%;
  height: 20px;

  touch-action: none;
  user-select: none;
}

.slider-track {
  position: relative;
  flex-grow: 1;
  height: 4px;

  background: var(--color-background-secondary);
  border-radius: var(--radius-full);

  overflow: hidden;
}

.slider-range {
  position: absolute;
  height: 100%;

  background: var(--color-primary-500);
  border-radius: var(--radius-full);
}

.slider-thumb {
  display: block;
  width: 20px;
  height: 20px;

  background: white;
  border: 2px solid var(--color-primary-500);
  border-radius: 50%;
  box-shadow: var(--shadow-sm);

  cursor: grab;
  outline: none;

  transition: box-shadow var(--transition-fast);
}

.slider-thumb:hover {
  box-shadow: var(--shadow-md);
}

.slider-thumb:focus-visible {
  box-shadow: 0 0 0 4px var(--color-primary-100);
}

.slider-thumb:active {
  cursor: grabbing;
}

.slider-thumb[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
```

#### API Reference

**`<Slider>`** - Root component

Props:
- `value?: Signal<number | number[]>` - Controlled value(s)
- `defaultValue?: number | number[]` - Initial value(s)
- `onValueChange?: (value: number | number[]) => void`
- `onValueCommit?: (value: number | number[]) => void` - When user releases thumb
- `min?: number` - Minimum value (default: 0)
- `max?: number` - Maximum value (default: 100)
- `step?: number` - Step increment (default: 1)
- `minStepsBetweenThumbs?: number` - For range sliders (default: 0)
- `orientation?: 'horizontal' | 'vertical'` - Orientation (default: 'horizontal')
- `disabled?: boolean`
- `inverted?: boolean` - Invert slider direction

**`<Slider.Track>`** - Track background

**`<Slider.Range>`** - Filled range

**`<Slider.Thumb>`** - Draggable thumb (one per value)

#### Advanced: Custom Value Display

```typescript
import { defineComponent, signal } from 'aether';
import { Slider } from 'aether/primitives';

export const BrightnessSliderWithTooltip = defineComponent(() => {
  const brightness = signal(75);

  return () => (
    <Slider bind:value={brightness} min={0} max={100} step={5}>
      <Slider.Track class="slider-track">
        <Slider.Range class="slider-range" />
      </Slider.Track>
      <Slider.Thumb class="slider-thumb">
        {/* Tooltip on thumb */}
        <div class="slider-tooltip">
          {brightness()}%
        </div>
      </Slider.Thumb>
    </Slider>
  );
});
```

```css
.slider-thumb {
  position: relative;
}

.slider-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);

  padding: var(--spacing-1) var(--spacing-2);

  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);

  font-size: var(--font-size-xs);
  white-space: nowrap;

  pointer-events: none;
}
```

---

