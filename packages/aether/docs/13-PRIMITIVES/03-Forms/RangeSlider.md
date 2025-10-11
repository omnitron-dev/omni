### RangeSlider

**Slider component with two thumbs for selecting a value range.**

**Features:**
- Dual thumb slider for min/max range selection
- Keyboard navigation (arrows, Page Up/Down, Home, End)
- Min/max value constraints and minimum distance between thumbs
- Step increments with automatic value snapping
- Vertical and horizontal orientation
- Disabled state support
- Controlled and uncontrolled modes
- ARIA support with proper role and value announcements

**Basic Usage:**

```tsx
<RangeSlider
  defaultValue={{ min: 20, max: 80 }}
  min={0}
  max={100}
  step={5}
  onValueChange={(value) => console.log(value)}
>
  <RangeSlider.Track>
    <RangeSlider.Range />
    <RangeSlider.Thumb position="min" />
    <RangeSlider.Thumb position="max" />
  </RangeSlider.Track>
</RangeSlider>
```

**Advanced Usage:**

```tsx
// Price range filter with minimum distance
<RangeSlider
  value={priceRange()}
  onValueChange={setPriceRange}
  min={0}
  max={1000}
  step={10}
  minDistance={50}
  orientation="horizontal"
>
  <div class="range-slider-container">
    <RangeSlider.Track class="track">
      <RangeSlider.Range class="range" />
      <RangeSlider.Thumb position="min" class="thumb">
        <div class="thumb-label">${priceRange().min}</div>
      </RangeSlider.Thumb>
      <RangeSlider.Thumb position="max" class="thumb">
        <div class="thumb-label">${priceRange().max}</div>
      </RangeSlider.Thumb>
    </RangeSlider.Track>
    <div class="range-values">
      <span>Min: ${priceRange().min}</span>
      <span>Max: ${priceRange().max}</span>
    </div>
  </div>
</RangeSlider>
```

**API:**

**`<RangeSlider>`** - Root container
- `value?: { min: number, max: number }` - Controlled value
- `onValueChange?: (value: RangeValue) => void` - Value change callback
- `defaultValue?: { min: number, max: number }` - Default value (uncontrolled)
- `min?: number` - Minimum allowed value (default: 0)
- `max?: number` - Maximum allowed value (default: 100)
- `step?: number` - Step increment (default: 1)
- `orientation?: 'horizontal' | 'vertical'` - Orientation (default: 'horizontal')
- `disabled?: boolean` - Disabled state
- `minDistance?: number` - Minimum distance between thumbs (default: 0)

**`<RangeSlider.Track>`** - Slider track container

**`<RangeSlider.Range>`** - Visual range indicator (automatically positioned between thumbs)

**`<RangeSlider.Thumb>`** - Draggable thumb
- `position: 'min' | 'max'` - Which thumb (required)

---

