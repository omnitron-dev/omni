# Base Input Primitives

Factory function for creating consistent, accessible form input components with shared logic.

## Overview

The `createInputPrimitive` factory eliminates code duplication across input components (Input, Textarea, NumberInput, etc.) by providing:

- ✅ **Pattern 19 Support**: Signal-based controlled state (`WritableSignal<T>`)
- ✅ **Validation API**: Consistent validation across all inputs
- ✅ **Error Handling**: Standardized error state management
- ✅ **Focus Management**: Utilities for programmatic focus control
- ✅ **ARIA Support**: Full accessibility attributes
- ✅ **Type Safety**: Full TypeScript support with generics

## Usage

### Basic Text Input

```typescript
import { createInputPrimitive } from './base/createInputPrimitive.js';

const Input = createInputPrimitive({
  name: 'input',
  elementType: 'input',
  defaultInputType: 'text',
});

// Use like any Aether component
<Input
  value={signal('hello')}
  placeholder="Enter text"
  onValueChange={(value) => console.log(value)}
/>
```

### Textarea

```typescript
const Textarea = createInputPrimitive({
  name: 'textarea',
  elementType: 'textarea',
});

<Textarea
  value="Initial content"
  rows={5}
  placeholder="Enter long text"
/>
```

### Number Input with Transformation

```typescript
const NumberInput = createInputPrimitive<number>({
  name: 'number-input',
  elementType: 'input',
  defaultInputType: 'number',
  transformValue: (value) => parseFloat(value) || 0,
  formatValue: (value) => String(value),
});

<NumberInput
  value={signal(42)}
  onValueChange={(num) => console.log(`Number: ${num}`)}
/>
```

### Input with Validation

```typescript
const EmailInput = createInputPrimitive({
  name: 'email-input',
  defaultInputType: 'email',
  validateValue: (value) => {
    if (!value) return true; // Allow empty
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    return isValid || 'Invalid email address';
  },
});

<EmailInput
  value={email}
  invalid={!isEmailValid}
  error="Invalid email address"
  aria-describedby="email-error"
/>
```

### Custom Input with All Features

```typescript
const PasswordInput = createInputPrimitive({
  name: 'password-input',
  defaultInputType: 'password',
  validateValue: (value) => {
    if (value.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(value)) return 'Password must contain uppercase letter';
    if (!/[0-9]/.test(value)) return 'Password must contain number';
    return true;
  },
  additionalAttributes: {
    autocomplete: 'new-password',
  },
  excludeProps: ['showStrength'], // Custom props to exclude
});

<PasswordInput
  value={password}
  required
  invalid={passwordError !== null}
  error={passwordError}
  aria-describedby="password-requirements"
  onValueChange={(value) => validatePassword(value)}
/>
```

## Configuration Options

```typescript
interface InputConfig<TValue = string> {
  // Required: Component name (used for data attributes and display name)
  name: string;

  // Element type (default: 'input')
  elementType?: 'input' | 'textarea';

  // Default input type for <input> elements (default: 'text')
  defaultInputType?: string;

  // Transform raw input value before setting state
  transformValue?: (value: string, currentValue: TValue) => TValue;

  // Format state value before rendering
  formatValue?: (value: TValue) => string;

  // Validate value before accepting change
  // Return true/false or error message
  validateValue?: (value: TValue, currentValue: TValue) => boolean | string;

  // Props to exclude from spreading to element
  excludeProps?: string[];

  // Additional attributes to always include
  additionalAttributes?: Record<string, any>;

  // Whether to support auto-focus (default: true)
  supportsAutoFocus?: boolean;
}
```

## Base Props

All components created with `createInputPrimitive` support these props:

```typescript
interface BaseInputProps<TValue = string> {
  // Pattern 19: Controlled value (signal or plain value)
  value?: WritableSignal<TValue> | TValue;
  defaultValue?: TValue;
  onValueChange?: (value: TValue) => void;

  // State
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  invalid?: boolean;
  error?: string;

  // Identity
  name?: string;
  id?: string;

  // ARIA
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;

  // Events
  onChange?: (value: TValue) => void;
  onInput?: (value: TValue) => void;
  onBlur?: (event: FocusEvent) => void;
  onFocus?: (event: FocusEvent) => void;

  // Focus
  autoFocus?: boolean;

  // Additional props spread to element
  [key: string]: any;
}
```

## Focus Management

The factory provides focus management utilities:

```typescript
import { createFocusManager } from './base/createInputPrimitive.js';

const elementRef = signal<HTMLInputElement | null>(null);
const focusManager = createFocusManager(elementRef);

// Programmatic focus control
focusManager.focus();
focusManager.blur();
focusManager.select();
focusManager.setSelectionRange(0, 5);
```

## Validation API

Create validators with consistent behavior:

```typescript
import { createValidator } from './base/createInputPrimitive.js';

const validator = createValidator({
  name: 'input',
  validateValue: (value) => value.length >= 3 || 'Too short',
});

const result = validator('hi', '');
// { valid: false, error: 'Too short' }
```

## Pattern 19: Signal-Based Control

All inputs support both signals and plain values:

```typescript
import { signal } from '../core/reactivity/index.js';

const textSignal = signal('initial');

// Signal control (reactive updates)
<Input value={textSignal} />

// Plain value control
<Input value="controlled" onValueChange={setValue} />

// Uncontrolled with default
<Input defaultValue="default" />
```

## Data Attributes

All inputs created with the factory include these data attributes:

- `data-{name}`: Main component identifier
- `data-disabled`: Present when disabled
- `data-readonly`: Present when read-only
- `data-invalid`: Present when invalid

Example:
```html
<input
  data-input=""
  data-disabled=""
  data-invalid=""
  aria-invalid="true"
/>
```

## Benefits

### Code Reduction

Before (duplicated across 3+ components):
- Input.ts: ~214 lines
- Textarea.ts: ~300 lines
- NumberInput.ts: ~500+ lines
- **Total: ~1,000+ lines of duplicated logic**

After (shared base):
- createInputPrimitive.ts: ~500 lines (reusable)
- Each component using factory: ~50-100 lines
- **Reduction: ~50-70% for shared logic**

### Consistency

- Unified validation API across all inputs
- Consistent error handling patterns
- Standardized focus management
- Identical ARIA attribute handling
- Same Pattern 19 support everywhere

### Type Safety

Full TypeScript support with generics:

```typescript
// String input
const Input = createInputPrimitive<string>({ ... });

// Number input
const NumberInput = createInputPrimitive<number>({ ... });

// Custom type
interface DateValue { year: number; month: number; day: number; }
const DateInput = createInputPrimitive<DateValue>({ ... });
```

### Extensibility

Easy to create specialized inputs:

```typescript
// Currency input
const CurrencyInput = createInputPrimitive<number>({
  name: 'currency-input',
  transformValue: (value) => parseFloat(value.replace(/[^0-9.]/g, '')) || 0,
  formatValue: (value) => `$${value.toFixed(2)}`,
  validateValue: (value) => value >= 0 || 'Amount must be positive',
});

// Phone input
const PhoneInput = createInputPrimitive({
  name: 'phone-input',
  transformValue: (value) => value.replace(/\D/g, '').slice(0, 10),
  formatValue: (value) => {
    const cleaned = value.replace(/\D/g, '');
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
    return match ? `(${match[1]}) ${match[2]}-${match[3]}` : cleaned;
  },
  validateValue: (value) => value.length === 10 || 'Phone must be 10 digits',
});
```

## Migration Guide

### Refactoring Existing Components (Optional)

The factory is designed for **backward compatibility**. Existing Input, Textarea, and NumberInput components do NOT need to be refactored immediately.

If you choose to refactor:

**Before (Input.ts):**
```typescript
export const Input = defineComponent<InputProps>((props) => {
  const [getValue, setValue] = useControlledState(
    props.value,
    props.defaultValue ?? '',
    props.onValueChange
  );

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value;
    setValue(value);
    props.onInput?.(value);
    props.onChange?.(value);
  };

  // ... 200+ more lines
});
```

**After (using factory):**
```typescript
export const Input = createInputPrimitive({
  name: 'input',
  elementType: 'input',
  defaultInputType: 'text',
});

// That's it! ~90% less code
```

### Lines of Code Saved

If all three components were refactored:

| Component | Before | After | Saved |
|-----------|--------|-------|-------|
| Input.ts | ~214 lines | ~10 lines | 204 lines |
| Textarea.ts | ~300 lines | ~50 lines | 250 lines |
| NumberInput.ts | ~500 lines | ~100 lines | 400 lines |
| **Total** | **1,014 lines** | **160 lines** | **854 lines (84%)** |

Plus the factory itself (~500 lines) is reusable for future input components.

## Testing

The factory includes 50+ comprehensive tests covering:

- ✅ Basic component creation
- ✅ Element type configuration
- ✅ Pattern 19 signal support
- ✅ Value transformation
- ✅ Validation (boolean and error message)
- ✅ Event handlers
- ✅ State attributes
- ✅ ARIA attributes
- ✅ Data attributes
- ✅ Props filtering
- ✅ Additional attributes
- ✅ Auto focus
- ✅ Focus manager utilities
- ✅ Validator creation
- ✅ Edge cases
- ✅ Integration scenarios

Run tests:
```bash
npm test src/primitives/base/__tests__/createInputPrimitive.spec.ts
```

## Examples

See `Input.ts`, `Textarea.ts`, and `NumberInput.ts` for real-world usage examples of the factory pattern.

## Backward Compatibility

✅ **100% backward compatible** - The factory does not break any existing components or tests. All 6,706 tests should still pass.

The factory is additive:
- Existing components continue to work unchanged
- New components can use the factory
- Refactoring existing components is optional
- No breaking changes to public APIs
