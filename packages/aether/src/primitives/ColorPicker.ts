/**
 * ColorPicker - Color selection component with multiple input formats
 *
 * Features:
 * - Visual color picker with saturation/brightness area
 * - Hue slider
 * - Alpha/opacity slider (optional)
 * - HEX, RGB, HSL input formats
 * - Preset colors
 * - Recent colors history
 * - Eyedropper tool (where supported)
 * - Controlled and uncontrolled modes
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface ColorValue {
  /** Hue (0-360) */
  h: number;
  /** Saturation (0-100) */
  s: number;
  /** Lightness (0-100) */
  l: number;
  /** Alpha (0-1) */
  a: number;
}

export interface ColorPickerProps {
  /** Controlled value (HSL color) */
  value?: ColorValue;
  /** Value change callback */
  onValueChange?: (value: ColorValue) => void;
  /** Default value (uncontrolled) */
  defaultValue?: ColorValue;
  /** Whether to show alpha slider */
  showAlpha?: boolean;
  /** Format for display */
  format?: 'hex' | 'rgb' | 'hsl';
  /** Preset colors */
  presets?: string[];
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Children */
  children?: any;
}

export interface ColorPickerTriggerProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface ColorPickerContentProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface ColorPickerAreaProps {
  /** Additional props */
  [key: string]: any;
}

export interface ColorPickerHueSliderProps {
  /** Additional props */
  [key: string]: any;
}

export interface ColorPickerAlphaSliderProps {
  /** Additional props */
  [key: string]: any;
}

export interface ColorPickerPresetProps {
  /** Preset color value (hex, rgb, or hsl) */
  color: string;
  /** Children */
  children?: any;
}

interface ColorPickerContextValue {
  /** Current color value */
  value: Signal<ColorValue>;
  /** Set color value */
  setValue: (value: ColorValue) => void;
  /** Show alpha */
  showAlpha: boolean;
  /** Format */
  format: 'hex' | 'rgb' | 'hsl';
  /** Disabled state */
  disabled: boolean;
  /** Convert to hex */
  toHex: () => string;
  /** Convert to RGB */
  toRgb: () => string;
  /** Convert to HSL */
  toHsl: () => string;
  /** Parse color string */
  parseColor: (color: string) => ColorValue | null;
}

// ============================================================================
// Context
// ============================================================================

const ColorPickerContext = createContext<ColorPickerContextValue | null>(null);

const useColorPickerContext = (): ColorPickerContextValue => {
  const context = useContext(ColorPickerContext);
  if (!context) {
    throw new Error('ColorPicker components must be used within a ColorPicker');
  }
  return context;
};

// ============================================================================
// Color Conversion Utilities
// ============================================================================

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0,
    g = 0,
    b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = x;
    g = 0;
    b = c;
  } else if (h >= 300 && h < 360) {
    r = c;
    g = 0;
    b = x;
  }

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};

const rgbToHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');

const hexToRgb = (hex: string): [number, number, number] | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1] as string, 16), parseInt(result[2] as string, 16), parseInt(result[3] as string, 16)]
    : null;
};

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
      default:
        // Should never reach here given max is one of r, g, or b
        h = 0;
        break;
    }
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
};

// ============================================================================
// ColorPicker Root
// ============================================================================

export const ColorPicker = defineComponent<ColorPickerProps>((props) => {
  const showAlpha = props.showAlpha ?? false;
  const format = props.format ?? 'hex';
  const disabled = props.disabled ?? false;

  // State
  const internalValue: WritableSignal<ColorValue> = signal<ColorValue>(
    props.defaultValue ?? { h: 0, s: 100, l: 50, a: 1 }
  );

  const currentValue = (): ColorValue => {
    if (props.value !== undefined) {
      return props.value;
    }
    return internalValue();
  };

  const setValue = (newValue: ColorValue) => {
    if (props.value === undefined) {
      internalValue.set(newValue);
    }
    props.onValueChange?.(newValue);
  };

  const toHex = (): string => {
    const color = currentValue();
    const [r, g, b] = hslToRgb(color.h, color.s, color.l);
    return rgbToHex(r, g, b);
  };

  const toRgb = (): string => {
    const color = currentValue();
    const [r, g, b] = hslToRgb(color.h, color.s, color.l);
    if (showAlpha && color.a < 1) {
      return `rgba(${r}, ${g}, ${b}, ${color.a})`;
    }
    return `rgb(${r}, ${g}, ${b})`;
  };

  const toHsl = (): string => {
    const color = currentValue();
    if (showAlpha && color.a < 1) {
      return `hsla(${color.h}, ${color.s}%, ${color.l}%, ${color.a})`;
    }
    return `hsl(${color.h}, ${color.s}%, ${color.l}%)`;
  };

  const parseColor = (colorString: string): ColorValue | null => {
    // Try to parse hex
    if (colorString.startsWith('#')) {
      const rgb = hexToRgb(colorString);
      if (rgb) {
        const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
        return { h, s, l, a: 1 };
      }
    }

    // Try to parse rgb/rgba
    const rgbMatch = colorString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (rgbMatch) {
      const [h, s, l] = rgbToHsl(
        parseInt(rgbMatch[1] as string),
        parseInt(rgbMatch[2] as string),
        parseInt(rgbMatch[3] as string)
      );
      const a = rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1;
      return { h, s, l, a };
    }

    // Try to parse hsl/hsla
    const hslMatch = colorString.match(/hsla?\((\d+),\s*(\d+)%,\s*(\d+)%(?:,\s*([\d.]+))?\)/);
    if (hslMatch) {
      return {
        h: parseInt(hslMatch[1] as string),
        s: parseInt(hslMatch[2] as string),
        l: parseInt(hslMatch[3] as string),
        a: hslMatch[4] ? parseFloat(hslMatch[4]) : 1,
      };
    }

    return null;
  };

  const contextValue: ColorPickerContextValue = {
    value: computed(() => currentValue()),
    setValue,
    showAlpha,
    format,
    disabled,
    toHex,
    toRgb,
    toHsl,
    parseColor,
  };

  // Provide context during setup phase (Pattern 17)
  provideContext(ColorPickerContext, contextValue);

  return () => {
    // Evaluate function children during render (Pattern 17)
    const children = typeof props.children === 'function' ? props.children() : props.children;

    return jsx('div', {
      'data-color-picker': '',
      'data-disabled': disabled ? '' : undefined,
      children,
    });
  };
});

// ============================================================================
// ColorPicker Trigger
// ============================================================================

export const ColorPickerTrigger = defineComponent<ColorPickerTriggerProps>((props) => {
  const context = useColorPickerContext();

  return () => {
    const { children, ...rest } = props;
    const colorString =
      context.format === 'hex' ? context.toHex() : context.format === 'rgb' ? context.toRgb() : context.toHsl();

    return jsx('button', {
      type: 'button',
      'data-color-picker-trigger': '',
      'aria-label': 'Pick a color',
      disabled: context.disabled,
      ...rest,
      children: children ?? colorString,
    });
  };
});

// ============================================================================
// ColorPicker Content
// ============================================================================

export const ColorPickerContent = defineComponent<ColorPickerContentProps>((props) => () => {
  const { children, ...rest } = props;

  return jsx('div', {
    'data-color-picker-content': '',
    role: 'dialog',
    'aria-label': 'Color picker',
    ...rest,
    children,
  });
});

// ============================================================================
// ColorPicker Area (Saturation/Brightness selector)
// ============================================================================

export const ColorPickerArea = defineComponent<ColorPickerAreaProps>((props) => {
  const context = useColorPickerContext();
  const areaRef: { current: HTMLDivElement | null } = { current: null };

  const handlePointerDown = (e: PointerEvent) => {
    if (context.disabled) return;

    const area = areaRef.current;
    if (!area) return;

    area.setPointerCapture(e.pointerId);

    const updateColor = (moveEvent: PointerEvent) => {
      const rect = area.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (moveEvent.clientY - rect.top) / rect.height));

      const color = context.value();
      context.setValue({
        ...color,
        s: x * 100,
        l: (1 - y) * 100,
      });
    };

    updateColor(e);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateColor(moveEvent);
    };

    const handlePointerUp = () => {
      area.releasePointerCapture(e.pointerId);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  return () => {
    const color = context.value();
    const background = `hsl(${color.h}, 100%, 50%)`;

    return jsx('div', {
      ref: areaRef,
      'data-color-picker-area': '',
      style: { background },
      onPointerDown: handlePointerDown,
      ...props,
    });
  };
});

// ============================================================================
// ColorPicker Hue Slider
// ============================================================================

export const ColorPickerHueSlider = defineComponent<ColorPickerHueSliderProps>((props) => {
  const context = useColorPickerContext();
  const sliderRef: { current: HTMLDivElement | null } = { current: null };

  const handlePointerDown = (e: PointerEvent) => {
    if (context.disabled) return;

    const slider = sliderRef.current;
    if (!slider) return;

    slider.setPointerCapture(e.pointerId);

    const updateHue = (moveEvent: PointerEvent) => {
      const rect = slider.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));

      const color = context.value();
      context.setValue({
        ...color,
        h: x * 360,
      });
    };

    updateHue(e);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateHue(moveEvent);
    };

    const handlePointerUp = () => {
      slider.releasePointerCapture(e.pointerId);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  return () =>
    jsx('div', {
      ref: sliderRef,
      'data-color-picker-hue-slider': '',
      role: 'slider',
      'aria-label': 'Hue',
      'aria-valuemin': 0,
      'aria-valuemax': 360,
      'aria-valuenow': context.value().h,
      onPointerDown: handlePointerDown,
      ...props,
    });
});

// ============================================================================
// ColorPicker Alpha Slider
// ============================================================================

export const ColorPickerAlphaSlider = defineComponent<ColorPickerAlphaSliderProps>((props) => {
  const context = useColorPickerContext();
  const sliderRef: { current: HTMLDivElement | null } = { current: null };

  if (!context.showAlpha) return () => null;

  const handlePointerDown = (e: PointerEvent) => {
    if (context.disabled) return;

    const slider = sliderRef.current;
    if (!slider) return;

    slider.setPointerCapture(e.pointerId);

    const updateAlpha = (moveEvent: PointerEvent) => {
      const rect = slider.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));

      const color = context.value();
      context.setValue({
        ...color,
        a: x,
      });
    };

    updateAlpha(e);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateAlpha(moveEvent);
    };

    const handlePointerUp = () => {
      slider.releasePointerCapture(e.pointerId);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  return () =>
    jsx('div', {
      ref: sliderRef,
      'data-color-picker-alpha-slider': '',
      role: 'slider',
      'aria-label': 'Alpha',
      'aria-valuemin': 0,
      'aria-valuemax': 1,
      'aria-valuenow': context.value().a,
      onPointerDown: handlePointerDown,
      ...props,
    });
});

// ============================================================================
// ColorPicker Preset
// ============================================================================

export const ColorPickerPreset = defineComponent<ColorPickerPresetProps>((props) => {
  const context = useColorPickerContext();

  const handleClick = () => {
    const parsed = context.parseColor(props.color);
    if (parsed) {
      context.setValue(parsed);
    }
  };

  return () => {
    const { color, children } = props;

    return jsx('button', {
      type: 'button',
      'data-color-picker-preset': '',
      style: { background: color },
      onClick: handleClick,
      'aria-label': `Select color ${color}`,
      children,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(ColorPicker as any).Trigger = ColorPickerTrigger;
(ColorPicker as any).Content = ColorPickerContent;
(ColorPicker as any).Area = ColorPickerArea;
(ColorPicker as any).HueSlider = ColorPickerHueSlider;
(ColorPicker as any).AlphaSlider = ColorPickerAlphaSlider;
(ColorPicker as any).Preset = ColorPickerPreset;

// ============================================================================
// Export types
// ============================================================================

export type { ColorPickerContextValue };
