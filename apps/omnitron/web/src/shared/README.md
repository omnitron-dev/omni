# Shared Module

The Shared Module provides reusable UI components and utilities for the Omnitron application.

## Components

### Button
A versatile button component with multiple variants, sizes, and states.

**Features:**
- Multiple variants (primary, secondary, success, warning, danger, ghost, link)
- Multiple sizes (xs, sm, md, lg, xl)
- Loading state with spinner
- Disabled state
- Full-width option
- Keyboard accessible
- ARIA support

**Usage:**
```tsx
import { Button } from '@/shared';

<Button variant="primary" size="md" onClick={handleClick}>
  Click Me
</Button>

<Button variant="success" loading>
  Submitting...
</Button>
```

### Icon
A flexible icon component with built-in icon library and custom SVG support.

**Features:**
- 40+ built-in icons (navigation, actions, status, objects, media, communication, etc.)
- Custom SVG path support
- Multiple sizes (xs, sm, md, lg, xl, 2xl, 3xl)
- Color variants
- Rotation and flip transformations
- ARIA support

**Usage:**
```tsx
import { Icon } from '@/shared';

<Icon name="settings" size="md" />
<Icon name="check" color="success" />
<Icon svg={customPath} rotate={90} />
```

### Loading
A versatile loading indicator with multiple variants.

**Features:**
- Multiple variants (spinner, dots, pulse, bars, ring)
- Multiple sizes (xs, sm, md, lg, xl)
- Loading text support
- Overlay and fullscreen modes
- Animation speed control
- Custom colors
- ARIA support

**Usage:**
```tsx
import { Loading } from '@/shared';

<Loading variant="spinner" size="md" text="Loading..." />
<Loading variant="dots" overlay />
<Loading variant="pulse" fullscreen />
```

### ErrorBoundary
Catches and handles errors in the component tree.

**Features:**
- Prevents entire app from crashing
- Custom fallback UI
- Error callback support
- Reset functionality
- Development mode error details
- Console logging
- ARIA support

**Usage:**
```tsx
import { ErrorBoundary } from '@/shared';

<ErrorBoundary
  fallback={<CustomErrorUI />}
  onError={(error) => logError(error)}
  resetable
>
  <MyComponent />
</ErrorBoundary>
```

## Utilities

### Format Utilities

**Date Formatting:**
- `formatDate()` - Format dates in various formats
- `formatDateTime()` - Format date and time
- `formatRelativeTime()` - Relative time (e.g., "2 hours ago")
- `formatTime()` - Format time only

**Number Formatting:**
- `formatNumber()` - Format numbers with separators
- `formatCurrency()` - Format as currency
- `formatPercentage()` - Format as percentage
- `formatCompactNumber()` - Compact notation (1.2K, 3.4M)
- `formatOrdinal()` - Ordinal suffix (1st, 2nd, 3rd)

**File Size Formatting:**
- `formatFileSize()` - Human-readable file sizes

**String Formatting:**
- `truncate()` - Truncate with ellipsis
- `truncateMiddle()` - Truncate in the middle
- `toTitleCase()` - Convert to title case
- `toSentenceCase()` - Convert to sentence case
- `fromCamelCase()` - Convert camelCase to readable
- `fromKebabCase()` - Convert kebab-case to readable
- `pluralize()` - Pluralize words

**Duration Formatting:**
- `formatDuration()` - Format as HH:MM:SS
- `formatHumanDuration()` - Human-readable duration

**Usage:**
```tsx
import { formatDate, formatCurrency, formatFileSize } from '@/shared';

formatDate(new Date(), 'long'); // "January 16, 2025"
formatCurrency(1234.56); // "$1,234.56"
formatFileSize(1024 * 1024 * 5); // "5.00 MB"
```

### Validation Utilities

**Basic Validators:**
- `required()` - Required field
- `minLength()` - Minimum length
- `maxLength()` - Maximum length
- `exactLength()` - Exact length

**Number Validators:**
- `min()` - Minimum value
- `max()` - Maximum value
- `range()` - Value range
- `isNumber()` - Is number
- `isInteger()` - Is integer

**String Validators:**
- `isEmail()` - Email validation
- `isUrl()` - URL validation
- `pattern()` - Regex pattern
- `isAlphanumeric()` - Alphanumeric only
- `isPhoneNumber()` - Phone number
- `isAlpha()` - Letters only

**Comparison Validators:**
- `matches()` - Match another value
- `oneOf()` - One of allowed values

**Date Validators:**
- `isPastDate()` - Past date
- `isFutureDate()` - Future date
- `isAfter()` - After another date
- `isBefore()` - Before another date

**Composite Validators:**
- `all()` - AND logic
- `any()` - OR logic
- `not()` - Negate validator
- `when()` - Conditional validation

**Usage:**
```tsx
import { required, isEmail, minLength, validate } from '@/shared';

const validators = [
  required(),
  isEmail(),
  minLength(5),
];

const result = validate(email, validators);
if (!result.valid) {
  console.error(result.error);
}
```

## Architecture

The Shared Module follows Aether's component patterns:

1. **Function-based Components**: Uses `defineComponent()` for all components
2. **Signals for State**: Reactive state management with signals
3. **JSX Runtime**: Direct jsx() calls for optimal performance
4. **Type Safety**: Full TypeScript support with exported types
5. **Accessibility**: ARIA attributes and keyboard support
6. **Responsive**: Mobile-friendly and adaptive

## File Structure

```
shared/
├── components/
│   ├── Button.tsx           # Button component
│   ├── Icon.tsx             # Icon component
│   ├── Loading.tsx          # Loading indicator
│   └── ErrorBoundary.tsx    # Error boundary
├── utils/
│   ├── format.ts            # Formatting utilities
│   └── validation.ts        # Validation utilities
├── shared.module.ts         # Module definition
├── index.ts                 # Barrel exports
└── README.md                # This file
```

## Import Patterns

```tsx
// Import specific items
import { Button, Icon, formatDate } from '@/shared';

// Import types
import type { ButtonProps, ValidationResult } from '@/shared';

// Import everything
import * as Shared from '@/shared';
```

## Styling

Components use data attributes for styling:
- `[data-button]`, `[data-variant]`, `[data-size]` for Button
- `[data-icon]`, `[data-size]`, `[data-color]` for Icon
- `[data-loading]`, `[data-variant]`, `[data-overlay]` for Loading
- `[data-error-boundary]` for ErrorBoundary

This allows flexible CSS styling without class name conflicts.

## Best Practices

1. **Use TypeScript types** for props and return values
2. **Provide ARIA labels** for accessibility
3. **Handle edge cases** (null, undefined, empty values)
4. **Keep components composable** and single-responsibility
5. **Document with JSDoc** comments
6. **Follow Aether patterns** (signals, defineComponent)
7. **Test thoroughly** with various inputs

## Future Enhancements

Planned additions:
- Card component
- Modal/Dialog component
- Input components (TextField, Select, Checkbox)
- Tooltip component
- Toast/Notification component
- More utility functions as needed
