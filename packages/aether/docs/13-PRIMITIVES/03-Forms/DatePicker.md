### DatePicker

A date input with calendar dropdown.

#### Features

- Calendar popup
- Date range selection
- Min/max dates
- Disabled dates
- Custom date formatting
- Keyboard navigation
- Multi-month display
- Preset ranges

#### Basic Usage (Single Date)

```typescript
import { defineComponent, signal } from 'aether';
import { DatePicker } from 'aether/primitives';

const DatePickerExample = defineComponent(() => {
  const selectedDate = signal<Date | null>(new Date());

  return () => (
    <DatePicker bind:value={selectedDate}>
      <DatePicker.Trigger class="datepicker-trigger">
        <CalendarIcon />
        <DatePicker.Value>
          {#if selectedDate()}
            {formatDate(selectedDate(), 'MMM dd, yyyy')}
          {:else}
            <span class="placeholder">Pick a date</span>
          {/if}
        </DatePicker.Value>
      </DatePicker.Trigger>

      <DatePicker.Content class="datepicker-content">
        <DatePicker.Calendar class="calendar">
          <DatePicker.Header class="calendar-header">
            <DatePicker.PrevButton class="calendar-nav-btn">
              <ChevronLeftIcon />
            </DatePicker.PrevButton>
            <DatePicker.Heading class="calendar-heading" />
            <DatePicker.NextButton class="calendar-nav-btn">
              <ChevronRightIcon />
            </DatePicker.NextButton>
          </DatePicker.Header>

          <DatePicker.Grid class="calendar-grid">
            <DatePicker.GridHead class="calendar-grid-head">
              <DatePicker.HeadCell>Su</DatePicker.HeadCell>
              <DatePicker.HeadCell>Mo</DatePicker.HeadCell>
              <DatePicker.HeadCell>Tu</DatePicker.HeadCell>
              <DatePicker.HeadCell>We</DatePicker.HeadCell>
              <DatePicker.HeadCell>Th</DatePicker.HeadCell>
              <DatePicker.HeadCell>Fr</DatePicker.HeadCell>
              <DatePicker.HeadCell>Sa</DatePicker.HeadCell>
            </DatePicker.GridHead>
            <DatePicker.GridBody class="calendar-grid-body">
              <!-- Generated date cells -->
            </DatePicker.GridBody>
          </DatePicker.Grid>
        </DatePicker.Calendar>
      </DatePicker.Content>
    </DatePicker>
  );
});
```

#### Date Range Selection

```typescript
import { defineComponent, signal } from 'aether';
import { DateRangePicker } from 'aether/primitives';

const Example333 = defineComponent(() => {
  interface DateRange {
    from: Date | null;
    to: Date | null;
  }
  const dateRange = signal<DateRange>({
    from: new Date(),
    to: addDays(new Date(), 7)
  });

  return () => (
    <DateRangePicker bind:value={dateRange}>
      <DateRangePicker.Trigger class="datepicker-trigger">
        <CalendarIcon />
        <DateRangePicker.Value>
          {#if dateRange().from && dateRange().to}
            {formatDate(dateRange().from, 'MMM dd')}
            {' - '}
            {formatDate(dateRange().to, 'MMM dd, yyyy')}
          {:else}
            <span class="placeholder">Pick a date range</span>
          {/if}
        </DateRangePicker.Value>
      </DateRangePicker.Trigger>
      <DateRangePicker.Content class="datepicker-content">
        <!-- Preset ranges -->
        <div class="date-presets">
          <button
            on:click={() => dateRange({ from: new Date(), to: new Date() })}
            class="preset-btn"
          >
            Today
          </button>
          <button
            on:click={() => dateRange({
              from: startOfWeek(new Date()),
              to: endOfWeek(new Date())
            })}
            class="preset-btn"
          >
            This Week
          </button>
          <button
            on:click={() => dateRange({
              from: startOfMonth(new Date()),
              to: endOfMonth(new Date())
            })}
            class="preset-btn"
          >
            This Month
          </button>
        </div>
        <!-- Two month display -->
        <div class="calendar-months">
          <DateRangePicker.Calendar month={0} />
          <DateRangePicker.Calendar month={1} />
        </div>
      </DateRangePicker.Content>
    </DateRangePicker>
  );
});
```

#### With Disabled Dates

```typescript
import { defineComponent, signal } from 'aether';
const Example438 = defineComponent(() => {
  const selectedDate = signal<Date | null>(null);
  const isWeekend = (date: Date) => {
    const day = date.getDay();
    return day === 0 || day === 6;
  };
  const isPast = (date: Date) => {
    return date < new Date();
  };
  const isDisabled = (date: Date) => {
    return isWeekend(date) || isPast(date);
  };

  return () => (
    <DatePicker bind:value={selectedDate} isDateDisabled={isDisabled}>
      <!-- ... -->
    </DatePicker>
  );
});
```

#### API Reference

**`<DatePicker>`** - Root component

Props:
- `value?: Signal<Date | null>` - Controlled selected date
- `defaultValue?: Date` - Initial date
- `onValueChange?: (date: Date | null) => void`
- `min?: Date` - Minimum selectable date
- `max?: Date` - Maximum selectable date
- `isDateDisabled?: (date: Date) => boolean` - Custom disable logic
- `locale?: string` - Locale for formatting (default: 'en-US')
- `weekStartsOn?: 0 | 1` - Week starts on Sunday (0) or Monday (1)

**`<DatePicker.Trigger>`** - Opens calendar

**`<DatePicker.Value>`** - Displays selected date

**`<DatePicker.Content>`** - Calendar dropdown

**`<DatePicker.Calendar>`** - Calendar component

Props:
- `month?: number` - Month offset from current (for multi-month)

**`<DatePicker.Header>`** - Calendar header (month/year navigation)

**`<DatePicker.PrevButton>`** - Previous month button

**`<DatePicker.NextButton>`** - Next month button

**`<DatePicker.Heading>`** - Current month/year display

**`<DatePicker.Grid>`** - Calendar grid

**`<DatePicker.GridHead>`** - Day name headers

**`<DatePicker.HeadCell>`** - Day name cell

**`<DatePicker.GridBody>`** - Date cells container

**`<DatePicker.Cell>`** - Individual date cell

**`<DateRangePicker>`** - Date range variant

Props:
- `value?: Signal<{ from: Date | null; to: Date | null }>` - Selected range
- Other props same as DatePicker

---

