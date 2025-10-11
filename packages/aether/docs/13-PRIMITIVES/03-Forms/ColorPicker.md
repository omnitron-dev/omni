### ColorPicker

**Color selection component with visual picker and multiple format support.**

**Features:**
- Visual color picker with saturation/brightness area
- Hue slider for color selection
- Optional alpha/opacity slider
- HEX, RGB, HSL input formats
- Preset colors support
- Full HSL color space with conversion utilities
- Eyedropper tool support (where available)
- Controlled and uncontrolled modes
- ARIA support for sliders

**Basic Usage:**

```tsx
<ColorPicker
  defaultValue={{ h: 210, s: 100, l: 50, a: 1 }}
  onValueChange={(color) => console.log(color)}
>
  <ColorPicker.Trigger />

  <ColorPicker.Content>
    <ColorPicker.Area />
    <ColorPicker.HueSlider />
    <ColorPicker.AlphaSlider />
  </ColorPicker.Content>
</ColorPicker>
```

**Advanced Usage:**

```tsx
// Theme color picker with presets
<ColorPicker
  value={themeColor()}
  onValueChange={setThemeColor}
  showAlpha={true}
  format="hex"
>
  <ColorPicker.Trigger class="color-trigger">
    <div
      class="color-preview"
      style={{ background: context.toHex() }}
    />
    <span>{context.toHex()}</span>
  </ColorPicker.Trigger>

  <ColorPicker.Content class="color-picker-panel">
    <div class="picker-area">
      <ColorPicker.Area class="saturation-brightness" />
    </div>

    <div class="sliders">
      <div class="slider-row">
        <label>Hue</label>
        <ColorPicker.HueSlider class="hue-slider" />
      </div>

      <div class="slider-row">
        <label>Alpha</label>
        <ColorPicker.AlphaSlider class="alpha-slider" />
      </div>
    </div>

    <div class="color-values">
      <div class="value-group">
        <label>HEX</label>
        <input value={context.toHex()} readOnly />
      </div>
      <div class="value-group">
        <label>RGB</label>
        <input value={context.toRgb()} readOnly />
      </div>
      <div class="value-group">
        <label>HSL</label>
        <input value={context.toHsl()} readOnly />
      </div>
    </div>

    <div class="presets">
      <h4>Presets</h4>
      <div class="preset-grid">
        <For each={colorPresets}>
          {(preset) => (
            <ColorPicker.Preset color={preset.value}>
              <div
                class="preset-swatch"
                style={{ background: preset.value }}
                title={preset.name}
              />
            </ColorPicker.Preset>
          )}
        </For>
      </div>
    </div>
  </ColorPicker.Content>
</ColorPicker>
```

**API:**

**`<ColorPicker>`** - Root container
- `value?: ColorValue` - Controlled value ({ h, s, l, a })
- `onValueChange?: (value: ColorValue) => void` - Value change callback
- `defaultValue?: ColorValue` - Default value (uncontrolled)
- `showAlpha?: boolean` - Whether to show alpha slider (default: false)
- `format?: 'hex' | 'rgb' | 'hsl'` - Display format (default: 'hex')
- `presets?: string[]` - Preset color values
- `disabled?: boolean` - Disabled state

**`<ColorPicker.Trigger>`** - Trigger button to open picker

**`<ColorPicker.Content>`** - Picker content panel

**`<ColorPicker.Area>`** - Saturation/brightness picker area (draggable)

**`<ColorPicker.HueSlider>`** - Hue selection slider

**`<ColorPicker.AlphaSlider>`** - Alpha/opacity slider (only shown if showAlpha=true)

**`<ColorPicker.Preset>`** - Preset color swatch
- `color: string` - Preset color value (hex, rgb, or hsl)

---

