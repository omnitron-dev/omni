### DateRangePicker

Date range selection component with visual range highlighting and preset support.

#### Features

- Start and end date selection
- Visual range highlighting
- Hover preview of range
- Preset ranges (Today, Last 7 days, etc.)
- Min/max date constraints
- Multiple months display
- Controlled and uncontrolled modes
- ARIA date picker pattern

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { DateRangePicker } from 'aether/primitives';

const Example = defineComponent(() => {
  const range = signal<DateRange>({ start: null, end: null });

  return () => (
    <DateRangePicker
      value={range()}
      onValueChange={range}
      numberOfMonths={2}
    >
      <DateRangePicker.Trigger class="range-trigger">
        {/* Display formatted range */}
      </DateRangePicker.Trigger>

      <DateRangePicker.Content class="range-content">
        <div class="range-presets">
          <DateRangePicker.Preset
            range={{
              start: new Date(),
              end: new Date()
            }}
          >
            Today
          </DateRangePicker.Preset>
          <DateRangePicker.Preset
            range={{
              start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              end: new Date()
            }}
          >
            Last 7 days
          </DateRangePicker.Preset>
        </div>

        <div class="range-calendars">
          <DateRangePicker.Calendar monthOffset={0} />
          <DateRangePicker.Calendar monthOffset={1} />
        </div>
      </DateRangePicker.Content>
    </DateRangePicker>
  );
});
```

#### With Presets

```typescript
const presets = [
  { label: 'Today', range: { start: new Date(), end: new Date() } },
  { label: 'Yesterday', range: { /* ... */ } },
  { label: 'Last 7 days', range: { /* ... */ } },
  { label: 'Last 30 days', range: { /* ... */ } },
  { label: 'This month', range: { /* ... */ } },
];

const Example = defineComponent(() => {
  return () => (
    <DateRangePicker presets={presets}>
      {/* ... */}
    </DateRangePicker>
  );
});
```

#### API

**`<DateRangePicker>`** - Root component
- `value?: DateRange` - Controlled value
- `onValueChange?: (value: DateRange) => void` - Value change callback
- `defaultValue?: DateRange` - Default value (uncontrolled)
- `min?: Date` - Minimum selectable date
- `max?: Date` - Maximum selectable date
- `numberOfMonths?: number` - Months to display (default: 2)
- `disabled?: boolean` - Whether picker is disabled
- `closeOnSelect?: boolean` - Close on range selection (default: true)

**`<DateRangePicker.Trigger>`** - Trigger button to open picker

**`<DateRangePicker.Content>`** - Content container for calendars

**`<DateRangePicker.Calendar>`** - Calendar display
- `monthOffset?: number` - Month offset (0 for first, 1 for second, etc.)

**`<DateRangePicker.Preset>`** - Preset range button
- `range: DateRange` - Preset date range

---

