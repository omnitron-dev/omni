### Command Palette

A searchable command menu for quick actions (like VS Code's command palette).

#### Features

- Fuzzy search
- Keyboard shortcuts display
- Command groups
- Recent commands
- Custom filtering and ranking
- Icons and descriptions

#### Basic Usage

```typescript
import { defineComponent, signal, effect } from 'aether';
import { CommandPalette } from 'aether/primitives';

export const BasicCommandPalette = defineComponent(() => {
  const isOpen = signal(false);
  const searchQuery = signal('');

  // Listen for Cmd+K / Ctrl+K
  effect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        isOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return () => (
    <CommandPalette bind:open={isOpen}>
      <CommandPalette.Dialog>
        <CommandPalette.Input
          placeholder="Type a command or search..."
          bind:value={searchQuery}
          class="command-input"
        />

        <CommandPalette.List class="command-list">
          <CommandPalette.Empty class="command-empty">
            No results found
          </CommandPalette.Empty>

          <CommandPalette.Group heading="Suggestions" class="command-group">
            <CommandPalette.Item
              value="new-file"
              onSelect={() => createNewFile()}
              class="command-item"
            >
              <FileIcon />
              <span>New File</span>
              <CommandPalette.Shortcut class="command-shortcut">
                ⌘N
              </CommandPalette.Shortcut>
            </CommandPalette.Item>

            <CommandPalette.Item
              value="open-file"
              onSelect={() => openFile()}
              class="command-item"
            >
              <FolderIcon />
              <span>Open File</span>
              <CommandPalette.Shortcut>⌘O</CommandPalette.Shortcut>
            </CommandPalette.Item>

            <CommandPalette.Item
              value="save"
              onSelect={() => save()}
              class="command-item"
            >
              <SaveIcon />
              <span>Save</span>
              <CommandPalette.Shortcut>⌘S</CommandPalette.Shortcut>
            </CommandPalette.Item>
          </CommandPalette.Group>

          <CommandPalette.Separator class="command-separator" />

          <CommandPalette.Group heading="Settings" class="command-group">
            <CommandPalette.Item value="settings" class="command-item">
              <SettingsIcon />
              <span>Preferences</span>
            </CommandPalette.Item>

            <CommandPalette.Item value="theme" class="command-item">
              <PaletteIcon />
              <span>Change Theme</span>
            </CommandPalette.Item>
          </CommandPalette.Group>
        </CommandPalette.List>
      </CommandPalette.Dialog>
    </CommandPalette>
  );
});
```

#### Advanced: Dynamic Commands

```typescript
import { defineComponent, signal, computed, type Component } from 'aether';
import { CommandPalette } from 'aether/primitives';

interface Command {
  id: string;
  label: string;
  icon?: Component;
  shortcut?: string;
  action: () => void;
  keywords?: string[];
}

const DynamicCommandPalette = defineComponent(() => {
  const commands: Command[] = [
    {
      id: 'new-file',
      label: 'New File',
      icon: FileIcon,
      shortcut: '⌘N',
      action: () => createNewFile(),
      keywords: ['create', 'file']
    },
    {
      id: 'search',
      label: 'Search Files',
      icon: SearchIcon,
      shortcut: '⌘P',
      action: () => searchFiles(),
      keywords: ['find', 'locate']
    }
    // ... more commands
  ];

  const isOpen = signal(false);
  const searchQuery = signal('');

  // Fuzzy search with ranking
  const filteredCommands = computed(() => {
    const query = searchQuery().toLowerCase();
    if (!query) return commands;

    return commands
      .map(cmd => {
        const labelMatch = fuzzyMatch(query, cmd.label.toLowerCase());
        const keywordMatch = cmd.keywords?.some(k =>
          fuzzyMatch(query, k)
        );

        if (!labelMatch && !keywordMatch) return null;

        return {
          ...cmd,
          score: labelMatch ? labelMatch.score : 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score);
  });

  const fuzzyMatch = (query: string, text: string) => {
    let queryIdx = 0;
    let score = 0;

    for (let i = 0; i < text.length && queryIdx < query.length; i++) {
      if (text[i] === query[queryIdx]) {
        queryIdx++;
        score += 1;
      }
    }

    return queryIdx === query.length ? { score } : null;
  };

  return () => (
    <CommandPalette bind:open={isOpen}>
      <CommandPalette.Dialog>
        <CommandPalette.Input
          placeholder="Type a command..."
          bind:value={searchQuery}
        />

        <CommandPalette.List>
          {#if filteredCommands().length > 0}
            {#each filteredCommands() as command}
              <CommandPalette.Item
                value={command.id}
                onSelect={() => {
                  command.action();
                  isOpen(false);
                }}
                class="command-item"
              >
                {#if command.icon}
                  <command.icon />
                {/if}
                <span>{command.label}</span>
                {#if command.shortcut}
                  <CommandPalette.Shortcut>
                    {command.shortcut}
                  </CommandPalette.Shortcut>
                {/if}
              </CommandPalette.Item>
            {/each}
          {:else}
            <CommandPalette.Empty>
              No commands found
            </CommandPalette.Empty>
          {/if}
        </CommandPalette.List>
      </CommandPalette.Dialog>
    </CommandPalette>
  );
});
```

#### Styling Example

```css
.command-input {
  width: 100%;
  padding: var(--spacing-4);

  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border);

  font-size: var(--font-size-base);
  color: var(--color-text-primary);

  outline: none;
}

.command-input::placeholder {
  color: var(--color-text-placeholder);
}

.command-list {
  max-height: 400px;
  overflow-y: auto;
  padding: var(--spacing-2);
}

.command-group {
  padding: var(--spacing-2) 0;
}

.command-group[data-heading]::before {
  content: attr(data-heading);
  display: block;
  padding: var(--spacing-2) var(--spacing-3);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.command-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);

  padding: var(--spacing-2) var(--spacing-3);
  border-radius: var(--radius-md);

  font-size: var(--font-size-sm);
  color: var(--color-text-primary);

  cursor: pointer;
  outline: none;

  transition: background-color var(--transition-fast);
}

.command-item:hover,
.command-item[data-selected="true"] {
  background: var(--color-background-secondary);
}

.command-shortcut {
  margin-left: auto;
  padding: var(--spacing-1) var(--spacing-2);

  background: var(--color-background-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);

  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  color: var(--color-text-secondary);
}

.command-empty {
  padding: var(--spacing-8) var(--spacing-4);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.command-separator {
  height: 1px;
  background: var(--color-border);
  margin: var(--spacing-2) 0;
}
```

#### API Reference

**`<CommandPalette>`** - Root component

Props:
- `open?: Signal<boolean>` - Controlled open state
- `onOpenChange?: (open: boolean) => void`

**`<CommandPalette.Dialog>`** - Dialog container

**`<CommandPalette.Input>`** - Search input

Props:
- `value?: Signal<string>` - Search query
- `placeholder?: string`

**`<CommandPalette.List>`** - Command list container

**`<CommandPalette.Empty>`** - Shown when no results

**`<CommandPalette.Group>`** - Command group

Props:
- `heading?: string` - Group heading

**`<CommandPalette.Item>`** - Command item

Props:
- `value: string` - Command identifier
- `onSelect?: () => void` - Called when selected
- `disabled?: boolean`
- `keywords?: string[]` - For search matching

**`<CommandPalette.Separator>`** - Visual separator

**`<CommandPalette.Shortcut>`** - Keyboard shortcut display

---

