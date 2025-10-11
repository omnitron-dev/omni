### Editable

**Inline text editing component with click-to-edit pattern.**

**Features:**
- Click to edit pattern for inline editing
- Enter to submit, Escape to cancel
- Auto-focus on edit mode with text selection
- Submit on blur option
- Custom validation support
- Preview and edit states
- Controlled and uncontrolled modes
- ARIA support for editable content

**Basic Usage:**

```tsx
<Editable defaultValue="Click to edit">
  <Editable.Preview />
  <Editable.Input />
  <Editable.Controls>
    <Editable.Submit />
    <Editable.Cancel />
  </Editable.Controls>
</Editable>
```

**Advanced Usage:**

```tsx
// Inline title editor with validation
<Editable
  value={title()}
  onValueChange={setTitle}
  placeholder="Enter title..."
  submitOnBlur={false}
  selectOnFocus={true}
  validator={(value) => {
    if (value.length < 3) return false;
    if (value.length > 100) return false;
    return true;
  }}
  onEdit={() => console.log('Started editing')}
  onSubmit={(value) => {
    saveTitle(value);
    showToast({ title: 'Title saved!' });
  }}
  onCancel={() => console.log('Cancelled editing')}
>
  <div class="editable-container">
    <Editable.Preview class="title-preview">
      {title() || 'No title set'}
    </Editable.Preview>

    <Editable.Input
      class="title-input"
      placeholder="Enter title..."
    />

    <Editable.Controls class="edit-controls">
      <Editable.Submit class="btn-submit">
        <CheckIcon /> Save
      </Editable.Submit>
      <Editable.Cancel class="btn-cancel">
        <XIcon /> Cancel
      </Editable.Cancel>
    </Editable.Controls>
  </div>

  <Show when={title().length > 0}>
    <div class="character-count">
      {title().length} / 100 characters
    </div>
  </Show>
</Editable>
```

**API:**

**`<Editable>`** - Root container
- `value?: string` - Controlled value
- `onValueChange?: (value: string) => void` - Value change callback
- `defaultValue?: string` - Default value (uncontrolled)
- `placeholder?: string` - Placeholder text
- `disabled?: boolean` - Disabled state
- `startWithEditView?: boolean` - Start in edit mode (default: false)
- `submitOnBlur?: boolean` - Submit when input loses focus (default: true)
- `selectOnFocus?: boolean` - Select text on focus (default: true)
- `validator?: (value: string) => boolean` - Custom validator
- `onEdit?: () => void` - Called when editing starts
- `onSubmit?: (value: string) => void` - Called on submit
- `onCancel?: () => void` - Called on cancel

**`<Editable.Preview>`** - Preview state (shown when not editing)

**`<Editable.Input>`** - Input field (shown when editing)

**`<Editable.Controls>`** - Edit controls container

**`<Editable.Submit>`** - Submit button

**`<Editable.Cancel>`** - Cancel button

---

