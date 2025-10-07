# Primitive E2E Tests

Playwright-based end-to-end tests for Aether UI primitives.

## Overview

This directory contains comprehensive E2E tests for all Aether primitives, ensuring:

- ✅ **Accessibility compliance** (WAI-ARIA patterns)
- ✅ **Keyboard navigation** (arrows, Tab, Home/End, ESC)
- ✅ **Focus management** (trap, save, restore)
- ✅ **Screen reader support** (proper roles, labels, states)
- ✅ **User interactions** (click, hover, keyboard)
- ✅ **Cross-browser compatibility** (Chrome, Firefox, Safari)
- ✅ **Mobile support** (touch, viewport)

## Structure

```
primitives/
├── utils/
│   └── primitive-test-helpers.ts    # Page objects and utilities
├── dialog.e2e.ts                    # Dialog primitive tests
├── tabs.e2e.ts                      # Tabs primitive tests
├── accordion.e2e.ts                 # Accordion primitive tests (TBD)
├── select.e2e.ts                    # Select primitive tests (TBD)
├── popover.e2e.ts                   # Popover primitive tests (TBD)
└── README.md                        # This file
```

## Test Utilities

### Page Objects

Page objects encapsulate primitive interactions and provide a clean API for tests:

```typescript
import { DialogPage } from './utils/primitive-test-helpers';

const dialog = new DialogPage(page);

// Open/close dialog
await dialog.open();
await dialog.close();
await dialog.closeWithEscape();

// Access elements
await expect(dialog.dialog).toBeVisible();
await expect(dialog.title).toHaveText('Dialog Title');
```

### Available Page Objects

- **DialogPage** - Dialog/Modal interactions
- **TabsPage** - Tabs navigation and selection
- **AccordionPage** - Accordion expand/collapse
- **PopoverPage** - Popover open/close
- **SelectPage** - Select dropdown interactions
- **SwitchPage** - Switch toggle

### Accessibility Assertions

Common accessibility checks:

```typescript
import { AccessibilityAssertions } from './utils/primitive-test-helpers';

const a11y = new AccessibilityAssertions(page);

// Check ARIA attributes
await a11y.assertHasRole(element, 'dialog');
await a11y.assertHasAriaLabel(element, 'Dialog Title');

// Check focus management
await a11y.assertFocusTrapped(dialogElement);
await a11y.assertKeyboardNavigable(element);
```

## Running Tests

### All Primitive Tests

```bash
# Run all primitive tests
npm run test:e2e primitives

# Run specific primitive
npm run test:e2e primitives/dialog

# Run in headed mode (see browser)
npm run test:e2e primitives -- --headed

# Run in debug mode
npm run test:e2e primitives -- --debug
```

### With Specific Browser

```bash
# Chrome only
npm run test:e2e primitives -- --project=chromium

# Firefox only
npm run test:e2e primitives -- --project=firefox

# Safari only
npm run test:e2e primitives -- --project=webkit

# Mobile Chrome
npm run test:e2e primitives -- --project="Mobile Chrome"
```

### Watch Mode

```bash
# Watch and rerun on changes
npm run test:e2e primitives -- --ui
```

## Writing Tests

### Test Structure

Follow this pattern for new primitive tests:

```typescript
import { test, expect } from '@playwright/test';
import { PrimitivePage, AccessibilityAssertions } from './utils/primitive-test-helpers';

test.describe('MyPrimitive', () => {
  let primitive: PrimitivePage;
  let a11y: AccessibilityAssertions;

  test.beforeEach(async ({ page }) => {
    await page.goto('/primitives/my-primitive');
    primitive = new PrimitivePage(page);
    a11y = new AccessibilityAssertions(page);
    await primitive.waitForReady();
  });

  test.describe('Basic Functionality', () => {
    test('should do something', async () => {
      // Test implementation
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper ARIA role', async () => {
      await a11y.assertHasRole(element, 'expected-role');
    });

    test('should have accessible name', async () => {
      await a11y.assertHasAriaLabel(element);
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should navigate with keyboard', async ({ page }) => {
      await page.keyboard.press('ArrowDown');
      // Assert focus moved
    });
  });
});
```

### Test Categories

Organize tests into these categories:

1. **Basic Functionality** - Core user interactions
2. **Accessibility** - ARIA compliance, focus management
3. **Keyboard Navigation** - Arrow keys, Tab, Home/End, ESC
4. **State Management** - Controlled/uncontrolled patterns
5. **Portal Rendering** - DOM structure and positioning

### Best Practices

#### ✅ DO

- Test user-visible behavior, not implementation
- Use page objects for reusable interactions
- Test accessibility for all primitives
- Test keyboard navigation thoroughly
- Test across multiple browsers
- Use descriptive test names

#### ❌ DON'T

- Test internal state directly
- Hard-code element selectors
- Skip accessibility tests
- Forget keyboard navigation
- Test only in Chrome

### Example: Testing Focus Management

```typescript
test('should trap focus within dialog', async ({ page }) => {
  await dialog.open();

  // Tab through all elements
  const focusableCount = await dialog.dialog
    .locator('button, [href], input')
    .count();

  for (let i = 0; i < focusableCount + 2; i++) {
    await page.keyboard.press('Tab');

    // Focus should stay in dialog
    const isInDialog = await dialog.dialog.evaluate((el) => {
      return el.contains(document.activeElement);
    });
    expect(isInDialog).toBe(true);
  }
});
```

### Example: Testing Keyboard Navigation

```typescript
test('should navigate with arrow keys', async ({ page }) => {
  await tabs.getTab('Tab 1').focus();

  // Arrow Right -> Tab 2
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getTab('Tab 2')).toBeFocused();

  // Home -> Tab 1
  await page.keyboard.press('Home');
  await expect(tabs.getTab('Tab 1')).toBeFocused();

  // End -> Last Tab
  await page.keyboard.press('End');
  await expect(tabs.getTab('Tab 3')).toBeFocused();
});
```

## Current Status

### Implemented Tests

- ✅ **Dialog** - Complete test suite (60+ assertions)
- ✅ **Tabs** - Complete test suite (40+ assertions)

### Pending Tests

- 🚧 **Accordion** - TBD
- 🚧 **Select** - TBD
- 🚧 **Popover** - TBD
- 🚧 **Dropdown Menu** - TBD
- 🚧 **Switch** - TBD
- 🚧 **Form** - TBD
- 🚧 **RadioGroup** - TBD
- 🚧 **Checkbox** - TBD
- 🚧 **Slider** - TBD
- 🚧 **Tooltip** - TBD
- 🚧 **ContextMenu** - TBD
- 🚧 **HoverCard** - TBD
- 🚧 **Sheet** - TBD

## Requirements

### Dev Server

Tests require a dev server with primitive examples running at `http://localhost:3000`:

```bash
# Start dev server
npm run dev

# Run tests (in another terminal)
npm run test:e2e primitives
```

### Test Pages

Each primitive needs a test page at `/primitives/{primitive-name}`:

```
http://localhost:3000/primitives/dialog
http://localhost:3000/primitives/tabs
http://localhost:3000/primitives/accordion
...
```

These pages should render fully functional examples of the primitives.

## CI/CD Integration

Tests run automatically in CI:

```yaml
# .github/workflows/test.yml
- name: E2E Tests
  run: |
    npm run dev &  # Start dev server
    npm run test:e2e primitives
```

## Debugging

### Visual Debugging

```bash
# Run in headed mode
npm run test:e2e primitives -- --headed

# Run in debug mode (pauses at each step)
npm run test:e2e primitives -- --debug
```

### Screenshots

Failed tests automatically capture screenshots:

```
test-results/
├── primitives-dialog-should-close-on-escape/
│   └── test-failed-1.png
└── ...
```

### Trace Viewer

View detailed test traces:

```bash
# Run tests with tracing
npm run test:e2e primitives -- --trace on

# View trace
npx playwright show-trace trace.zip
```

## Resources

- [Playwright Documentation](https://playwright.dev)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [Aether Primitives Spec](../../../docs/13-PRIMITIVES.md)
- [Accessibility Guidelines](../../../docs/26-ACCESSIBILITY.md)

## Contributing

When adding new primitives:

1. Create page object in `utils/primitive-test-helpers.ts`
2. Create test file: `{primitive-name}.e2e.ts`
3. Add test page: `/primitives/{primitive-name}`
4. Run tests across all browsers
5. Update this README

## Questions?

See [Testing Documentation](../../../docs/23-TESTING.md) or ask in Discord.
