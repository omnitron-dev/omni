### Kbd

Semantic component for displaying keyboard input and keyboard shortcuts.

#### Features

- Semantic HTML with `<kbd>` element
- Support for nested key combinations
- Platform-specific modifier keys
- Accessible to screen readers
- Customizable via CSS
- Data attributes for styling hooks

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Kbd } from 'aether/primitives';

// Single key
export const SingleKeyExample = defineComponent(() => {
  return () => (
    <p>
      Press <Kbd>Enter</Kbd> to submit the form.
    </p>
  );
});

// Key combination
export const KeyCombinationExample = defineComponent(() => {
  return () => (
    <p>
      Press <Kbd>Ctrl</Kbd> + <Kbd>C</Kbd> to copy the selected text.
    </p>
  );
});
```

#### Nested Key Combinations

```typescript
// Nested kbd elements for visual grouping
export const NestedKeysExample = defineComponent(() => {
  return () => (
    <div class="shortcuts">
      <p>
        Search: <Kbd><Kbd>⌘</Kbd><Kbd>K</Kbd></Kbd>
      </p>
      <p>
        Save: <Kbd><Kbd>Ctrl</Kbd><Kbd>S</Kbd></Kbd>
      </p>
      <p>
        Close Tab: <Kbd><Kbd>Ctrl</Kbd><Kbd>W</Kbd></Kbd>
      </p>
    </div>
  );
});
```

#### Platform-Specific Shortcuts

```typescript
import { signal, createMemo } from 'aether';

export const PlatformShortcuts = defineComponent(() => {
  const platform = signal(
    navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'windows'
  );

  const modifierKey = createMemo(() =>
    platform() === 'mac' ? '⌘' : 'Ctrl'
  );

  return () => (
    <div class="shortcuts-guide">
      <h3>Keyboard Shortcuts</h3>
      <dl>
        <dt>Copy</dt>
        <dd>
          <Kbd><Kbd>{modifierKey()}</Kbd><Kbd>C</Kbd></Kbd>
        </dd>

        <dt>Paste</dt>
        <dd>
          <Kbd><Kbd>{modifierKey()}</Kbd><Kbd>V</Kbd></Kbd>
        </dd>

        <dt>Undo</dt>
        <dd>
          <Kbd><Kbd>{modifierKey()}</Kbd><Kbd>Z</Kbd></Kbd>
        </dd>

        <dt>Redo</dt>
        <dd>
          <Kbd>
            <Kbd>{modifierKey()}</Kbd>
            <Kbd>Shift</Kbd>
            <Kbd>Z</Kbd>
          </Kbd>
        </dd>
      </dl>
    </div>
  );
});
```

#### Keyboard Shortcuts Reference

```typescript
export const ShortcutsReference = defineComponent(() => {
  const shortcuts = [
    { action: 'Open Command Palette', keys: ['⌘', 'K'] },
    { action: 'Quick Open', keys: ['⌘', 'P'] },
    { action: 'Toggle Sidebar', keys: ['⌘', 'B'] },
    { action: 'Search in Files', keys: ['⌘', 'Shift', 'F'] },
    { action: 'Go to Line', keys: ['Ctrl', 'G'] },
    { action: 'Toggle Terminal', keys: ['Ctrl', '`'] },
    { action: 'New File', keys: ['⌘', 'N'] },
    { action: 'Close Editor', keys: ['⌘', 'W'] },
    { action: 'Format Document', keys: ['Shift', 'Alt', 'F'] },
    { action: 'Select All', keys: ['⌘', 'A'] },
  ];

  return () => (
    <div class="shortcuts-table">
      <h2>Editor Shortcuts</h2>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Shortcut</th>
          </tr>
        </thead>
        <tbody>
          {shortcuts.map((shortcut) => (
            <tr>
              <td>{shortcut.action}</td>
              <td>
                <Kbd>
                  {shortcut.keys.map((key) => (
                    <Kbd>{key}</Kbd>
                  ))}
                </Kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
```

#### Interactive Tutorial

```typescript
export const InteractiveTutorial = defineComponent(() => {
  const currentStep = signal(0);
  const completed = signal(false);

  const steps = [
    {
      instruction: 'Press the Escape key to continue',
      key: 'Escape',
    },
    {
      instruction: 'Press Ctrl + S to save',
      key: 'Control+s',
    },
    {
      instruction: 'Press Enter to finish',
      key: 'Enter',
    },
  ];

  const handleKeyPress = (event: KeyboardEvent) => {
    const current = steps[currentStep()];
    const expectedKey = current.key.toLowerCase();
    const pressedKey = event.ctrlKey
      ? `control+${event.key.toLowerCase()}`
      : event.key.toLowerCase();

    if (pressedKey === expectedKey) {
      if (currentStep() < steps.length - 1) {
        currentStep(currentStep() + 1);
      } else {
        completed(true);
      }
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyPress);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyPress);
  });

  return () => {
    if (completed()) {
      return (
        <div class="tutorial-complete">
          <h3>Tutorial Complete!</h3>
          <p>You've mastered the keyboard shortcuts.</p>
        </div>
      );
    }

    const current = steps[currentStep()];
    return (
      <div class="tutorial">
        <div class="progress">
          Step {currentStep() + 1} of {steps.length}
        </div>
        <div class="instruction">
          <p>{current.instruction}</p>
          <div class="expected-key">
            {current.key.includes('+') ? (
              <Kbd>
                {current.key.split('+').map((key) => (
                  <Kbd>{key}</Kbd>
                ))}
              </Kbd>
            ) : (
              <Kbd>{current.key}</Kbd>
            )}
          </div>
        </div>
      </div>
    );
  };
});
```

#### Documentation Examples

```typescript
export const KeyboardControls = defineComponent(() => {
  return () => (
    <article class="controls-doc">
      <h2>Media Player Controls</h2>

      <section>
        <h3>Playback</h3>
        <ul>
          <li>
            <Kbd>Space</Kbd> - Play/Pause
          </li>
          <li>
            <Kbd>K</Kbd> - Toggle play/pause
          </li>
          <li>
            <Kbd>J</Kbd> - Rewind 10 seconds
          </li>
          <li>
            <Kbd>L</Kbd> - Forward 10 seconds
          </li>
        </ul>
      </section>

      <section>
        <h3>Volume</h3>
        <ul>
          <li>
            <Kbd>↑</Kbd> - Increase volume
          </li>
          <li>
            <Kbd>↓</Kbd> - Decrease volume
          </li>
          <li>
            <Kbd>M</Kbd> - Toggle mute
          </li>
        </ul>
      </section>

      <section>
        <h3>Display</h3>
        <ul>
          <li>
            <Kbd>F</Kbd> - Toggle fullscreen
          </li>
          <li>
            <Kbd>C</Kbd> - Toggle captions
          </li>
          <li>
            <Kbd>Shift</Kbd> + <Kbd>→</Kbd> - Next video
          </li>
        </ul>
      </section>
    </article>
  );
});
```

#### Styling Example

```css
/* Basic kbd styling */
kbd[data-kbd] {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 0.875em;
  font-weight: 600;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 6px;
  background: linear-gradient(to bottom, #fafafa, #f0f0f0);
  border: 1px solid #d0d0d0;
  border-bottom-width: 2px;
  box-shadow:
    0 1px 0 rgba(0, 0, 0, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  color: #333;
  display: inline-block;
  text-align: center;
  min-width: 1.5em;
  white-space: nowrap;
}

/* Nested kbd (key combinations) */
kbd[data-kbd] kbd[data-kbd] {
  padding: 3px 6px;
  margin: 0 2px;
  font-size: 0.9em;
  border-width: 1px;
  border-bottom-width: 2px;
}

/* Modifier keys */
kbd[data-kbd]:has(> kbd[data-kbd]) {
  padding: 2px;
  background: transparent;
  border: none;
  box-shadow: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Special keys styling */
kbd[data-kbd]:is([data-key="Command"], [data-key="Ctrl"], [data-key="Alt"], [data-key="Shift"]) {
  background: linear-gradient(to bottom, #e8e8e8, #d8d8d8);
  border-color: #b0b0b0;
}

/* Arrow keys */
kbd[data-kbd]:is([data-key="↑"], [data-key="↓"], [data-key="←"], [data-key="→"]) {
  font-size: 1.1em;
  padding: 4px 6px;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  kbd[data-kbd] {
    background: linear-gradient(to bottom, #3a3a3a, #2a2a2a);
    border-color: #555;
    box-shadow:
      0 1px 0 rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
    color: #e0e0e0;
  }

  kbd[data-kbd]:is([data-key="Command"], [data-key="Ctrl"], [data-key="Alt"], [data-key="Shift"]) {
    background: linear-gradient(to bottom, #4a4a4a, #3a3a3a);
    border-color: #666;
  }
}

/* Focus state for interactive keys */
kbd[data-kbd].active {
  background: linear-gradient(to bottom, #f0f0f0, #e0e0e0);
  border-color: var(--color-primary-500);
  box-shadow:
    0 0 0 2px var(--color-primary-200),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

/* Size variants */
kbd[data-kbd].kbd-sm {
  font-size: 0.75em;
  padding: 2px 6px;
}

kbd[data-kbd].kbd-lg {
  font-size: 1em;
  padding: 6px 12px;
}
```

#### Accessibility

The Kbd component follows semantic HTML standards:

- Uses native `<kbd>` element for keyboard input
- Screen readers announce content as "keyboard key"
- Nested structure preserves key combination semantics
- Visual and semantic representation aligned
- Works with assistive technologies

Best practices:
- Use for actual keyboard input only
- Provide text context around shortcuts
- Group related shortcuts logically
- Consider platform differences (⌘ vs Ctrl)
- Ensure sufficient color contrast
- Test with screen readers

#### API Reference

**`<Kbd>`** - Keyboard key component

Props:
- `children?: any` - Key text or nested Kbd components
- `...HTMLAttributes` - Standard HTML attributes

Data Attributes:
- `data-kbd` - Present on all kbd elements

HTML Output:
```html
<!-- Single key -->
<kbd data-kbd>Enter</kbd>

<!-- Key combination -->
<kbd data-kbd>
  <kbd data-kbd>Ctrl</kbd>
  <kbd data-kbd>C</kbd>
</kbd>
```

#### Common Modifier Keys

```typescript
// Platform-specific modifiers
const modifiers = {
  mac: {
    command: '⌘',
    option: '⌥',
    control: '⌃',
    shift: '⇧',
  },
  windows: {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    win: '⊞',
  },
  linux: {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    super: 'Super',
  },
};

// Special keys
const specialKeys = {
  enter: '↵',
  backspace: '⌫',
  delete: '⌦',
  escape: '⎋',
  tab: '⇥',
  capsLock: '⇪',
  arrowUp: '↑',
  arrowDown: '↓',
  arrowLeft: '←',
  arrowRight: '→',
};
```

#### Best Practices

1. **Use Semantic HTML**
   - Always use Kbd for keyboard input
   - Don't use for buttons or clickable elements
   - Nest for key combinations

2. **Platform Awareness**
   - Detect user platform
   - Show appropriate modifiers (⌘ vs Ctrl)
   - Consider international keyboards

3. **Visual Clarity**
   - Make keys visually distinct
   - Use appropriate sizing
   - Ensure good contrast

4. **Context**
   - Always provide action description
   - Group related shortcuts
   - Use consistent formatting

5. **Accessibility**
   - Provide alternative text when needed
   - Test with screen readers
   - Ensure keyboard navigation works

---
