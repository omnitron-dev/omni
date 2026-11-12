# Date and time inputs

`PrismDatePicker`, `PrismTimePicker`, and `PrismDateTimePicker` are exported from `@omnitron-dev/prism/ui`. They use string values so forms can preserve calendar and wall-clock values without converting them into timezone-dependent instants.

| Component | Value |
| --- | --- |
| `PrismDatePicker` | `YYYY-MM-DD` |
| `PrismTimePicker` | `HH:mm`, or `HH:mm:ss` with second precision |
| `PrismDateTimePicker` | `YYYY-MM-DDTHH:mm`, optionally including seconds |
| Any cleared input | `''` |

```tsx
import { useState } from 'react';
import { PrismDatePicker } from '@omnitron-dev/prism/ui';

export function DueDate() {
  const [value, setValue] = useState('');
  return (
    <PrismDatePicker
      label="Due date"
      invalidText="Enter a valid date"
      value={value}
      onChange={setValue}
    />
  );
}
```

Partial or invalid drafts stay visible, emit an empty value, and set native validity. Clearing the field removes the format error; `required` still determines whether an empty field is allowed. Use `onValidityChange` when submission is controlled outside a native form.

Set `dateAdapterLocale` and `dateLocaleText` on `PrismProvider` for shared localization. `datePickerEnUS` and `datePickerRuRU` are exported alongside the components; use `invalidText` for the validation message.

[Props and implementation](date-input.tsx) define precision, bounds, and responsive behavior. [The public barrel](index.ts) lists the supported exports.
