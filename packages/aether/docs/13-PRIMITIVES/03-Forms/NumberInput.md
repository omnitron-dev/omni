### NumberInput

**Numeric input with increment/decrement controls and keyboard support.**

**Features:**
- Increment and decrement buttons
- Keyboard support (arrows, Page Up/Down, Home/End)
- Min/max value constraints
- Step increments with precision control
- Format options (decimal, currency, percentage)
- Mouse wheel support (optional)
- Clamp value on blur
- Controlled and uncontrolled modes
- ARIA spinbutton support

**Basic Usage:**

```tsx
<NumberInput
  defaultValue={0}
  min={0}
  max={100}
  step={1}
  onValueChange={(value) => console.log(value)}
>
  <NumberInput.Field />
  <NumberInput.Increment />
  <NumberInput.Decrement />
</NumberInput>
```

**Advanced Usage:**

```tsx
// Price input with currency formatting
<NumberInput
  value={price()}
  onValueChange={setPrice}
  min={0}
  max={9999.99}
  step={0.01}
  precision={2}
  format="currency"
  allowMouseWheel={true}
  clampValueOnBlur={true}
  keepWithinRange={true}
>
  <div class="price-input-container">
    <label>Product Price</label>

    <div class="number-input-group">
      <NumberInput.Field
        class="price-field"
        aria-label="Product price"
      />

      <div class="stepper-buttons">
        <NumberInput.Increment class="btn-increment">
          ▲
        </NumberInput.Increment>
        <NumberInput.Decrement class="btn-decrement">
          ▼
        </NumberInput.Decrement>
      </div>
    </div>

    <div class="price-info">
      <span>Range: $0.00 - $9,999.99</span>
      <span>Step: $0.01</span>
    </div>
  </div>
</NumberInput>

// Quantity selector for cart
<NumberInput
  value={quantity()}
  onValueChange={setQuantity}
  min={1}
  max={stock()}
  step={1}
  precision={0}
  readonly={outOfStock()}
>
  <div class="quantity-selector">
    <NumberInput.Decrement class="qty-btn">-</NumberInput.Decrement>
    <NumberInput.Field class="qty-field" />
    <NumberInput.Increment class="qty-btn">+</NumberInput.Increment>
  </div>
  <span class="stock-info">{stock()} in stock</span>
</NumberInput>
```

**API:**

**`<NumberInput>`** - Root container
- `value?: number` - Controlled value
- `onValueChange?: (value: number) => void` - Value change callback
- `defaultValue?: number` - Default value (uncontrolled)
- `min?: number` - Minimum value (default: -Infinity)
- `max?: number` - Maximum value (default: Infinity)
- `step?: number` - Step increment (default: 1)
- `precision?: number` - Decimal places (default: 0)
- `disabled?: boolean` - Disabled state
- `readonly?: boolean` - Readonly state
- `allowMouseWheel?: boolean` - Enable mouse wheel (default: false)
- `clampValueOnBlur?: boolean` - Clamp to min/max on blur (default: true)
- `keepWithinRange?: boolean` - Keep value within bounds (default: true)
- `format?: 'decimal' | 'currency' | 'percentage'` - Display format (default: 'decimal')

**`<NumberInput.Field>`** - Number input field

**`<NumberInput.Increment>`** - Increment button (adds step to value)

**`<NumberInput.Decrement>`** - Decrement button (subtracts step from value)

---

