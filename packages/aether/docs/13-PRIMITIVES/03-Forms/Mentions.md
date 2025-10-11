### Mentions

@mentions autocomplete component for text inputs with search and keyboard navigation.

#### Features

- Autocomplete with search
- Keyboard navigation
- Custom trigger characters (@, #, etc.)
- Position-aware popup
- Mention selection handling
- Custom mention rendering
- Filtering support
- ARIA support

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Mentions } from 'aether/primitives';

const Example229 = defineComponent(() => {
  const value = signal('');
  const mentions = [
    { id: '1', display: 'John Doe', value: '@johndoe' },
    { id: '2', display: 'Jane Smith', value: '@janesmith' },
    { id: '3', display: 'Bob Johnson', value: '@bobjohnson' },
  ];

  return () => (
    <Mentions
      value={value()}
      onValueChange={(newValue) => value.set(newValue)}
      data={mentions}
      trigger="@"
      placeholder="Type @ to mention someone..."
    />
  );
});
```

#### Advanced Usage

```typescript
// Multiple triggers with custom filtering
const Example230 = defineComponent(() => {
  const value = signal('');

  const users = [
    { id: '1', display: 'John Doe', avatar: '/avatars/john.jpg' },
    { id: '2', display: 'Jane Smith', avatar: '/avatars/jane.jpg' },
  ];

  const tags = [
    { id: 't1', display: 'javascript', count: 1234 },
    { id: 't2', display: 'typescript', count: 890 },
  ];

  const handleMentionSelect = (mention) => {
    console.log('Selected:', mention);
  };

  return () => (
    <>
      <Mentions
        value={value()}
        onValueChange={(newValue) => value.set(newValue)}
        data={users}
        trigger="@"
        onMentionSelect={handleMentionSelect}
        placeholder="Type @ for users or # for tags..."
      >
        <Mentions.Trigger />
        <Mentions.List>
          <For each={users}>
            {(user) => (
              <Mentions.Item value={user}>
                <div class="mention-item">
                  <img src={user.avatar} alt={user.display} />
                  <span>{user.display}</span>
                </div>
              </Mentions.Item>
            )}
          </For>
        </Mentions.List>
      </Mentions>
    </>
  );
});
```

**API:**

**`<Mentions>`** - Root container
- `value?: string` - Controlled value
- `onValueChange?: (value: string) => void` - Value change callback
- `defaultValue?: string` - Initial value (uncontrolled)
- `data: Mention[]` - Array of mention options
- `trigger?: string` - Trigger character (default: '@')
- `onMentionSelect?: (mention: Mention) => void` - Selection callback
- `placeholder?: string` - Input placeholder

**`<Mentions.Trigger>`** - Trigger input field

**`<Mentions.List>`** - Mentions dropdown list

**`<Mentions.Item>`** - Individual mention item
- `value: Mention` - Mention data

---

