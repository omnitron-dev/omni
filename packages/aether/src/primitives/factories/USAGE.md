# createOverlayPrimitive Factory - Usage Guide

## Overview

The `createOverlayPrimitive` factory eliminates ~2,000 lines of duplicated code across overlay components (Dialog, AlertDialog, Popover, HoverCard, Sheet, Drawer, ContextMenu, DropdownMenu) by providing a unified way to create overlay primitives with different behaviors.

## Quick Start

```typescript
import { createOverlayPrimitive } from './factories/createOverlayPrimitive.js';

// Create a Dialog primitive
const Dialog = createOverlayPrimitive({
  name: 'dialog',
  modal: true,
  role: 'dialog',
  focusTrap: true,
  scrollLock: true,
  closeOnEscape: true,
  closeOnClickOutside: false,
  hasTitle: true,
  hasDescription: true,
});

// Use it
<Dialog.Root>
  <Dialog.Trigger>Open Dialog</Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Title>Dialog Title</Dialog.Title>
    <Dialog.Description>Dialog description</Dialog.Description>
    <Dialog.Close>Close</Dialog.Close>
  </Dialog.Content>
</Dialog.Root>
```

## Configuration Options

### `name: string` (required)

The name of the overlay, used for:
- ID generation (`generateId(name)`)
- Data attributes (`data-{name}-root`, `data-{name}-content`)
- Context name

### `modal?: boolean` (default: `false`)

Whether the overlay blocks interaction with the rest of the page.

**Effects:**
- When `true`: Sets default `focusTrap: true` and `scrollLock: true`
- Adds `aria-modal="true"` to content
- Typically used with `closeOnClickOutside: false`

### `role?: string` (default: `'dialog'`)

ARIA role for the content element.

**Common values:**
- `'dialog'` - For Dialog, AlertDialog, Popover
- `'menu'` - For ContextMenu, DropdownMenu
- `'alertdialog'` - For AlertDialog

### `positioning?: boolean` (default: `false`)

Enables floating UI positioning with collision detection.

**Effects:**
- Adds `anchorElement` and `setAnchorElement` to context
- Enables `calculatePosition` in Content component
- Adds position-related props to Content: `side`, `align`, `sideOffset`, etc.
- Required for `hasArrow: true`

### `focusTrap?: boolean` (default: `modal`)

Whether to trap focus inside the overlay when open.

**Uses:**
- `trapFocus(element)` from utils
- Auto-restores focus on close

### `scrollLock?: boolean` (default: `modal`)

Whether to lock body scroll when overlay is open.

**Uses:**
- `disableBodyScroll()` on open
- `enableBodyScroll()` on close

### `closeOnEscape?: boolean` (default: `true`)

Whether to allow closing with Escape key.

**Note:** AlertDialog typically sets this to `false` by default, but allows override via Content props.

### `closeOnClickOutside?: boolean` (default: `!modal`)

Whether to allow closing by clicking outside.

**Behavior:**
- For modal overlays: `false` (user must explicitly close)
- For non-modal overlays: `true` (click outside to dismiss)

### `hasTitle?: boolean` (default: `true`)

Whether to generate and use a title ID.

**Effects:**
- Generates `titleId` in context
- Creates Title component
- Adds `aria-labelledby` to content

### `hasDescription?: boolean` (default: `true`)

Whether to generate and use a description ID.

**Effects:**
- Generates `descriptionId` in context
- Creates Description component
- Adds `aria-describedby` to content

### `hasArrow?: boolean` (default: `false`)

Whether to support an arrow component (for positioned overlays).

**Requirements:**
- `positioning: true` must be set
- Creates Arrow component
- Stores position data on content for arrow positioning

### `supportsSignalControl?: boolean` (default: `true`)

Whether to support controlled state via `WritableSignal<boolean>`.

**Pattern 19 Support:**
```typescript
const isOpen = signal(false);

<Overlay.Root open={isOpen}>
  {/* isOpen signal updates reactively */}
</Overlay.Root>
```

### `triggerBehavior?: 'click' | 'hover' | 'contextmenu'` (default: `'click'`)

Defines how the overlay is triggered.

**Options:**

#### `'click'` (default)
- Standard click to toggle
- Used by: Dialog, Popover, AlertDialog

#### `'hover'`
- Hover with configurable delays
- Adds `openDelay` and `closeDelay` to context
- Used by: HoverCard
- Requires `hoverDelays` config

#### `'contextmenu'`
- Right-click (or long-press) to open
- Adds `position` to context for mouse coordinates
- Used by: ContextMenu
- Changes trigger from `<button>` to `<div>`

### `hoverDelays?: { openDelay?: number, closeDelay?: number }`

Hover delays (only used if `triggerBehavior === 'hover'`).

**Defaults:**
- `openDelay: 700` ms
- `closeDelay: 300` ms

## Examples

### 1. Dialog (Modal)

```typescript
const Dialog = createOverlayPrimitive({
  name: 'dialog',
  modal: true,
  role: 'dialog',
  focusTrap: true,
  scrollLock: true,
  closeOnEscape: true,
  closeOnClickOutside: false,
  hasTitle: true,
  hasDescription: true,
});

// Usage
<Dialog.Root>
  <Dialog.Trigger>Open Dialog</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Overlay />
    <Dialog.Content>
      <Dialog.Title>Dialog Title</Dialog.Title>
      <Dialog.Description>This is a modal dialog.</Dialog.Description>
      <Dialog.Close>Close</Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

### 2. AlertDialog (Stricter Modal)

```typescript
const AlertDialog = createOverlayPrimitive({
  name: 'alert-dialog',
  modal: true,
  role: 'alertdialog',
  focusTrap: true,
  scrollLock: true,
  closeOnEscape: false, // Stricter: require explicit action
  closeOnClickOutside: false,
  hasTitle: true,
  hasDescription: true,
});

// Usage
<AlertDialog.Root>
  <AlertDialog.Trigger>Delete</AlertDialog.Trigger>
  <AlertDialog.Content closeOnEscape={false}> {/* Can override */}
    <AlertDialog.Title>Are you sure?</AlertDialog.Title>
    <AlertDialog.Description>
      This action cannot be undone.
    </AlertDialog.Description>
    <button onClick={handleDelete}>Delete</button>
    <AlertDialog.Close>Cancel</AlertDialog.Close>
  </AlertDialog.Content>
</AlertDialog.Root>
```

### 3. Popover (Positioned, Non-Modal)

```typescript
const Popover = createOverlayPrimitive({
  name: 'popover',
  modal: false,
  role: 'dialog',
  positioning: true,
  focusTrap: false,
  scrollLock: false,
  closeOnEscape: true,
  closeOnClickOutside: true,
  hasArrow: true,
  hasTitle: false,
  hasDescription: false,
});

// Usage
<Popover.Root>
  <Popover.Trigger>Open Popover</Popover.Trigger>
  <Popover.Content
    side="bottom"
    align="center"
    sideOffset={8}
  >
    <p>Popover content</p>
    <Popover.Arrow />
    <Popover.Close>Close</Popover.Close>
  </Popover.Content>
</Popover.Root>
```

### 4. HoverCard (Hover-Triggered)

```typescript
const HoverCard = createOverlayPrimitive({
  name: 'hover-card',
  modal: false,
  role: 'dialog',
  positioning: true,
  focusTrap: false,
  scrollLock: false,
  closeOnEscape: true,
  closeOnClickOutside: true,
  hasArrow: true,
  hasTitle: false,
  hasDescription: false,
  triggerBehavior: 'hover',
  hoverDelays: {
    openDelay: 700,
    closeDelay: 300,
  },
});

// Usage
<HoverCard.Root openDelay={500} closeDelay={200}>
  <HoverCard.Trigger>
    <a href="/user/john">@john</a>
  </HoverCard.Trigger>
  <HoverCard.Content side="top">
    <img src="/avatar.jpg" alt="Avatar" />
    <h4>John Doe</h4>
    <p>Software Engineer</p>
    <HoverCard.Arrow />
  </HoverCard.Content>
</HoverCard.Root>
```

### 5. ContextMenu (Right-Click)

```typescript
const ContextMenu = createOverlayPrimitive({
  name: 'context-menu',
  modal: false,
  role: 'menu',
  positioning: false, // Uses mouse position, not anchor
  focusTrap: false,
  scrollLock: false,
  closeOnEscape: true,
  closeOnClickOutside: true,
  hasTitle: false,
  hasDescription: false,
  triggerBehavior: 'contextmenu',
});

// Usage
<ContextMenu.Root>
  <ContextMenu.Trigger>
    <div>Right-click here</div>
  </ContextMenu.Trigger>
  <ContextMenu.Content>
    {/* Custom menu items */}
    <button onClick={() => console.log('Cut')}>Cut</button>
    <button onClick={() => console.log('Copy')}>Copy</button>
    <button onClick={() => console.log('Paste')}>Paste</button>
  </ContextMenu.Content>
</ContextMenu.Root>
```

### 6. DropdownMenu (Click, Menu Role)

```typescript
const DropdownMenu = createOverlayPrimitive({
  name: 'dropdown-menu',
  modal: false,
  role: 'menu',
  positioning: true,
  focusTrap: false,
  scrollLock: false,
  closeOnEscape: true,
  closeOnClickOutside: true,
  hasArrow: false,
  hasTitle: false,
  hasDescription: false,
  triggerBehavior: 'click',
});

// Usage
<DropdownMenu.Root>
  <DropdownMenu.Trigger>Options</DropdownMenu.Trigger>
  <DropdownMenu.Content side="bottom" align="start">
    {/* Menu items */}
  </DropdownMenu.Content>
</DropdownMenu.Root>
```

### 7. Sheet (Side Panel)

```typescript
const Sheet = createOverlayPrimitive({
  name: 'sheet',
  modal: true,
  role: 'dialog',
  positioning: false,
  focusTrap: true,
  scrollLock: true,
  closeOnEscape: true,
  closeOnClickOutside: true, // Can click overlay to close
  hasTitle: true,
  hasDescription: true,
});

// Usage (add custom CSS for slide-in animation)
<Sheet.Root>
  <Sheet.Trigger>Open Sheet</Sheet.Trigger>
  <Sheet.Portal>
    <Sheet.Overlay />
    <Sheet.Content className="sheet-side-right">
      <Sheet.Title>Settings</Sheet.Title>
      <Sheet.Description>Configure your preferences</Sheet.Description>
      {/* Form content */}
      <Sheet.Close>Close</Sheet.Close>
    </Sheet.Content>
  </Sheet.Portal>
</Sheet.Root>
```

### 8. Drawer (Bottom Sheet)

```typescript
const Drawer = createOverlayPrimitive({
  name: 'drawer',
  modal: true,
  role: 'dialog',
  positioning: false,
  focusTrap: true,
  scrollLock: true,
  closeOnEscape: true,
  closeOnClickOutside: true,
  hasTitle: true,
  hasDescription: true,
});

// Usage (add custom CSS for slide-up animation)
<Drawer.Root>
  <Drawer.Trigger>Open Drawer</Drawer.Trigger>
  <Drawer.Portal>
    <Drawer.Overlay />
    <Drawer.Content className="drawer-bottom">
      <Drawer.Title>Select Option</Drawer.Title>
      <Drawer.Description>Choose from the options below</Drawer.Description>
      {/* Options */}
      <Drawer.Close>Cancel</Drawer.Close>
    </Drawer.Content>
  </Drawer.Portal>
</Drawer.Root>
```

## Advanced Usage

### Controlled State with Signal (Pattern 19)

```typescript
import { signal } from '../core/reactivity/signal.js';

const isOpen = signal(false);

<Dialog.Root open={isOpen}>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Content>
    <p>Current state: {isOpen() ? 'open' : 'closed'}</p>
    <button onClick={() => isOpen.set(false)}>Close Programmatically</button>
  </Dialog.Content>
</Dialog.Root>
```

### Controlled State with Boolean

```typescript
const [isOpen, setIsOpen] = useState(false);

<Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Content>
    <p>Controlled by React state</p>
  </Dialog.Content>
</Dialog.Root>
```

### Custom Positioning

```typescript
<Popover.Root>
  <Popover.Anchor>
    <div>Custom anchor element</div>
  </Popover.Anchor>
  <Popover.Trigger>Open</Popover.Trigger>
  <Popover.Content
    side="right"
    align="start"
    sideOffset={12}
    alignOffset={4}
    avoidCollisions={true}
    collisionPadding={16}
  >
    Content positioned relative to anchor
  </Popover.Content>
</Popover.Root>
```

### Prevent Close on Outside Click

```typescript
<Popover.Content
  onPointerDownOutside={(event) => {
    // Prevent default close behavior
    event.preventDefault();
    console.log('Click outside prevented');
  }}
>
  Content
</Popover.Content>
```

### Prevent Close on Escape

```typescript
<Dialog.Content
  onEscapeKeyDown={(event) => {
    // Prevent default close behavior
    event.preventDefault();
    console.log('Escape prevented');
  }}
>
  Content
</Dialog.Content>
```

## Components Generated

The factory returns an object with the following components:

### Always Present
- `Root` - Root context provider
- `Trigger` - Trigger element (button or div)
- `Content` - Content container with portal
- `Portal` - Portal wrapper component
- `Overlay` - Backdrop overlay
- `Close` - Close button
- `Context` - React context object

### Conditional Components
- `Title` - Title component (if `hasTitle: true`)
- `Description` - Description component (if `hasDescription: true`)
- `Arrow` - Arrow component (if `hasArrow: true`)
- `Anchor` - Anchor element for positioning (if `positioning: true`)

## TypeScript Support

The factory provides full TypeScript support with appropriate prop types:

```typescript
import type {
  OverlayConfig,
  BaseRootProps,
  HoverCardRootProps,
  BaseTriggerProps,
  BaseContentProps,
  PositionedContentProps,
} from './factories/createOverlayPrimitive.js';

// Type-safe configuration
const config: OverlayConfig = {
  name: 'my-overlay',
  modal: true,
  // ... other options with autocomplete
};

// Generated components have proper types
const MyOverlay = createOverlayPrimitive(config);

// Props are type-checked
<MyOverlay.Root open={signal(false)} onOpenChange={(open) => console.log(open)}>
  <MyOverlay.Content side="bottom" align="center">
    Content
  </MyOverlay.Content>
</MyOverlay.Root>
```

## Migration Guide

To migrate existing overlay components to use the factory:

1. **Identify the configuration:**
   ```typescript
   // Before: Dialog.ts with 400+ lines

   // After: Single factory call
   const Dialog = createOverlayPrimitive({
     name: 'dialog',
     modal: true,
     // ... config
   });
   ```

2. **Update imports:**
   ```typescript
   // Before
   import { Dialog } from './Dialog.js';

   // After
   import { Dialog } from './Dialog.js'; // Still works!
   // Or
   import { createOverlayPrimitive } from './factories/index.js';
   const Dialog = createOverlayPrimitive({ /* ... */ });
   ```

3. **Maintain API compatibility:**
   The factory-generated components have the same API as hand-written components, so no consumer code needs to change.

## Performance Notes

- **Bundle Size:** Each overlay component now adds ~50 bytes instead of ~400 lines
- **Tree Shaking:** Unused components (Title, Arrow, etc.) are not included
- **Code Reuse:** ~90%+ code reuse across overlay variants
- **Type Safety:** Full TypeScript support maintained

## Total Code Reduction

**Before:**
- Dialog.ts: ~430 lines
- AlertDialog.ts: ~316 lines
- Popover.ts: ~524 lines
- HoverCard.ts: ~376 lines
- ContextMenu.ts: ~274 lines
- DropdownMenu.ts: ~250 lines (estimated)
- Sheet.ts: ~400 lines (estimated)
- Drawer.ts: ~400 lines (estimated)
- **Total: ~2,970 lines**

**After:**
- createOverlayPrimitive.ts: ~850 lines
- 8 factory calls: ~150 lines total
- **Total: ~1,000 lines**
- **Reduction: ~1,970 lines (66% reduction)**

## Conclusion

The `createOverlayPrimitive` factory provides a robust, type-safe, and maintainable way to create overlay components with minimal code duplication while maintaining full flexibility and API compatibility.
