## Testing Primitives

### Unit Testing

```typescript
import { render, fireEvent } from '@testing-library/nexus';
import { Dialog } from 'aether/primitives';

describe('Dialog', () => {
  it('opens when trigger is clicked', async () => {
    const { getByRole, queryByRole } = render(() => (
      <Dialog>
        <Dialog.Trigger>Open</Dialog.Trigger>
        <Dialog.Content>Content</Dialog.Content>
      </Dialog>
    ));

    // Initially closed
    expect(queryByRole('dialog')).toBeNull();

    // Click trigger
    await fireEvent.click(getByRole('button', { name: 'Open' }));

    // Now open
    expect(getByRole('dialog')).toBeInTheDocument();
  });

  it('traps focus within dialog', async () => {
    const { getByRole } = render(() => (
      <Dialog defaultOpen>
        <Dialog.Content>
          <button>First</button>
          <button>Last</button>
        </Dialog.Content>
      </Dialog>
    ));

    const dialog = getByRole('dialog');
    const firstButton = getByRole('button', { name: 'First' });
    const lastButton = getByRole('button', { name: 'Last' });

    // Tab from last button should focus first button
    lastButton.focus();
    await fireEvent.keyDown(document, { key: 'Tab' });
    expect(firstButton).toHaveFocus();
  });

  it('closes on Escape key', async () => {
    const { getByRole, queryByRole } = render(() => (
      <Dialog defaultOpen>
        <Dialog.Content>Content</Dialog.Content>
      </Dialog>
    ));

    expect(getByRole('dialog')).toBeInTheDocument();

    await fireEvent.keyDown(document, { key: 'Escape' });

    expect(queryByRole('dialog')).toBeNull();
  });
});
```

### Accessibility Testing

```typescript
import { axe } from 'jest-axe';

it('has no accessibility violations', async () => {
  const { container } = render(() => (
    <Dialog defaultOpen>
      <Dialog.Content>
        <Dialog.Title>Title</Dialog.Title>
        <Dialog.Description>Description</Dialog.Description>
        <p>Content</p>
        <Dialog.Close>Close</Dialog.Close>
      </Dialog.Content>
    </Dialog>
  ));

  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

---

