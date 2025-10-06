# 23. Testing

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Unit Testing](#unit-testing)
- [Component Testing](#component-testing)
- [Integration Testing](#integration-testing)
- [E2E Testing](#e2e-testing)
- [Test Utilities](#test-utilities)
- [Mocking](#mocking)
- [Assertions](#assertions)
- [Coverage](#coverage)
- [Best Practices](#best-practices)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Nexus provides **comprehensive testing tools** built on Vitest:

- ⚡ **Fast execution** with Vite-powered transforms
- 🎯 **Component testing** with DOM utilities
- 🔄 **HMR for tests** - instant feedback
- 📊 **Coverage reporting** with c8/istanbul
- 🎭 **E2E testing** with Playwright
- 🔧 **Testing utilities** for signals, stores, effects
- 📝 **TypeScript support** out of the box

### Testing Stack

```
Unit Tests        → Vitest
Component Tests   → Vitest + Testing Library
Integration Tests → Vitest + MSW (Mock Service Worker)
E2E Tests        → Playwright
```

### Quick Example

```typescript
// sum.test.ts
import { describe, it, expect } from 'vitest';

describe('sum', () => {
  it('adds numbers correctly', () => {
    expect(sum(1, 2)).toBe(3);
  });
});

// Component.test.tsx
import { render, fireEvent } from '@testing-library/nexus';
import { Counter } from './Counter';

describe('Counter', () => {
  it('increments on click', async () => {
    const { getByText } = render(() => <Counter />);

    const button = getByText('Increment');
    await fireEvent.click(button);

    expect(getByText('Count: 1')).toBeInTheDocument();
  });
});
```

## Philosophy

### Test Behavior, Not Implementation

```typescript
// ❌ Testing implementation details
it('sets internal state', () => {
  const component = new Counter();
  component._setState({ count: 5 });
  expect(component._state.count).toBe(5);
});

// ✅ Testing behavior
it('displays updated count', async () => {
  const { getByText, getByRole } = render(() => <Counter />);

  await fireEvent.click(getByRole('button'));

  expect(getByText('Count: 1')).toBeInTheDocument();
});
```

### Fast Feedback

**Tests should run fast**:

```typescript
// ✅ Fast (no real API calls)
it('fetches users', async () => {
  mockApi.get('/users').resolves([{ id: 1, name: 'Alice' }]);

  const users = await userService.getUsers();

  expect(users).toHaveLength(1);
});

// ❌ Slow (real API call)
it('fetches users', async () => {
  const users = await fetch('https://api.example.com/users');
  expect(users).toBeDefined();
});
```

### Test User Workflows

**Test how users interact**:

```typescript
// ✅ User workflow
it('completes signup flow', async () => {
  const { getByLabelText, getByRole } = render(() => <SignupForm />);

  await userEvent.type(getByLabelText('Email'), 'alice@example.com');
  await userEvent.type(getByLabelText('Password'), 'password123');
  await userEvent.click(getByRole('button', { name: 'Sign Up' }));

  expect(getByText('Welcome!')).toBeInTheDocument();
});
```

## Unit Testing

### Basic Tests

```typescript
// utils/math.ts
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

// utils/math.test.ts
import { describe, it, expect } from 'vitest';
import { add, multiply } from './math';

describe('math utils', () => {
  describe('add', () => {
    it('adds positive numbers', () => {
      expect(add(2, 3)).toBe(5);
    });

    it('adds negative numbers', () => {
      expect(add(-2, -3)).toBe(-5);
    });

    it('adds zero', () => {
      expect(add(5, 0)).toBe(5);
    });
  });

  describe('multiply', () => {
    it('multiplies numbers', () => {
      expect(multiply(2, 3)).toBe(6);
    });
  });
});
```

### Testing Signals

```typescript
import { signal, computed, effect } from 'nexus';

describe('signals', () => {
  it('updates computed when signal changes', () => {
    const count = signal(0);
    const doubled = computed(() => count() * 2);

    expect(doubled()).toBe(0);

    count.set(5);

    expect(doubled()).toBe(10);
  });

  it('triggers effect when signal changes', () => {
    const count = signal(0);
    const log: number[] = [];

    effect(() => {
      log.push(count());
    });

    count.set(1);
    count.set(2);

    expect(log).toEqual([0, 1, 2]);
  });
});
```

### Testing Stores

```typescript
import { createStore } from 'nexus/state';

describe('store', () => {
  it('updates state', () => {
    const [state, setState] = createStore({ count: 0 });

    expect(state.count).toBe(0);

    setState('count', 5);

    expect(state.count).toBe(5);
  });

  it('updates nested state', () => {
    const [state, setState] = createStore({
      user: { name: 'Alice', age: 30 }
    });

    setState('user', 'name', 'Bob');

    expect(state.user.name).toBe('Bob');
    expect(state.user.age).toBe(30);
  });
});
```

## Component Testing

### Rendering Components

```typescript
import { render } from '@testing-library/nexus';
import { Button } from './Button';

describe('Button', () => {
  it('renders correctly', () => {
    const { getByText } = render(() => <Button>Click me</Button>);

    expect(getByText('Click me')).toBeInTheDocument();
  });

  it('renders with variant', () => {
    const { container } = render(() => (
      <Button variant="primary">Click me</Button>
    ));

    expect(container.firstChild).toHaveClass('button-primary');
  });
});
```

### User Interactions

```typescript
import { render, fireEvent, userEvent } from '@testing-library/nexus';

describe('Counter', () => {
  it('increments on click', async () => {
    const { getByText } = render(() => <Counter />);

    const button = getByText('Increment');

    await fireEvent.click(button);

    expect(getByText('Count: 1')).toBeInTheDocument();
  });

  it('handles user input', async () => {
    const { getByLabelText } = render(() => <SearchForm />);

    const input = getByLabelText('Search');

    await userEvent.type(input, 'test query');

    expect(input).toHaveValue('test query');
  });
});
```

### Async Components

```typescript
import { render, waitFor } from '@testing-library/nexus';

describe('AsyncComponent', () => {
  it('loads data', async () => {
    const { getByText } = render(() => <UserProfile userId="123" />);

    expect(getByText('Loading...')).toBeInTheDocument();

    await waitFor(() => {
      expect(getByText('Alice')).toBeInTheDocument();
    });
  });

  it('handles errors', async () => {
    mockApi.get('/users/123').rejects(new Error('Not found'));

    const { getByText } = render(() => <UserProfile userId="123" />);

    await waitFor(() => {
      expect(getByText('Error: User not found')).toBeInTheDocument();
    });
  });
});
```

### Testing Props

```typescript
describe('Button', () => {
  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();

    const { getByRole } = render(() => (
      <Button onClick={onClick}>Click</Button>
    ));

    await fireEvent.click(getByRole('button'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables button', () => {
    const { getByRole } = render(() => (
      <Button disabled>Click</Button>
    ));

    expect(getByRole('button')).toBeDisabled();
  });
});
```

### Testing Context

```typescript
import { createContext } from 'nexus';

const ThemeContext = createContext<'light' | 'dark'>('light');

describe('ThemedButton', () => {
  it('uses theme from context', () => {
    const { container } = render(
      () => (
        <ThemeContext.Provider value="dark">
          <ThemedButton>Click</ThemedButton>
        </ThemeContext.Provider>
      )
    );

    expect(container.firstChild).toHaveClass('theme-dark');
  });
});
```

## Integration Testing

### API Mocking

```typescript
import { setupServer } from 'msw/node';
import { rest } from 'msw';

const server = setupServer(
  rest.get('/api/users', (req, res, ctx) => {
    return res(
      ctx.json([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
      ])
    );
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('UserList', () => {
  it('fetches and displays users', async () => {
    const { getByText } = render(() => <UserList />);

    await waitFor(() => {
      expect(getByText('Alice')).toBeInTheDocument();
      expect(getByText('Bob')).toBeInTheDocument();
    });
  });
});
```

### Form Submission

```typescript
describe('LoginForm', () => {
  it('submits form data', async () => {
    const onSubmit = vi.fn();

    const { getByLabelText, getByRole } = render(() => (
      <LoginForm onSubmit={onSubmit} />
    ));

    await userEvent.type(getByLabelText('Email'), 'alice@example.com');
    await userEvent.type(getByLabelText('Password'), 'password123');
    await userEvent.click(getByRole('button', { name: 'Login' }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: 'alice@example.com',
      password: 'password123'
    });
  });
});
```

### Routing

```typescript
import { Router, Route } from 'nexus/router';

describe('Navigation', () => {
  it('navigates to route', async () => {
    const { getByText } = render(() => (
      <Router>
        <Route path="/" component={Home} />
        <Route path="/about" component={About} />
      </Router>
    ));

    await userEvent.click(getByText('About'));

    expect(getByText('About Page')).toBeInTheDocument();
  });
});
```

## E2E Testing

### Playwright Setup

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI
  }
});
```

### Basic E2E Test

```typescript
// e2e/login.spec.ts
import { test, expect } from '@playwright/test';

test('user can log in', async ({ page }) => {
  await page.goto('/login');

  await page.fill('[name="email"]', 'alice@example.com');
  await page.fill('[name="password"]', 'password123');
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('text=Welcome, Alice')).toBeVisible();
});
```

### Advanced E2E

```typescript
test('complete checkout flow', async ({ page }) => {
  // Add item to cart
  await page.goto('/products');
  await page.click('text=Add to Cart', { first: true });

  // Go to cart
  await page.click('[aria-label="Cart"]');
  await expect(page.locator('text=1 item')).toBeVisible();

  // Checkout
  await page.click('text=Checkout');

  // Fill shipping info
  await page.fill('[name="address"]', '123 Main St');
  await page.fill('[name="city"]', 'New York');
  await page.fill('[name="zip"]', '10001');

  // Submit
  await page.click('text=Complete Order');

  // Verify
  await expect(page.locator('text=Order confirmed')).toBeVisible();
});
```

## Test Utilities

### Render Utilities

```typescript
import { render, renderHook } from '@testing-library/nexus';

// Render component
const { getByText, container } = render(() => <Component />);

// Render with props
const { rerender } = render(() => <Component prop={value} />);

// Update props
rerender(() => <Component prop={newValue} />);

// Render hook
const { result } = renderHook(() => useCustomHook());

expect(result.current.value).toBe(expected);
```

### Cleanup

```typescript
import { cleanup } from '@testing-library/nexus';

afterEach(() => {
  cleanup(); // Clean up DOM after each test
});

// Or use automatic cleanup
import '@testing-library/nexus/cleanup-after-each';
```

### Wait Utilities

```typescript
import { waitFor, waitForElementToBeRemoved } from '@testing-library/nexus';

// Wait for assertion
await waitFor(() => {
  expect(getByText('Loaded')).toBeInTheDocument();
});

// Wait for element to be removed
await waitForElementToBeRemoved(() => getByText('Loading...'));

// Wait with timeout
await waitFor(() => {
  expect(condition).toBe(true);
}, { timeout: 5000 });
```

### Query Utilities

```typescript
const { getByRole, getByText, getByLabelText, queryByText, findByText } = render(() => <Component />);

// Get (throws if not found)
getByRole('button');
getByText('Click me');
getByLabelText('Email');

// Query (returns null if not found)
queryByText('Not here'); // null

// Find (async, waits for element)
await findByText('Async content');
```

## Mocking

### Function Mocking

```typescript
import { vi } from 'vitest';

describe('with mocks', () => {
  it('mocks function', () => {
    const mockFn = vi.fn();

    mockFn('hello');

    expect(mockFn).toHaveBeenCalledWith('hello');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('mocks return value', () => {
    const mockFn = vi.fn().mockReturnValue(42);

    expect(mockFn()).toBe(42);
  });

  it('mocks async function', async () => {
    const mockFn = vi.fn().mockResolvedValue('result');

    const result = await mockFn();

    expect(result).toBe('result');
  });
});
```

### Module Mocking

```typescript
// Mock entire module
vi.mock('./api', () => ({
  fetchUsers: vi.fn().mockResolvedValue([
    { id: 1, name: 'Alice' }
  ])
}));

// Mock specific export
vi.mock('./utils', async () => {
  const actual = await vi.importActual('./utils');
  return {
    ...actual,
    expensiveFunction: vi.fn().mockReturnValue('mocked')
  };
});
```

### Timer Mocking

```typescript
describe('with fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances timers', () => {
    const callback = vi.fn();

    setTimeout(callback, 1000);

    vi.advanceTimersByTime(1000);

    expect(callback).toHaveBeenCalled();
  });
});
```

### RPC Mocking

```typescript
import { mockRPC } from '@testing-library/nexus';

describe('with RPC mock', () => {
  it('mocks RPC call', async () => {
    mockRPC(UserService, 'findById').mockResolvedValue({
      id: '123',
      name: 'Alice'
    });

    const userService = useRPC(UserService);
    const user = await userService.findById('123');

    expect(user.name).toBe('Alice');
  });
});
```

## Assertions

### Basic Assertions

```typescript
// Equality
expect(value).toBe(expected);
expect(value).toEqual(expected); // Deep equality

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeDefined();
expect(value).toBeNull();

// Numbers
expect(value).toBeGreaterThan(10);
expect(value).toBeLessThan(100);
expect(value).toBeCloseTo(3.14, 2);

// Strings
expect(value).toMatch(/pattern/);
expect(value).toContain('substring');

// Arrays
expect(array).toContain(item);
expect(array).toHaveLength(3);

// Objects
expect(obj).toHaveProperty('key', value);
expect(obj).toMatchObject({ key: value });
```

### DOM Assertions

```typescript
import '@testing-library/jest-dom';

// Visibility
expect(element).toBeVisible();
expect(element).toBeInTheDocument();

// Content
expect(element).toHaveTextContent('text');
expect(element).toContainHTML('<span>text</span>');

// Attributes
expect(element).toHaveAttribute('href', '/link');
expect(element).toHaveClass('active');

// Forms
expect(input).toHaveValue('text');
expect(input).toBeDisabled();
expect(checkbox).toBeChecked();

// Focus
expect(element).toHaveFocus();
```

### Custom Matchers

```typescript
// Define custom matcher
expect.extend({
  toBeWithinRange(received, min, max) {
    const pass = received >= min && received <= max;
    return {
      pass,
      message: () =>
        `expected ${received} to be within range ${min} - ${max}`
    };
  }
});

// Use custom matcher
expect(15).toBeWithinRange(10, 20);
```

## Coverage

### Configure Coverage

```typescript
// vitest.config.ts
export default {
  test: {
    coverage: {
      provider: 'c8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'test/',
        '**/*.test.ts'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
};
```

### Run Coverage

```bash
# Run tests with coverage
npm run test -- --coverage

# Coverage report
File          | % Stmts | % Branch | % Funcs | % Lines
────────────────────────────────────────────────────────
All files     |   92.5  |   88.3   |   95.1  |   93.2
 Button.tsx   |   100   |   100    |   100   |   100
 Counter.tsx  |   95.4  |   91.2   |   100   |   96.1
 utils.ts     |   87.3  |   75.8   |   88.9   |  88.2
```

## Best Practices

### 1. Test User Behavior

```typescript
// ✅ Test what users see and do
it('displays error message on invalid input', async () => {
  const { getByText, getByLabelText } = render(() => <Form />);

  await userEvent.type(getByLabelText('Email'), 'invalid');
  await userEvent.click(getByText('Submit'));

  expect(getByText('Invalid email')).toBeVisible();
});

// ❌ Test implementation details
it('sets error state', () => {
  const component = new Form();
  component._setError('email', 'Invalid email');
  expect(component._errors.email).toBe('Invalid email');
});
```

### 2. Use Data-Testid Sparingly

```typescript
// ✅ Use semantic queries
getByRole('button', { name: 'Submit' });
getByLabelText('Email');
getByText('Welcome');

// ⚠️ Use data-testid only when necessary
getByTestId('complex-widget');
```

### 3. Mock External Dependencies

```typescript
// ✅ Mock API calls
mockApi.get('/users').resolves([{ id: 1, name: 'Alice' }]);

// ❌ Don't make real API calls in tests
const users = await fetch('https://api.example.com/users');
```

### 4. Keep Tests Fast

```typescript
// ✅ Fast test (< 100ms)
it('calculates sum', () => {
  expect(sum(1, 2)).toBe(3);
});

// ❌ Slow test (> 1s)
it('waits for animation', async () => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  expect(element).toBeVisible();
});
```

## Advanced Patterns

### Test Helpers

```typescript
// test/helpers.ts
export function renderWithProviders(component: () => JSX.Element) {
  return render(() => (
    <ThemeProvider theme={lightTheme}>
      <Router>
        {component()}
      </Router>
    </ThemeProvider>
  ));
}

// Usage
const { getByText } = renderWithProviders(() => <App />);
```

### Custom Hooks Testing

```typescript
import { renderHook, act } from '@testing-library/nexus';

describe('useCounter', () => {
  it('increments counter', () => {
    const { result } = renderHook(() => useCounter());

    expect(result.current.count()).toBe(0);

    act(() => {
      result.current.increment();
    });

    expect(result.current.count()).toBe(1);
  });
});
```

### Snapshot Testing

```typescript
import { render } from '@testing-library/nexus';

describe('Button', () => {
  it('matches snapshot', () => {
    const { container } = render(() => <Button>Click</Button>);

    expect(container.firstChild).toMatchSnapshot();
  });
});
```

## API Reference

### render

```typescript
function render(
  component: () => JSX.Element,
  options?: {
    container?: HTMLElement;
    wrapper?: ComponentType;
  }
): {
  container: HTMLElement;
  getByRole: (role: string, options?: {}) => HTMLElement;
  getByText: (text: string | RegExp) => HTMLElement;
  getByLabelText: (text: string | RegExp) => HTMLElement;
  queryByText: (text: string | RegExp) => HTMLElement | null;
  findByText: (text: string | RegExp) => Promise<HTMLElement>;
  rerender: (component: () => JSX.Element) => void;
  unmount: () => void;
};
```

### fireEvent

```typescript
function fireEvent(
  element: HTMLElement,
  event: Event
): boolean;

fireEvent.click(element);
fireEvent.change(element, { target: { value: 'text' } });
fireEvent.submit(element);
```

### waitFor

```typescript
function waitFor<T>(
  callback: () => T | Promise<T>,
  options?: {
    timeout?: number;
    interval?: number;
  }
): Promise<T>;
```

## Examples

### Complete Test Suite

```typescript
// Button.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/nexus';
import { Button } from './Button';

describe('Button', () => {
  it('renders correctly', () => {
    const { getByText } = render(() => <Button>Click me</Button>);
    expect(getByText('Click me')).toBeInTheDocument();
  });

  it('handles click events', async () => {
    const onClick = vi.fn();
    const { getByRole } = render(() => <Button onClick={onClick}>Click</Button>);

    await fireEvent.click(getByRole('button'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies variant classes', () => {
    const { container } = render(() => <Button variant="primary">Click</Button>);
    expect(container.firstChild).toHaveClass('button-primary');
  });

  it('disables button', () => {
    const { getByRole } = render(() => <Button disabled>Click</Button>);
    expect(getByRole('button')).toBeDisabled();
  });

  it('shows loading state', () => {
    const { getByRole } = render(() => <Button loading>Click</Button>);
    expect(getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });
});
```

---

**Nexus testing tools provide everything you need** for unit, component, integration, and E2E testing. Built on Vitest and Playwright, you get fast execution and great developer experience.

**Next**: [Summary and Conclusion →](./README.md)
