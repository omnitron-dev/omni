# Aether Testing Library Tests

This directory contains comprehensive tests for the Aether testing library.

## Test Files

### 1. `render.spec.ts` - Component Rendering Tests
Tests for the core `render()` function:
- Basic rendering
- Render with options (custom container, wrapper, baseElement)
- Cleanup functionality  
- Container management
- Rerender functionality
- Debug functionality
- Error handling
- Hydration support
- Query methods integration
- Memory management
- Complex scenarios (nested components, conditional rendering, lists)

**Coverage**: 15+ test cases covering all render functionality

### 2. `events.spec.ts` - Event Simulation Tests
Tests for the `fireEvent` API:
- Click events (basic, with options, bubbling)
- Input events (input, change)
- Keyboard events (keyDown, keyUp)
- Focus events (focus, blur)
- Form events (submit)
- Event bubbling
- Event properties

**Coverage**: 10+ test cases for all event types

### 3. `user-event.spec.ts` - User Interaction Tests
Tests for realistic user interactions via `userEvent`:
- Typing text (basic, with delay, event triggering)
- Clicking elements (click, double-click)
- Selecting options (single, multiple)
- File uploads (single, multiple files)
- Clearing input
- Hover interactions (hover, unhover)
- Realistic event sequences (complete form interactions)

**Coverage**: 15+ test cases for user interactions

### 4. `queries.spec.ts` - DOM Query Tests  
Tests for all query variants:
- `getByText` (string, RegExp, partial matching)
- `getByRole` (basic, error handling)
- `getByLabelText` (label association)
- `getByTestId` (data-testid attribute)
- `queryBy*` variants (returns null when not found)
- `findBy*` variants (async promises)
- Error messages

**Coverage**: 15+ test cases for all query types

### 5. `async.spec.ts` - Async Utilities Tests
Tests for asynchronous testing utilities:
- `waitFor` (basic, timeout, interval, return values, async callbacks)
- `waitForElementToBeRemoved` (element removal, timeout)
- `act()` (sync updates, async updates, promises)
- Async component updates
- Error handling
- Timeout handling

**Coverage**: 12+ test cases for async utilities

### 6. `hooks.spec.ts` - Hook Testing Tests
Tests for `renderHook` utility:
- Basic usage (simple hooks, signals, computed)
- Hook props updates (initial props, rerender with props)
- Hook cleanup (unmount, no execution after unmount)
- Async hooks
- Error boundary (error capture, error clearing)
- Multiple hooks (multiple signals, dependencies)
- Custom wrapper
- Effect hooks

**Coverage**: 15+ test cases for hook testing

### 7. `matchers.spec.ts` - Custom Matchers Tests
Tests for Vitest custom matchers:
- `toBeInTheDocument`
- `toHaveTextContent`
- `toHaveAttribute` (with and without value)
- `toHaveClass`
- `toBeVisible`
- `toBeDisabled`
- `toHaveValue`
- `toBeChecked`
- Negative assertions (not.*)
- Edge cases
- Error messages

**Coverage**: 15+ test cases for all matchers

### 8. `integration.spec.ts` - Integration Tests
Comprehensive real-world testing scenarios:
- Complete component testing workflow (counter component)
- Form submission workflow (login form)
- Async data loading (loading states, error states)
- User interaction flows (multi-step flows, conditional UI)
- Real-world scenarios (search, todo list, form validation)
- Performance considerations (many elements, cleanup)
- Memory cleanup

**Coverage**: 15+ integration test cases

## Running Tests

```bash
# Run all testing library tests
npm test test/testing

# Run specific test file
npm test test/testing/render.spec.ts

# Run with coverage
npm test -- --coverage test/testing

# Run in watch mode
npm test -- --watch test/testing
```

## Test Statistics

- **Total Test Files**: 8
- **Estimated Test Cases**: 120+
- **Lines of Test Code**: ~1,700+
- **Coverage Target**: >90%

## Key Testing Patterns

### Testing with Signals
```typescript
import { signal } from '../../src/core/reactivity/index.js';

it('should work with reactive signals', () => {
  const count = signal(0);
  const { container } = render(() => {
    const div = document.createElement('div');
    div.textContent = String(count());
    return div as any;
  });
  expect(container.textContent).toContain('0');
});
```

### Testing User Interactions
```typescript
import { userEvent } from '../../src/testing/index.js';

it('should handle user input', async () => {
  const input = document.createElement('input');
  document.body.appendChild(input);
  
  await userEvent.type(input, 'test');
  
  expect(input.value).toBe('test');
});
```

### Testing Async Behavior
```typescript
import { waitFor } from '../../src/testing/index.js';

it('should wait for async updates', async () => {
  let ready = false;
  setTimeout(() => ready = true, 100);
  
  await waitFor(() => {
    if (!ready) throw new Error('Not ready');
  });
  
  expect(ready).toBe(true);
});
```

## Notes

- All tests use Vitest as the test runner
- Tests are designed to work with Aether's reactivity system
- Custom matchers extend Vitest's expect API
- Tests validate both happy paths and error scenarios
- Memory cleanup is tested to prevent leaks
- Performance considerations are included

## Future Enhancements

- Add visual regression tests
- Add accessibility testing utilities
- Add snapshot testing examples
- Add MSW integration for API mocking
- Add test performance benchmarks
