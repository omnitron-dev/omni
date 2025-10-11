### TimePicker

Time selection component with support for hours, minutes, seconds, and 12/24-hour formats.

#### Features

- 12-hour and 24-hour formats
- Hour, minute, and optional second selection
- AM/PM toggle for 12-hour format
- Configurable step values
- Keyboard navigation
- Scroll-based selection
- Controlled and uncontrolled modes
- Integration with Popover for dropdown

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { TimePicker } from 'aether/primitives';

const Example = defineComponent(() => {
  const time = signal({ hours: 14, minutes: 30, seconds: 0 });

  return () => (
    <TimePicker
      value={time()}
      onValueChange={time}
      hourFormat={24}
    >
      <TimePicker.Trigger class="time-trigger">
        {/* Display formatted time */}
      </TimePicker.Trigger>

      <TimePicker.Content class="time-content">
        <div class="time-columns">
          <TimePicker.Column type="hours" />
          <TimePicker.Column type="minutes" />
        </div>
      </TimePicker.Content>
    </TimePicker>
  );
});
```

#### With Seconds and 12-hour Format

```typescript
const Example = defineComponent(() => {
  return () => (
    <TimePicker
      hourFormat={12}
      showSeconds
      minuteStep={15}
    >
      <TimePicker.Trigger>Select Time</TimePicker.Trigger>
      <TimePicker.Content>
        <TimePicker.Column type="hours" />
        <TimePicker.Column type="minutes" />
        <TimePicker.Column type="seconds" />
        <TimePicker.Column type="period" />
      </TimePicker.Content>
    </TimePicker>
  );
});
```

#### API

**`<TimePicker>`** - Root component
- `value?: TimeValue` - Controlled time value
- `onValueChange?: (value: TimeValue) => void` - Value change callback
- `defaultValue?: TimeValue` - Default value (uncontrolled)
- `hourFormat?: 12 | 24` - Hour format (default: 24)
- `showSeconds?: boolean` - Show seconds column (default: false)
- `hourStep?: number` - Hour step increment (default: 1)
- `minuteStep?: number` - Minute step increment (default: 1)
- `secondStep?: number` - Second step increment (default: 1)
- `disabled?: boolean` - Whether picker is disabled

**`<TimePicker.Trigger>`** - Trigger button to open picker

**`<TimePicker.Content>`** - Content container for time columns

**`<TimePicker.Column>`** - Time column (hours/minutes/seconds/period)
- `type: 'hours' | 'minutes' | 'seconds' | 'period'` - Column type

---

