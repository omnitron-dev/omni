# Calendar and wall-clock inputs

`PrismDatePicker`, `PrismTimePicker` and `PrismDateTimePicker` are exported from
`@omnitron-dev/prism/ui`. They use MUI X segmented fields, calendar/clock dialogs,
keyboard navigation and the active `PrismProvider` locale.

The value contract is deliberately not an instant:

- Date: `YYYY-MM-DD`.
- Time: `HH:mm`, or `HH:mm:ss` with `precision="second"`.
- Local date-time: `YYYY-MM-DDTHH:mm`, optionally seconds.
- Cleared value: `''`.

The UTC picker carrier prevents the browser's zone or DST from rewriting source
calendar/wall values. The component never emits an ISO timestamp or resolves a
zone. Scheduling features must explicitly resolve the selected wall time in their
intended zone, rejecting gaps or handling overlaps according to their own contract.

Invalid and partial drafts stay visible. They emit an empty serialized value and
set native form validity, so the previous valid value cannot be submitted. Full
clear removes the error; `required` still controls whether empty is allowed.
`onValidityChange` is available for forms that submit programmatically rather than
through the native HTML form. `invalidText` must be localized by the application.

Use `dateAdapterLocale` and `dateLocaleText` on `PrismProvider` to switch calendar
labels, masks and accessible text together. `datePickerRuRU` and `datePickerEnUS`
are exported alongside the controls; importing the controls registers the Russian
Dayjs locale without changing Dayjs's global locale.

```tsx
<PrismDatePicker
  label="Birth date"
  value={date}
  onChange={setDate}
  invalidText="Enter a valid date."
  min="1900-01-01"
  max="2100-12-31"
/>
```

The desktop popup uses Popper's viewport collision handling on both axes. When
neither side of an anchor has enough space, it can overlap the anchor instead of
clipping the actions outside the viewport. Very small viewports constrain the
paper and scroll its content; the background page need not be scrolled to reach
picker controls.
