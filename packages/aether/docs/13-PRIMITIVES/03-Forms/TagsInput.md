### TagsInput

**Input component for creating multiple tags/chips with keyboard support.**

**Features:**
- Create tags by typing and pressing Enter or comma
- Delete tags with Backspace key
- Paste support (automatically splits by delimiter)
- Max tags limit with validation
- Duplicate prevention
- Custom tag validation
- Keyboard navigation
- Controlled and uncontrolled modes
- ARIA support for tag list

**Basic Usage:**

```tsx
<TagsInput
  defaultValue={['tag1', 'tag2']}
  onValueChange={(tags) => console.log(tags)}
>
  <div class="tags-container">
    <For each={context.tags()}>
      {(tag) => (
        <TagsInput.Tag value={tag}>
          {tag}
          <TagsInput.TagRemove value={tag} />
        </TagsInput.Tag>
      )}
    </For>
    <TagsInput.Field placeholder="Add tag..." />
  </div>
</TagsInput>
```

**Advanced Usage:**

```tsx
// Email tags input with validation
<TagsInput
  value={emails()}
  onValueChange={setEmails}
  maxTags={10}
  allowDuplicates={false}
  delimiter={[',', ';', 'Enter']}
  validator={(tag) => {
    if (!/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(tag)) {
      return 'Invalid email format';
    }
    return null;
  }}
  onValidationError={(tag, error) => {
    showToast({ title: 'Invalid Email', description: error });
  }}
  onTagAdd={(tag) => console.log('Added:', tag)}
  onTagRemove={(tag) => console.log('Removed:', tag)}
>
  <div class="email-tags-input">
    <div class="tags-list">
      <For each={emails()}>
        {(email) => (
          <TagsInput.Tag value={email} class="email-tag">
            <span class="email-icon">📧</span>
            {email}
            <TagsInput.TagRemove value={email} class="remove-btn">
              ×
            </TagsInput.TagRemove>
          </TagsInput.Tag>
        )}
      </For>
    </div>
    <TagsInput.Field
      placeholder={
        context.canAddMore()
          ? 'Enter email address...'
          : `Max ${maxTags} emails`
      }
      class="email-input"
    />
    <div class="tag-counter">
      {emails().length} / {maxTags} emails
    </div>
  </div>
</TagsInput>
```

**API:**

**`<TagsInput>`** - Root container
- `value?: string[]` - Controlled tags array
- `onValueChange?: (value: string[]) => void` - Value change callback
- `defaultValue?: string[]` - Default value (uncontrolled)
- `placeholder?: string` - Input placeholder text
- `delimiter?: string | string[]` - Tag delimiter (default: Enter and comma)
- `maxTags?: number` - Maximum number of tags (0 = unlimited)
- `allowDuplicates?: boolean` - Allow duplicate tags (default: false)
- `disabled?: boolean` - Disabled state
- `validator?: (tag: string) => string | null` - Custom validator
- `onTagAdd?: (tag: string) => void` - Called when tag is added
- `onTagRemove?: (tag: string) => void` - Called when tag is removed
- `onValidationError?: (tag: string, error: string) => void` - Validation error callback

**`<TagsInput.Field>`** - Input field for creating new tags
- `placeholder?: string` - Placeholder text

**`<TagsInput.Tag>`** - Tag/chip display
- `value: string` - Tag value (required)

**`<TagsInput.TagRemove>`** - Button to remove a tag
- `value: string` - Tag to remove (required)

---

