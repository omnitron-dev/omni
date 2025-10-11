### MultiSelect

**Select component that allows multiple value selection with search and filtering.**

**Features:**
- Multiple value selection with checkboxes
- Search/filter options in real-time
- Select all / Clear all actions
- Maximum selections limit
- Keyboard navigation for accessibility
- Item indicators for selected state
- Controlled and uncontrolled modes
- ARIA multi-select support

**Basic Usage:**

```tsx
<MultiSelect
  defaultValue={['option1', 'option3']}
  onValueChange={(values) => console.log(values)}
>
  <MultiSelect.Trigger>
    <MultiSelect.Value placeholder="Select items..." />
  </MultiSelect.Trigger>

  <MultiSelect.Content>
    <MultiSelect.Search placeholder="Search..." />
    <MultiSelect.Actions />

    <MultiSelect.Item value="option1">
      <MultiSelect.ItemIndicator />
      Option 1
    </MultiSelect.Item>
    <MultiSelect.Item value="option2">
      <MultiSelect.ItemIndicator />
      Option 2
    </MultiSelect.Item>
    <MultiSelect.Item value="option3">
      <MultiSelect.ItemIndicator />
      Option 3
    </MultiSelect.Item>
  </MultiSelect.Content>
</MultiSelect>
```

**Advanced Usage:**

```tsx
// User permissions multi-select with max limit
<MultiSelect
  value={selectedPermissions()}
  onValueChange={setSelectedPermissions}
  maxSelections={5}
  searchable={true}
  searchPlaceholder="Search permissions..."
>
  <MultiSelect.Trigger class="permissions-trigger">
    <MultiSelect.Value placeholder="Select up to 5 permissions">
      {selectedPermissions().length} permissions selected
    </MultiSelect.Value>
  </MultiSelect.Trigger>

  <MultiSelect.Content class="permissions-dropdown">
    <MultiSelect.Search />
    <MultiSelect.Actions>
      <button onClick={() => context.selectAll()}>Select Max</button>
      <button onClick={() => context.clearAll()}>Clear</button>
    </MultiSelect.Actions>

    <For each={permissions}>
      {(permission) => (
        <MultiSelect.Item
          value={permission.id}
          disabled={permission.restricted}
        >
          <MultiSelect.ItemIndicator>✓</MultiSelect.ItemIndicator>
          <div>
            <div class="permission-name">{permission.name}</div>
            <div class="permission-desc">{permission.description}</div>
          </div>
        </MultiSelect.Item>
      )}
    </For>
  </MultiSelect.Content>
</MultiSelect>
```

**API:**

**`<MultiSelect>`** - Root container
- `value?: string[]` - Controlled selected values
- `onValueChange?: (value: string[]) => void` - Value change callback
- `defaultValue?: string[]` - Default value (uncontrolled)
- `placeholder?: string` - Placeholder text
- `disabled?: boolean` - Disabled state
- `maxSelections?: number` - Maximum selections (0 = unlimited)
- `searchable?: boolean` - Whether to show search input
- `searchPlaceholder?: string` - Search placeholder text

**`<MultiSelect.Trigger>`** - Trigger button to open dropdown

**`<MultiSelect.Value>`** - Display selected values
- `placeholder?: string` - Placeholder when no items selected

**`<MultiSelect.Content>`** - Dropdown content

**`<MultiSelect.Search>`** - Search input (only shown if searchable=true)
- `placeholder?: string` - Search placeholder

**`<MultiSelect.Item>`** - Selectable item
- `value: string` - Item value (required)
- `disabled?: boolean` - Disabled state

**`<MultiSelect.ItemIndicator>`** - Checkbox indicator for selected state

**`<MultiSelect.Actions>`** - Select all/Clear all action buttons

---

