### Calendar

Standalone calendar component (used by DatePicker).

#### Features

- Single/multi/range selection
- Month/year navigation
- Disabled dates
- Custom rendering
- Multiple months
- Keyboard navigation

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Calendar } from 'aether/primitives';

const Example105 = defineComponent(() => {
  const selectedDate = signal<Date>(new Date());

  return () => (
    <Calendar bind:value={selectedDate} class="calendar">
      <Calendar.Header class="calendar-header">
        <Calendar.PrevButton class="calendar-nav-btn">
          <ChevronLeftIcon />
        </Calendar.PrevButton>
        <Calendar.Heading class="calendar-heading" />
        <Calendar.NextButton class="calendar-nav-btn">
          <ChevronRightIcon />
        </Calendar.NextButton>
      </Calendar.Header>
      <Calendar.Grid class="calendar-grid">
        <Calendar.GridHead class="calendar-grid-head">
          <Calendar.HeadCell>Su</Calendar.HeadCell>
          <Calendar.HeadCell>Mo</Calendar.HeadCell>
          <Calendar.HeadCell>Tu</Calendar.HeadCell>
          <Calendar.HeadCell>We</Calendar.HeadCell>
          <Calendar.HeadCell>Th</Calendar.HeadCell>
          <Calendar.HeadCell>Fr</Calendar.HeadCell>
          <Calendar.HeadCell>Sa</Calendar.HeadCell>
        </Calendar.GridHead>
        <Calendar.GridBody class="calendar-grid-body">
          <!-- Auto-generated cells for current month -->
        </Calendar.GridBody>
      </Calendar.Grid>
    </Calendar>
  );
});
```

#### Multi-Select

```typescript
import { defineComponent, signal } from 'aether';
const Example861 = defineComponent(() => {
  const selectedDates = signal<Date[]>([new Date()]);

  return () => (
    <Calendar
      mode="multiple"
      bind:value={selectedDates}
      class="calendar"
    >
      <!-- ... -->
    </Calendar>
  );
});
```

#### Styling Example

```css
.calendar {
  width: 280px;
  padding: var(--spacing-3);

  background: var(--color-background-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  margin-bottom: var(--spacing-2);
}

.calendar-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;

  width: 32px;
  height: 32px;

  background: transparent;
  border: none;
  border-radius: var(--radius-sm);

  color: var(--color-text-secondary);
  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.calendar-nav-btn:hover {
  background: var(--color-background-secondary);
}

.calendar-heading {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.calendar-grid {
  width: 100%;
}

.calendar-grid-head {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: var(--spacing-1);
}

.calendar-grid-head > * {
  display: flex;
  align-items: center;
  justify-content: center;

  height: 32px;

  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.calendar-grid-body {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--spacing-1);
}

.calendar-cell {
  display: flex;
  align-items: center;
  justify-content: center;

  height: 32px;

  background: transparent;
  border: none;
  border-radius: var(--radius-sm);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);

  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.calendar-cell:hover {
  background: var(--color-background-secondary);
}

.calendar-cell:focus-visible {
  box-shadow: 0 0 0 2px var(--color-primary-500);
}

.calendar-cell[data-selected="true"] {
  background: var(--color-primary-500);
  color: white;
}

.calendar-cell[data-today="true"] {
  font-weight: var(--font-weight-semibold);
  position: relative;
}

.calendar-cell[data-today="true"]::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);

  width: 4px;
  height: 4px;

  background: currentColor;
  border-radius: 50%;
}

.calendar-cell[data-outside-month="true"] {
  color: var(--color-text-disabled);
}

.calendar-cell[data-disabled="true"] {
  color: var(--color-text-disabled);
  cursor: not-allowed;
  pointer-events: none;
}

.calendar-cell[data-range-start="true"],
.calendar-cell[data-range-end="true"] {
  background: var(--color-primary-500);
  color: white;
}

.calendar-cell[data-range-middle="true"] {
  background: var(--color-primary-100);
  color: var(--color-primary-900);
  border-radius: 0;
}
```

#### API Reference

**`<Calendar>`** - Calendar component

Props:
- `mode?: 'single' | 'multiple' | 'range'` - Selection mode (default: 'single')
- `value?: Signal<Date | Date[] | DateRange>` - Selected date(s)
- `defaultValue?: Date | Date[] | DateRange` - Initial value
- `onValueChange?: (value: Date | Date[] | DateRange) => void`
- `min?: Date` - Minimum date
- `max?: Date` - Maximum date
- `isDateDisabled?: (date: Date) => boolean`
- `locale?: string`
- `weekStartsOn?: 0 | 1`
- `numberOfMonths?: number` - Display multiple months (default: 1)

**`<Calendar.Header>`** - Month/year navigation

**`<Calendar.PrevButton>`** - Previous month

**`<Calendar.NextButton>`** - Next month

**`<Calendar.Heading>`** - Current month/year

**`<Calendar.Grid>`** - Calendar grid

**`<Calendar.GridHead>`** - Day headers

**`<Calendar.HeadCell>`** - Day name

**`<Calendar.GridBody>`** - Date cells

**`<Calendar.Cell>`** - Individual date

Props:
- `date: Date` - The date for this cell

---

