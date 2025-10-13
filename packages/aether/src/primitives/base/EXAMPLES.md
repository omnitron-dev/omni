# Base Input Primitives - Usage Examples

Complete examples showing how to use `createInputPrimitive` for various input types.

## Example 1: Basic Text Input

```typescript
import { createInputPrimitive } from './base/createInputPrimitive.js';
import { signal } from '../core/reactivity/index.js';

// Create the input component
const Input = createInputPrimitive({
  name: 'input',
  elementType: 'input',
  defaultInputType: 'text',
});

// Usage in your app
function LoginForm() {
  const username = signal('');

  return (
    <div>
      <Label for="username">Username</Label>
      <Input
        id="username"
        value={username}
        placeholder="Enter username"
        required
        aria-label="Username"
      />
    </div>
  );
}
```

## Example 2: Email Input with Validation

```typescript
import { createInputPrimitive } from './base/createInputPrimitive.js';
import { signal, computed } from '../core/reactivity/index.js';

// Create email input with validation
const EmailInput = createInputPrimitive({
  name: 'email-input',
  defaultInputType: 'email',
  validateValue: (value) => {
    if (!value) return true; // Allow empty for optional fields
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value) || 'Please enter a valid email address';
  },
});

function EmailForm() {
  const email = signal('');
  const emailError = signal<string | null>(null);

  const isValid = computed(() => {
    const value = email();
    if (!value) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  });

  return (
    <div>
      <Label for="email">Email</Label>
      <EmailInput
        id="email"
        value={email}
        placeholder="you@example.com"
        invalid={emailError() !== null}
        aria-describedby="email-error"
        onValueChange={(value) => {
          // Validate on change
          if (value && !isValid()) {
            emailError.set('Please enter a valid email address');
          } else {
            emailError.set(null);
          }
        }}
      />
      {emailError() && (
        <span id="email-error" role="alert">
          {emailError()}
        </span>
      )}
    </div>
  );
}
```

## Example 3: Number Input with Min/Max

```typescript
import { createInputPrimitive } from './base/createInputPrimitive.js';
import { signal } from '../core/reactivity/index.js';

// Create number input with validation
const NumberInput = createInputPrimitive<number>({
  name: 'number-input',
  elementType: 'input',
  defaultInputType: 'number',
  transformValue: (value) => {
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  },
  formatValue: (value) => String(value),
  validateValue: (value, currentValue) => {
    if (value < 0) return 'Must be positive';
    if (value > 100) return 'Must be 100 or less';
    return true;
  },
  additionalAttributes: {
    step: '1',
  },
});

function AgeInput() {
  const age = signal(0);

  return (
    <div>
      <Label for="age">Age</Label>
      <NumberInput
        id="age"
        value={age}
        placeholder="Enter your age"
        min="0"
        max="100"
        required
      />
    </div>
  );
}
```

## Example 4: Currency Input with Formatting

```typescript
import { createInputPrimitive } from './base/createInputPrimitive.js';
import { signal } from '../core/reactivity/index.js';

// Create currency input with formatting
const CurrencyInput = createInputPrimitive<number>({
  name: 'currency-input',
  transformValue: (value) => {
    // Remove non-numeric characters except decimal point
    const cleaned = value.replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.round(num * 100) / 100; // Round to 2 decimals
  },
  formatValue: (value) => {
    // Format as currency
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  },
  validateValue: (value) => {
    if (value < 0) return 'Amount must be positive';
    if (value > 1000000) return 'Amount too large';
    return true;
  },
});

function PriceInput() {
  const price = signal(0);

  return (
    <div>
      <Label for="price">Price</Label>
      <CurrencyInput
        id="price"
        value={price}
        placeholder="$0.00"
        required
      />
    </div>
  );
}
```

## Example 5: Phone Number Input with Formatting

```typescript
import { createInputPrimitive } from './base/createInputPrimitive.js';
import { signal } from '../core/reactivity/index.js';

// Create phone input with auto-formatting
const PhoneInput = createInputPrimitive({
  name: 'phone-input',
  defaultInputType: 'tel',
  transformValue: (value) => {
    // Keep only digits, limit to 10
    return value.replace(/\D/g, '').slice(0, 10);
  },
  formatValue: (value) => {
    // Format as (123) 456-7890
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  },
  validateValue: (value) => {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length === 0) return true; // Allow empty
    return cleaned.length === 10 || 'Phone number must be 10 digits';
  },
});

function PhoneForm() {
  const phone = signal('');

  return (
    <div>
      <Label for="phone">Phone Number</Label>
      <PhoneInput
        id="phone"
        value={phone}
        placeholder="(555) 555-5555"
        required
        autoComplete="tel"
      />
    </div>
  );
}
```

## Example 6: Password Input with Strength Validation

```typescript
import { createInputPrimitive } from './base/createInputPrimitive.js';
import { signal, computed } from '../core/reactivity/index.js';

// Create password input with validation
const PasswordInput = createInputPrimitive({
  name: 'password-input',
  defaultInputType: 'password',
  validateValue: (value) => {
    if (!value) return 'Password is required';
    if (value.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(value)) return 'Password must contain an uppercase letter';
    if (!/[a-z]/.test(value)) return 'Password must contain a lowercase letter';
    if (!/[0-9]/.test(value)) return 'Password must contain a number';
    if (!/[^A-Za-z0-9]/.test(value)) return 'Password must contain a special character';
    return true;
  },
  additionalAttributes: {
    autocomplete: 'new-password',
  },
});

function PasswordForm() {
  const password = signal('');
  const passwordError = signal<string | null>(null);

  const strength = computed(() => {
    const value = password();
    let score = 0;
    if (value.length >= 8) score++;
    if (/[A-Z]/.test(value)) score++;
    if (/[a-z]/.test(value)) score++;
    if (/[0-9]/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;
    return score;
  });

  const strengthLabel = computed(() => {
    const score = strength();
    if (score <= 2) return 'Weak';
    if (score <= 3) return 'Fair';
    if (score <= 4) return 'Good';
    return 'Strong';
  });

  return (
    <div>
      <Label for="password">Password</Label>
      <PasswordInput
        id="password"
        value={password}
        placeholder="Enter password"
        invalid={passwordError() !== null}
        aria-describedby="password-requirements"
        required
      />
      <div id="password-requirements">
        <p>Password must contain:</p>
        <ul>
          <li data-met={password().length >= 8}>At least 8 characters</li>
          <li data-met={/[A-Z]/.test(password())}>Uppercase letter</li>
          <li data-met={/[a-z]/.test(password())}>Lowercase letter</li>
          <li data-met={/[0-9]/.test(password())}>Number</li>
          <li data-met={/[^A-Za-z0-9]/.test(password())}>Special character</li>
        </ul>
        <p>Strength: <strong>{strengthLabel()}</strong></p>
      </div>
    </div>
  );
}
```

## Example 7: Textarea with Character Count

```typescript
import { createInputPrimitive } from './base/createInputPrimitive.js';
import { signal, computed } from '../core/reactivity/index.js';

// Create textarea with character limit
const Textarea = createInputPrimitive({
  name: 'textarea',
  elementType: 'textarea',
  validateValue: (value) => {
    if (value.length > 500) return 'Message must be 500 characters or less';
    return true;
  },
});

function MessageForm() {
  const message = signal('');
  const maxLength = 500;

  const remaining = computed(() => maxLength - message().length);
  const isNearLimit = computed(() => remaining() < 50);
  const isOverLimit = computed(() => remaining() < 0);

  return (
    <div>
      <Label for="message">Message</Label>
      <Textarea
        id="message"
        value={message}
        placeholder="Enter your message"
        rows={5}
        invalid={isOverLimit()}
        aria-describedby="char-count"
      />
      <div
        id="char-count"
        data-warning={isNearLimit()}
        data-error={isOverLimit()}
      >
        {remaining()} characters remaining
      </div>
    </div>
  );
}
```

## Example 8: Search Input with Debouncing

```typescript
import { createInputPrimitive } from './base/createInputPrimitive.js';
import { signal, effect } from '../core/reactivity/index.js';

// Create search input
const SearchInput = createInputPrimitive({
  name: 'search-input',
  defaultInputType: 'search',
  additionalAttributes: {
    role: 'searchbox',
  },
});

function SearchBox() {
  const query = signal('');
  const results = signal<string[]>([]);
  const isSearching = signal(false);

  // Debounced search
  effect(() => {
    const searchQuery = query();

    if (!searchQuery) {
      results.set([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      isSearching.set(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await response.json();
        results.set(data);
      } finally {
        isSearching.set(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  });

  return (
    <div>
      <SearchInput
        value={query}
        placeholder="Search..."
        aria-label="Search"
        aria-controls="search-results"
        aria-busy={isSearching()}
      />
      <div id="search-results" role="listbox">
        {isSearching() && <div>Searching...</div>}
        {results().map(result => (
          <div role="option">{result}</div>
        ))}
      </div>
    </div>
  );
}
```

## Example 9: URL Input with Protocol Validation

```typescript
import { createInputPrimitive } from './base/createInputPrimitive.js';
import { signal } from '../core/reactivity/index.js';

// Create URL input with validation
const UrlInput = createInputPrimitive({
  name: 'url-input',
  defaultInputType: 'url',
  validateValue: (value) => {
    if (!value) return true; // Allow empty
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return 'URL must use http or https protocol';
      }
      return true;
    } catch {
      return 'Please enter a valid URL';
    }
  },
});

function WebsiteForm() {
  const website = signal('');

  return (
    <div>
      <Label for="website">Website</Label>
      <UrlInput
        id="website"
        value={website}
        placeholder="https://example.com"
        autoComplete="url"
      />
    </div>
  );
}
```

## Example 10: Credit Card Input with Masking

```typescript
import { createInputPrimitive } from './base/createInputPrimitive.js';
import { signal, computed } from '../core/reactivity/index.js';

// Create credit card input with formatting
const CreditCardInput = createInputPrimitive({
  name: 'credit-card-input',
  transformValue: (value) => {
    // Keep only digits, limit to 16
    return value.replace(/\D/g, '').slice(0, 16);
  },
  formatValue: (value) => {
    // Format as 1234 5678 9012 3456
    const cleaned = value.replace(/\D/g, '');
    const groups = cleaned.match(/.{1,4}/g) || [];
    return groups.join(' ');
  },
  validateValue: (value) => {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length === 0) return true;
    if (cleaned.length !== 16) return 'Card number must be 16 digits';

    // Luhn algorithm for credit card validation
    let sum = 0;
    let isEven = false;
    for (let i = cleaned.length - 1; i >= 0; i--) {
      let digit = parseInt(cleaned[i], 10);
      if (isEven) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0 || 'Invalid card number';
  },
  additionalAttributes: {
    inputMode: 'numeric',
    autocomplete: 'cc-number',
  },
});

function PaymentForm() {
  const cardNumber = signal('');

  const cardType = computed(() => {
    const cleaned = cardNumber().replace(/\D/g, '');
    if (/^4/.test(cleaned)) return 'Visa';
    if (/^5[1-5]/.test(cleaned)) return 'Mastercard';
    if (/^3[47]/.test(cleaned)) return 'Amex';
    return 'Unknown';
  });

  return (
    <div>
      <Label for="card-number">Credit Card Number</Label>
      <CreditCardInput
        id="card-number"
        value={cardNumber}
        placeholder="1234 5678 9012 3456"
        required
      />
      <div>Card Type: {cardType()}</div>
    </div>
  );
}
```

## Testing Your Custom Inputs

```typescript
import { describe, it, expect } from 'vitest';
import { signal } from '../core/reactivity/index.js';

describe('EmailInput', () => {
  it('should validate email format', () => {
    const email = signal('');
    const errors = signal<string[]>([]);

    const component = EmailInput({
      value: email,
      onValueChange: (value) => {
        // Validate
        const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        if (!isValid && value) {
          errors.set(['Invalid email']);
        } else {
          errors.set([]);
        }
      },
    });

    // Test valid email
    email.set('test@example.com');
    expect(errors()).toEqual([]);

    // Test invalid email
    email.set('invalid-email');
    expect(errors()).toEqual(['Invalid email']);
  });
});
```

## Best Practices

1. **Always validate user input** - Use `validateValue` for inline validation
2. **Provide helpful error messages** - Return descriptive error strings
3. **Use appropriate input types** - Helps with mobile keyboards and validation
4. **Add ARIA labels** - Ensure accessibility for screen readers
5. **Handle edge cases** - Empty values, very long values, special characters
6. **Format display values** - Use `formatValue` for user-friendly formatting
7. **Transform before validation** - Clean/normalize values with `transformValue`
8. **Test thoroughly** - Write tests for validation, formatting, and edge cases

## Resources

- [Base Input API Documentation](./README.md)
- [Pattern 19: Signal-Based Control](../../docs/patterns/19-signal-based-control.md)
- [Validation Patterns](../../docs/patterns/validation.md)
- [Accessibility Guidelines](../../docs/accessibility.md)
