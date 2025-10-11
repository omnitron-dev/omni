### PinInput

PIN/OTP input component with automatic focus management, perfect for two-factor authentication codes.

#### Features

- Automatic focus management between inputs
- Paste support (splits pasted value across inputs)
- Numeric, alphanumeric, or custom patterns
- Masked/password input support
- Keyboard navigation (arrows, backspace, delete)
- Auto-submit on completion
- Controlled and uncontrolled modes

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { PinInput } from 'aether/primitives';

const Example = defineComponent(() => {
  const pin = signal('');

  const handleComplete = (value: string) => {
    console.log('PIN complete:', value);
    // Auto-submit or validate
  };

  return () => (
    <PinInput
      length={6}
      type="numeric"
      value={pin()}
      onValueChange={pin}
      onComplete={handleComplete}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <PinInput.Input key={i} index={i} class="pin-input" />
      ))}
    </PinInput>
  );
});
```

#### With Masking

```typescript
const Example = defineComponent(() => {
  return () => (
    <PinInput
      length={4}
      type="numeric"
      mask
      autoFocus
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <PinInput.Input key={i} index={i} />
      ))}
    </PinInput>
  );
});
```

#### API

**`<PinInput>`** - Root component
- `value?: string` - Controlled value
- `onValueChange?: (value: string) => void` - Value change callback
- `defaultValue?: string` - Default value (uncontrolled)
- `length?: number` - Number of input fields (default: 6)
- `type?: 'numeric' | 'alphanumeric' | 'all'` - Input type (default: 'numeric')
- `mask?: boolean` - Mask the input (default: false)
- `placeholder?: string` - Placeholder character (default: '○')
- `disabled?: boolean` - Whether inputs are disabled
- `autoFocus?: boolean` - Auto-focus first input (default: false)
- `onComplete?: (value: string) => void` - Called when all inputs filled

**`<PinInput.Input>`** - Individual input field
- `index: number` - Index of this input (0-based)

---

