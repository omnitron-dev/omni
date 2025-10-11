### Drawer

**Overlay panel that slides in from the edge of the screen, optimized for mobile.**

**Features:**
- Slides from top, right, bottom, or left edges
- Modal and non-modal modes
- Focus trap and restoration
- Scroll locking when open
- Swipe to close support on touch devices
- Keyboard support (Escape to close)
- Close on outside click option
- Controlled and uncontrolled modes
- ARIA dialog support

**Basic Usage:**

```tsx
<Drawer defaultOpen={false}>
  <Drawer.Trigger>Open Drawer</Drawer.Trigger>

  <Drawer.Overlay />

  <Drawer.Content>
    <Drawer.Title>Drawer Title</Drawer.Title>
    <Drawer.Description>
      This is a drawer that slides from the side
    </Drawer.Description>

    <p>Drawer content goes here...</p>

    <Drawer.Close>Close</Drawer.Close>
  </Drawer.Content>
</Drawer>
```

**Advanced Usage:**

```tsx
// Mobile menu drawer with navigation
<Drawer
  open={isMenuOpen()}
  onOpenChange={setMenuOpen}
  side="left"
  modal={true}
  closeOnOutsideClick={true}
  closeOnEscape={true}
>
  <Drawer.Trigger class="menu-button">
    <MenuIcon />
  </Drawer.Trigger>

  <Drawer.Overlay class="drawer-overlay" />

  <Drawer.Content class="mobile-menu">
    <div class="menu-header">
      <Drawer.Title class="menu-title">Menu</Drawer.Title>
      <Drawer.Close class="close-button">×</Drawer.Close>
    </div>

    <nav class="menu-nav">
      <For each={menuItems}>
        {(item) => (
          <a
            href={item.href}
            onClick={() => {
              navigate(item.href);
              setMenuOpen(false);
            }}
          >
            {item.icon}
            {item.label}
          </a>
        )}
      </For>
    </nav>

    <div class="menu-footer">
      <button onClick={handleLogout}>Logout</button>
    </div>
  </Drawer.Content>
</Drawer>
```

**API:**

**`<Drawer>`** - Root container
- `open?: boolean` - Controlled open state
- `onOpenChange?: (open: boolean) => void` - Open state change callback
- `defaultOpen?: boolean` - Default open state (uncontrolled)
- `side?: 'top' | 'right' | 'bottom' | 'left'` - Slide direction (default: 'right')
- `modal?: boolean` - Modal mode blocks interaction behind (default: true)
- `closeOnOutsideClick?: boolean` - Close when clicking outside (default: true)
- `closeOnEscape?: boolean` - Close on Escape key (default: true)

**`<Drawer.Trigger>`** - Button to open the drawer

**`<Drawer.Overlay>`** - Backdrop overlay (only shown in modal mode)

**`<Drawer.Content>`** - Drawer content panel (slides in from specified side)

**`<Drawer.Title>`** - Drawer title (required for accessibility)

**`<Drawer.Description>`** - Drawer description

**`<Drawer.Close>`** - Button to close the drawer

---

