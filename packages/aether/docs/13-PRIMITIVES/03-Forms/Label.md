### Label

A semantic label component for associating text with form controls, providing proper accessibility and click-to-focus behavior.

#### Features

- Automatic click-to-focus for associated controls
- Proper ARIA associations via `for` attribute
- Works with all form control types (input, textarea, checkbox, radio, switch, etc.)
- Native HTML label behavior
- Full keyboard accessibility
- Seamless integration with Aether primitives
- Customizable via CSS

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Label, Input } from 'aether/primitives';

// Basic label with input
export const BasicLabel = defineComponent(() => {
  const email = signal('');

  return () => (
    <div class="field">
      <Label for="email-input">Email Address</Label>
      <Input
        id="email-input"
        type="email"
        value={email()}
        onChange={email.set}
        placeholder="you@example.com"
      />
    </div>
  );
});

// Label with required indicator
export const RequiredLabel = defineComponent(() => {
  const username = signal('');

  return () => (
    <div class="field">
      <Label for="username" class="label-required">
        Username <span class="required-indicator" aria-label="required">*</span>
      </Label>
      <Input
        id="username"
        type="text"
        value={username()}
        onChange={username.set}
        required
      />
    </div>
  );
});

// Label with disabled state styling
export const DisabledLabel = defineComponent(() => {
  return () => (
    <div class="field">
      <Label for="disabled-input" class="label-disabled">
        Disabled Field
      </Label>
      <Input
        id="disabled-input"
        type="text"
        defaultValue="Cannot edit"
        disabled
      />
    </div>
  );
});
```

#### With Checkbox

```typescript
import { defineComponent, signal } from 'aether';
import { Label, Checkbox } from 'aether/primitives';

export const CheckboxWithLabel = defineComponent(() => {
  const agreed = signal(false);

  return () => (
    <div class="checkbox-field">
      <div class="checkbox-wrapper">
        <Checkbox
          id="terms"
          checked={agreed}
          onCheckedChange={agreed.set}
          class="checkbox"
        >
          <Checkbox.Indicator class="checkbox-indicator">
            <CheckIcon />
          </Checkbox.Indicator>
        </Checkbox>
        <Label for="terms" class="checkbox-label">
          I agree to the terms and conditions
        </Label>
      </div>
    </div>
  );
});

// Checkbox with required label
export const RequiredCheckbox = defineComponent(() => {
  const consent = signal(false);

  return () => (
    <div class="checkbox-field">
      <div class="checkbox-wrapper">
        <Checkbox
          id="consent"
          checked={consent}
          onCheckedChange={consent.set}
          required
          class="checkbox"
        >
          <Checkbox.Indicator class="checkbox-indicator">
            <CheckIcon />
          </Checkbox.Indicator>
        </Checkbox>
        <Label for="consent" class="checkbox-label">
          I consent to data processing
          <span class="required-indicator" aria-label="required">*</span>
        </Label>
      </div>
    </div>
  );
});
```

#### With Radio Group

```typescript
import { defineComponent, signal } from 'aether';
import { Label, RadioGroup } from 'aether/primitives';

export const RadioGroupWithLabel = defineComponent(() => {
  const selectedPlan = signal('basic');

  return () => (
    <div class="field">
      <Label for="plan-group" class="field-label">
        Choose Your Plan
      </Label>
      <RadioGroup
        id="plan-group"
        value={selectedPlan()}
        onValueChange={selectedPlan.set}
        class="radio-group"
      >
        <div class="radio-item">
          <RadioGroup.Item value="basic" id="plan-basic" class="radio">
            <RadioGroup.Indicator class="radio-indicator" />
          </RadioGroup.Item>
          <Label for="plan-basic" class="radio-label">
            Basic Plan - $9/month
          </Label>
        </div>

        <div class="radio-item">
          <RadioGroup.Item value="pro" id="plan-pro" class="radio">
            <RadioGroup.Indicator class="radio-indicator" />
          </RadioGroup.Item>
          <Label for="plan-pro" class="radio-label">
            Pro Plan - $29/month
          </Label>
        </div>

        <div class="radio-item">
          <RadioGroup.Item value="enterprise" id="plan-enterprise" class="radio">
            <RadioGroup.Indicator class="radio-indicator" />
          </RadioGroup.Item>
          <Label for="plan-enterprise" class="radio-label">
            Enterprise Plan - Custom pricing
          </Label>
        </div>
      </RadioGroup>
    </div>
  );
});
```

#### With Switch

```typescript
import { defineComponent, signal } from 'aether';
import { Label, Switch } from 'aether/primitives';

export const SwitchWithLabel = defineComponent(() => {
  const notifications = signal(true);
  const marketing = signal(false);

  return () => (
    <div class="settings">
      <div class="switch-field">
        <Label for="notifications" class="switch-label">
          Enable Notifications
        </Label>
        <Switch
          id="notifications"
          checked={notifications}
          onCheckedChange={notifications.set}
          class="switch"
        >
          <Switch.Thumb class="switch-thumb" />
        </Switch>
      </div>

      <div class="switch-field">
        <Label for="marketing" class="switch-label">
          Marketing Emails
        </Label>
        <Switch
          id="marketing"
          checked={marketing}
          onCheckedChange={marketing.set}
          class="switch"
        >
          <Switch.Thumb class="switch-thumb" />
        </Switch>
      </div>
    </div>
  );
});

// Inline switch layout
export const InlineSwitch = defineComponent(() => {
  const darkMode = signal(false);

  return () => (
    <div class="inline-switch-field">
      <Switch
        id="dark-mode"
        checked={darkMode}
        onCheckedChange={darkMode.set}
        class="switch"
      >
        <Switch.Thumb class="switch-thumb" />
      </Switch>
      <Label for="dark-mode" class="inline-switch-label">
        Dark Mode
      </Label>
    </div>
  );
});
```

#### With Textarea

```typescript
import { defineComponent, signal } from 'aether';
import { Label, Textarea } from 'aether/primitives';

export const TextareaWithLabel = defineComponent(() => {
  const comment = signal('');
  const maxLength = 500;

  return () => (
    <div class="field">
      <div class="label-row">
        <Label for="comment" class="field-label">
          Additional Comments
        </Label>
        <span class="char-count">
          {comment().length} / {maxLength}
        </span>
      </div>
      <Textarea
        id="comment"
        value={comment()}
        onChange={comment.set}
        placeholder="Enter your comments here..."
        maxLength={maxLength}
        rows={4}
        class="textarea"
      />
    </div>
  );
});

// Required textarea with help text
export const RequiredTextarea = defineComponent(() => {
  const description = signal('');

  return () => (
    <div class="field">
      <Label for="description" class="field-label">
        Description
        <span class="required-indicator" aria-label="required">*</span>
      </Label>
      <p id="description-help" class="help-text">
        Please provide a detailed description (minimum 50 characters)
      </p>
      <Textarea
        id="description"
        value={description()}
        onChange={description.set}
        required
        aria-describedby="description-help"
        class="textarea"
      />
    </div>
  );
});
```

#### With Select and Combobox

```typescript
import { defineComponent, signal } from 'aether';
import { Label, Select, Combobox } from 'aether/primitives';

export const SelectWithLabel = defineComponent(() => {
  const country = signal('');

  return () => (
    <div class="field">
      <Label for="country-select" class="field-label">
        Country
      </Label>
      <Select value={country()} onValueChange={country.set}>
        <Select.Trigger id="country-select" class="select-trigger">
          <Select.Value placeholder="Select a country" />
        </Select.Trigger>
        <Select.Content class="select-content">
          <Select.Item value="us">United States</Select.Item>
          <Select.Item value="uk">United Kingdom</Select.Item>
          <Select.Item value="ca">Canada</Select.Item>
          <Select.Item value="au">Australia</Select.Item>
        </Select.Content>
      </Select>
    </div>
  );
});

export const ComboboxWithLabel = defineComponent(() => {
  const city = signal('');
  const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix'];

  return () => (
    <div class="field">
      <Label for="city-combobox" class="field-label">
        City
      </Label>
      <Combobox value={city()} onValueChange={city.set}>
        <Combobox.Trigger id="city-combobox" class="combobox-trigger">
          <Combobox.Input placeholder="Search cities..." class="combobox-input" />
        </Combobox.Trigger>
        <Combobox.Content class="combobox-content">
          {cities.map(c => (
            <Combobox.Item value={c} key={c}>
              {c}
            </Combobox.Item>
          ))}
        </Combobox.Content>
      </Combobox>
    </div>
  );
});
```

#### Integration with Form Primitives

```typescript
import { defineComponent, signal } from 'aether';
import { FormField, FormLabel, FormControl, FormDescription, FormMessage } from 'aether/primitives';
import { Label, Input } from 'aether/primitives';

export const FormIntegration = defineComponent(() => {
  const email = signal('');
  const error = signal<string | null>(null);

  const validateEmail = (value: string) => {
    if (!value) {
      error.set('Email is required');
    } else if (!value.includes('@')) {
      error.set('Please enter a valid email address');
    } else {
      error.set(null);
    }
  };

  const handleBlur = () => {
    validateEmail(email());
  };

  return () => (
    <FormField name="email">
      <FormLabel>Email Address</FormLabel>
      <FormDescription>
        We'll never share your email with anyone else.
      </FormDescription>
      <FormControl>
        <Input
          type="email"
          value={email()}
          onChange={email.set}
          onBlur={handleBlur}
          invalid={!!error()}
          placeholder="you@example.com"
          class="input"
        />
      </FormControl>
      {error() && <FormMessage>{error()}</FormMessage>}
    </FormField>
  );
});

// Custom label with FormField
export const CustomFormLabel = defineComponent(() => {
  const username = signal('');

  return () => (
    <FormField name="username">
      <Label for="username-input" class="custom-label">
        Username
        <span class="badge">Premium</span>
      </Label>
      <FormControl>
        <Input
          id="username-input"
          type="text"
          value={username()}
          onChange={username.set}
          class="input"
        />
      </FormControl>
    </FormField>
  );
});
```

#### Custom Styling Examples

```css
/* Basic label styling */
[data-label] {
  display: inline-block;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-1);
  cursor: pointer;
  user-select: none;
}

/* Field label (block-level) */
.field-label {
  display: block;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-2);
  line-height: 1.5;
}

/* Required indicator */
.label-required .required-indicator,
.required-indicator {
  color: var(--color-error);
  margin-left: var(--spacing-1);
  font-weight: var(--font-weight-semibold);
}

/* Disabled label styling */
.label-disabled {
  opacity: 0.5;
  cursor: not-allowed;
  color: var(--color-text-tertiary);
}

/* Checkbox/Radio label */
.checkbox-label,
.radio-label {
  display: inline-block;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  cursor: pointer;
  user-select: none;
  line-height: 1.5;
}

.checkbox-label:hover,
.radio-label:hover {
  color: var(--color-text-secondary);
}

/* Switch label */
.switch-label {
  flex: 1;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  cursor: pointer;
}

.inline-switch-label {
  margin-left: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  cursor: pointer;
}

/* Label with character count */
.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-2);
}

.char-count {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* Label with badge */
.custom-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.custom-label .badge {
  padding: var(--spacing-0-5) var(--spacing-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-primary-foreground);
  background: var(--color-primary-500);
  border-radius: var(--radius-full);
}

/* Help text below label */
.help-text {
  margin-top: var(--spacing-1);
  margin-bottom: var(--spacing-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

/* Focus-within state for field containers */
.field:focus-within .field-label {
  color: var(--color-primary-500);
}

/* Checkbox/Switch field layouts */
.checkbox-field,
.switch-field {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) 0;
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.inline-switch-field {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
}

/* Radio item layout */
.radio-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.radio-item:hover {
  background: var(--color-background-secondary);
}

/* Responsive label sizing */
@media (max-width: 640px) {
  .field-label,
  [data-label] {
    font-size: var(--font-size-xs);
  }

  .checkbox-label,
  .radio-label,
  .switch-label {
    font-size: var(--font-size-xs);
  }
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  [data-label],
  .field-label {
    font-weight: var(--font-weight-bold);
  }

  .required-indicator {
    font-weight: var(--font-weight-bold);
    text-decoration: underline;
  }
}

/* Dark mode adjustments */
@media (prefers-color-scheme: dark) {
  .help-text {
    color: var(--color-text-secondary);
  }

  .radio-item:hover {
    background: var(--color-background-tertiary);
  }
}
```

#### API Reference

**`<Label>`** - Label component

Props:
- `for?: string` - The ID of the form control this label is associated with (maps to `htmlFor` attribute)
- `children?: any` - Label text or content
- `...HTMLLabelAttributes` - All standard HTML label attributes supported

Data attributes:
- `data-label` - Always present, used for styling

Events:
- Native label events (onClick, onMouseEnter, etc.)

#### Accessibility Notes

##### 1. Use of htmlFor

The `for` prop creates a programmatic association between the label and its control:

```typescript
// ✅ Correct - Label explicitly associated
<Label for="email">Email</Label>
<Input id="email" type="email" />

// ❌ Incorrect - No association
<span>Email</span>
<Input type="email" />
```

**Benefits:**
- Screen readers announce the label when the control receives focus
- Clicking the label focuses/activates the associated control
- Better form navigation with assistive technologies

##### 2. Required vs aria-required

When marking fields as required, use both visual indicators and ARIA attributes:

```typescript
// ✅ Best practice - Visual + ARIA
<Label for="name">
  Name
  <span class="required-indicator" aria-label="required">*</span>
</Label>
<Input id="name" required aria-required="true" />

// ⚠️ Visual only - Not accessible
<Label for="name">Name *</Label>
<Input id="name" />

// ⚠️ ARIA only - Not visible to sighted users
<Label for="name">Name</Label>
<Input id="name" aria-required="true" />
```

**Guidelines:**
- Always provide visual indication (asterisk, "required" text, styling)
- Ensure the input has `required` or `aria-required="true"`
- Use `aria-label` on the indicator for screen reader clarity
- Consider using `aria-describedby` to point to requirement instructions

##### 3. Click Behavior

Labels provide automatic click-to-focus/activate behavior:

**Text inputs:** Clicking label focuses the input
```typescript
<Label for="search">Search</Label>
<Input id="search" type="text" /> {/* Clicking label focuses this */}
```

**Checkboxes/Radio:** Clicking label toggles the control
```typescript
<Checkbox id="terms" />
<Label for="terms">I agree</Label> {/* Clicking toggles checkbox */}
```

**Switch:** Clicking label toggles the switch
```typescript
<Switch id="notifications" />
<Label for="notifications">Enable notifications</Label> {/* Clicking toggles */}
```

**Important:** Ensure the `for` prop matches the control's `id` exactly.

##### 4. Screen Reader Announcements

Proper label usage ensures correct announcements:

```typescript
// ✅ Good - Clear announcement
<Label for="email">Email Address</Label>
<Input id="email" type="email" />
// Announces: "Email Address, edit text"

// ✅ Good - With required indicator
<Label for="name">
  Name
  <span class="required-indicator" aria-label="required">*</span>
</Label>
<Input id="name" required />
// Announces: "Name, required, edit text"

// ✅ Good - With help text
<Label for="password">Password</Label>
<p id="password-help">Must be at least 8 characters</p>
<Input
  id="password"
  type="password"
  aria-describedby="password-help"
/>
// Announces: "Password, edit text, Must be at least 8 characters"

// ❌ Bad - No label
<Input placeholder="Email" />
// Announces: Only placeholder (insufficient)
```

##### 5. Label Nesting vs Explicit Association

Both patterns are valid, but explicit association is recommended:

```typescript
// ✅ Recommended - Explicit association (more flexible)
<Label for="username">Username</Label>
<Input id="username" type="text" />

// ✅ Also valid - Implicit association via nesting
<Label>
  Username
  <Input type="text" />
</Label>
```

**Why explicit is better:**
- More flexible layouts (label and control can be separated)
- Clearer component structure
- Easier to style independently
- Works better with complex form layouts

##### 6. Multiple Controls

Don't associate one label with multiple controls:

```typescript
// ❌ Wrong - One label, multiple controls
<Label for="dates">Start and End Date</Label>
<Input id="dates" type="date" />
<Input type="date" />

// ✅ Correct - Each control has its own label
<Label for="start-date">Start Date</Label>
<Input id="start-date" type="date" />

<Label for="end-date">End Date</Label>
<Input id="end-date" type="date" />
```

#### Integration Patterns

##### 1. With Basic Inputs

```typescript
// Standard text input
<Label for="first-name">First Name</Label>
<Input id="first-name" type="text" />

// Email with validation
<Label for="email">Email</Label>
<Input
  id="email"
  type="email"
  aria-invalid={hasError()}
  aria-describedby={hasError() ? 'email-error' : undefined}
/>
{hasError() && (
  <span id="email-error" role="alert">Invalid email</span>
)}
```

##### 2. With Checkboxes and Radio Groups

```typescript
// Individual checkbox
<div class="checkbox-wrapper">
  <Checkbox id="agree" />
  <Label for="agree">I agree to terms</Label>
</div>

// Radio group
<Label id="color-group-label">Choose Color</Label>
<RadioGroup aria-labelledby="color-group-label">
  <div>
    <RadioGroup.Item value="red" id="color-red" />
    <Label for="color-red">Red</Label>
  </div>
  <div>
    <RadioGroup.Item value="blue" id="color-blue" />
    <Label for="color-blue">Blue</Label>
  </div>
</RadioGroup>
```

##### 3. With Switch Controls

```typescript
// Standard switch with label
<div class="switch-field">
  <Label for="dark-mode">Dark Mode</Label>
  <Switch id="dark-mode" />
</div>

// Inline layout
<div class="inline-switch">
  <Switch id="marketing" />
  <Label for="marketing">Marketing emails</Label>
</div>
```

##### 4. With Select and Combobox

```typescript
// Select dropdown
<Label for="country">Country</Label>
<Select>
  <Select.Trigger id="country">
    <Select.Value />
  </Select.Trigger>
  <Select.Content>
    {/* options */}
  </Select.Content>
</Select>

// Searchable combobox
<Label for="city">City</Label>
<Combobox>
  <Combobox.Trigger id="city">
    <Combobox.Input />
  </Combobox.Trigger>
  <Combobox.Content>
    {/* options */}
  </Combobox.Content>
</Combobox>
```

##### 5. With Form Validation

```typescript
const Example = defineComponent(() => {
  const value = signal('');
  const error = signal<string | null>(null);

  return () => (
    <div class="field">
      <Label for="input" class={error() ? 'label-error' : ''}>
        Username
        <span class="required-indicator" aria-label="required">*</span>
      </Label>
      <Input
        id="input"
        value={value()}
        onChange={value.set}
        invalid={!!error()}
        aria-invalid={!!error()}
        aria-describedby={error() ? 'input-error' : undefined}
      />
      {error() && (
        <span id="input-error" class="error-message" role="alert">
          {error()}
        </span>
      )}
    </div>
  );
});
```

#### Best Practices

1. **Always Provide Labels**
   - Every form control must have an associated label
   - Use `Label` with `for` attribute or `aria-label` on the control
   - Never rely solely on placeholders as labels

2. **Use Semantic HTML**
   - Use `<Label>` for actual form labels
   - Use `aria-label` or `aria-labelledby` only when visual labels aren't suitable
   - Maintain the semantic relationship between labels and controls

3. **Required Field Indicators**
   - Show visual indicator (asterisk, badge, text)
   - Add `aria-label="required"` to the indicator
   - Set `required` or `aria-required="true"` on the control
   - Consider indicating optional fields instead if most are required

4. **Disabled State Handling**
   - Apply disabled styling to both label and control
   - Ensure the visual relationship is clear
   - Consider using opacity or color changes
   - Maintain sufficient contrast even when disabled

5. **Click Target Size**
   - Ensure labels have adequate click area
   - Minimum 44×44px touch target for mobile
   - Add padding to increase clickable area if needed
   - Consider the entire field row as interactive

6. **Help Text and Descriptions**
   - Place help text near the label or below the input
   - Use `aria-describedby` to associate help text with the control
   - Keep help text concise and actionable
   - Show help text before the user makes an error

7. **Error Messages**
   - Associate errors using `aria-describedby`
   - Use `role="alert"` for dynamic error messages
   - Place errors near the field they describe
   - Ensure errors are visible and meet contrast requirements

8. **Label Positioning**
   - Top-aligned labels are generally most accessible
   - Left-aligned labels work for short forms with predictable input
   - Inline labels (for checkboxes/switches) should be properly associated
   - Maintain consistent alignment throughout the form

9. **Multi-Language Support**
   - Design for text expansion (labels can grow 30-50% when translated)
   - Avoid fixed widths on labels
   - Test with longer text strings
   - Ensure required indicators work in RTL languages

10. **Group Labels**
    - Use fieldset/legend for related controls
    - Provide both group label and individual labels
    - Use `aria-labelledby` to reference group labels when needed
    - Ensure screen readers announce both group and individual context

---

