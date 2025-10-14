/**
 * MDX End-to-End Tests
 *
 * Comprehensive e2e tests for MDX rendering, reactivity, and integration
 * Tests cover the full MDX lifecycle from compilation to DOM rendering
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal, computed, effect, batch } from '../../src/core/reactivity/index.js';
import { createRoot, onCleanup, onMount } from '../../src/core/component/lifecycle.js';
import {
  compileMDX,
  compileMDXSync,
  MDXProvider,
  useMDXContext,
  createMDXScope,
  evaluateMDX,
  renderMDX
} from '../../src/mdx/index.js';
import { defineComponent } from '../../src/core/component/define.js';
import { jsx } from '../../src/jsx-runtime.js';
import { render } from '../../src/testing/render.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Helper to create a DOM container for testing
 */
function createContainer(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'test-container';
  document.body.appendChild(container);
  return container;
}

/**
 * Helper to cleanup DOM container
 */
function cleanupContainer(container: HTMLElement) {
  if (container.parentNode) {
    container.parentNode.removeChild(container);
  }
}

/**
 * Helper to wait for DOM updates
 */
async function waitForDOM(ms = 0): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper to render MDX with provider
 *
 * This function compiles MDX source synchronously and renders the actual compiled component
 * wrapped with MDXProvider for proper context support.
 */
async function renderMDXWithProvider(
  source: string,
  container: HTMLElement,
  components?: Record<string, any>,
  scope?: Record<string, any>
): Promise<{ dispose: () => void; unmount: () => void }> {
  // Compile MDX synchronously to get the module with the actual component
  const module = compileMDXSync(source, {
    components,
    scope,
    mode: 'production',
    jsx: true,
    gfm: true,
    frontmatter: true
  });

  // Extract the default component from the module
  const MDXContent = module.default;

  // Create wrapper component that provides MDX context
  const App = defineComponent(() => {
    return () => jsx(MDXProvider, {
      components,
      scope,
      children: jsx(MDXContent, {})
    });
  });

  // Render the app using the testing library
  const result = render(() => jsx(App, {}), { container });

  // Wait for initial render to complete
  await waitForDOM(10);

  return {
    dispose: () => {
      result.unmount();
    },
    unmount: () => {
      result.unmount();
    }
  };
}

// ============================================================================
// Test: 1. Full MDX Component Rendering in DOM
// ============================================================================

describe('MDX E2E Tests - DOM Rendering', () => {
  let container: HTMLElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    dispose?.();
    cleanupContainer(container);
  });

  test('should render basic markdown to DOM', async () => {
    const source = '# Hello World\n\nThis is a **bold** paragraph.';
    const result = await renderMDXWithProvider(source, container);
    dispose = result.dispose;

    expect(container.querySelector('h1')).toBeTruthy();
    expect(container.querySelector('h1')?.textContent).toContain('Hello World');
    expect(container.querySelector('p')).toBeTruthy();
    expect(container.querySelector('strong')).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });

  test('should render complex markdown structures', async () => {
    const source = `
# Main Title

## Subtitle

- List item 1
- List item 2
- List item 3

\`\`\`javascript
const code = true;
\`\`\`

[Link](https://example.com)

| Header | Value |
|--------|-------|
| Row 1  | Data  |
`;

    const result = await renderMDXWithProvider(source, container);
    dispose = result.dispose;

    expect(container.querySelector('h1')?.textContent).toContain('Main Title');
    expect(container.querySelector('h2')?.textContent).toContain('Subtitle');
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(container.querySelector('code')).toBeTruthy();
    expect(container.querySelector('a')).toBeTruthy();
    expect(container.querySelector('table')).toBeTruthy();
  });

  test('should render JSX components in MDX', async () => {
    const Button = defineComponent<{ children?: any }>((props) => {
      return () => jsx('button', {
        class: 'custom-button',
        children: props.children
      });
    });

    const source = '# Title\n\n<Button>Click me</Button>';
    const result = await renderMDXWithProvider(source, container, { Button });
    dispose = result.dispose;

    expect(container.querySelector('button')).toBeTruthy();
    expect(container.querySelector('.custom-button')).toBeTruthy();
    expect(container.querySelector('button')?.textContent).toBe('Click me');
  });

  test('should render nested MDX components', async () => {
    const Card = defineComponent<{ title?: string; children?: any }>((props) => {
      return () => jsx('div', {
        class: 'card',
        children: [
          props.title && jsx('h3', { children: props.title }),
          jsx('div', { class: 'card-body', children: props.children })
        ]
      });
    });

    const source = `
<Card title="My Card">

## Nested Content

This is **markdown** inside a component!

</Card>
`;

    const result = await renderMDXWithProvider(source, container, { Card });
    dispose = result.dispose;

    expect(container.querySelector('.card')).toBeTruthy();
    expect(container.querySelector('.card h3')?.textContent).toBe('My Card');
    expect(container.querySelector('.card-body h2')).toBeTruthy();
    expect(container.querySelector('.card-body strong')).toBeTruthy();
  });

  test('should apply custom component styles', async () => {
    const StyledDiv = defineComponent<{ children?: any }>((props) => {
      return () => jsx('div', {
        style: 'color: red; font-size: 20px;',
        class: 'styled',
        children: props.children
      });
    });

    const source = '<StyledDiv>Styled content</StyledDiv>';
    const result = await renderMDXWithProvider(source, container, { StyledDiv });
    dispose = result.dispose;

    const element = container.querySelector('.styled') as HTMLElement;
    expect(element).toBeTruthy();
    expect(element.style.color).toBe('red');
    expect(element.style.fontSize).toBe('20px');
  });
});

// ============================================================================
// Test: 2. Reactive Updates with Signals
// ============================================================================

describe('MDX E2E Tests - Reactive Updates', () => {
  let container: HTMLElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    dispose?.();
    cleanupContainer(container);
  });

  test('should update DOM when signal changes', async () => {
    const count = signal(0);

    const Counter = defineComponent(() => {
      return () => jsx('div', {
        class: 'counter',
        children: `Count: ${count()}`
      });
    });

    const source = '<Counter />';
    const result = await renderMDXWithProvider(source, container, { Counter });
    dispose = result.dispose;

    expect(container.querySelector('.counter')?.textContent).toBe('Count: 0');

    count.set(5);
    await waitForDOM(10);

    expect(container.querySelector('.counter')?.textContent).toBe('Count: 5');

    count.set(10);
    await waitForDOM(10);

    expect(container.querySelector('.counter')?.textContent).toBe('Count: 10');
  });

  test('should handle computed signals in MDX', async () => {
    const firstName = signal('John');
    const lastName = signal('Doe');
    const fullName = computed(() => `${firstName()} ${lastName()}`);

    const Greeting = defineComponent(() => {
      return () => jsx('div', {
        class: 'greeting',
        children: `Hello, ${fullName()}!`
      });
    });

    const source = '<Greeting />';
    const result = await renderMDXWithProvider(source, container, { Greeting });
    dispose = result.dispose;

    expect(container.querySelector('.greeting')?.textContent).toBe('Hello, John Doe!');

    firstName.set('Jane');
    await waitForDOM(10);

    expect(container.querySelector('.greeting')?.textContent).toBe('Hello, Jane Doe!');

    batch(() => {
      firstName.set('Bob');
      lastName.set('Smith');
    });
    await waitForDOM(10);

    expect(container.querySelector('.greeting')?.textContent).toBe('Hello, Bob Smith!');
  });

  test('should handle reactive scope variables', async () => {
    const count = signal(0);

    const source = `
# Counter

Current count: {count()}

<button onClick={() => count.set(count() + 1)}>Increment</button>
`;

    const scope = { count };
    const result = await renderMDXWithProvider(source, container, {}, scope);
    dispose = result.dispose;

    count.set(5);
    await waitForDOM(10);

    expect(container.textContent).toContain('Current count: 5');
  });

  test('should batch multiple reactive updates', async () => {
    const x = signal(0);
    const y = signal(0);
    const sum = computed(() => x() + y());

    let renderCount = 0;

    const SumDisplay = defineComponent(() => {
      return () => {
        renderCount++;
        return jsx('div', {
          class: 'sum',
          children: `Sum: ${sum()}`
        });
      };
    });

    const source = '<SumDisplay />';
    const result = await renderMDXWithProvider(source, container, { SumDisplay });
    dispose = result.dispose;

    const initialRenderCount = renderCount;

    batch(() => {
      x.set(5);
      y.set(10);
    });
    await waitForDOM(10);

    // Should only render once for batched updates
    expect(renderCount).toBe(initialRenderCount + 1);
    expect(container.querySelector('.sum')?.textContent).toBe('Sum: 15');
  });

  test('should handle deep reactive chains', async () => {
    const a = signal(1);
    const b = computed(() => a() * 2);
    const c = computed(() => b() + 3);
    const d = computed(() => c() * 4);

    const Display = defineComponent(() => {
      return () => jsx('div', {
        class: 'result',
        children: `Result: ${d()}`
      });
    });

    const source = '<Display />';
    const result = await renderMDXWithProvider(source, container, { Display });
    dispose = result.dispose;

    // a=1, b=2, c=5, d=20
    expect(container.querySelector('.result')?.textContent).toBe('Result: 20');

    a.set(3);
    await waitForDOM(10);

    // a=3, b=6, c=9, d=36
    expect(container.querySelector('.result')?.textContent).toBe('Result: 36');
  });
});

// ============================================================================
// Test: 3. Component Lifecycle (mount, update, unmount)
// ============================================================================

describe('MDX E2E Tests - Component Lifecycle', () => {
  let container: HTMLElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    dispose?.();
    cleanupContainer(container);
  });

  test('should trigger onMount lifecycle', async () => {
    const mountCalls: string[] = [];

    const LifecycleComponent = defineComponent(() => {
      onMount(() => {
        mountCalls.push('mounted');
      });

      return () => jsx('div', { class: 'lifecycle', children: 'Content' });
    });

    const source = '<LifecycleComponent />';
    const result = await renderMDXWithProvider(source, container, { LifecycleComponent });
    dispose = result.dispose;

    await waitForDOM(10);

    expect(mountCalls).toContain('mounted');
    expect(container.querySelector('.lifecycle')).toBeTruthy();
  });

  test('should trigger onCleanup when unmounting', async () => {
    const cleanupCalls: string[] = [];
    const show = signal(true);

    const CleanupComponent = defineComponent(() => {
      onCleanup(() => {
        cleanupCalls.push('cleaned');
      });

      return () => jsx('div', { class: 'cleanup', children: 'Content' });
    });

    const Conditional = defineComponent(() => {
      return () => show()
        ? jsx(CleanupComponent, {})
        : jsx('div', { children: 'Hidden' });
    });

    const source = '<Conditional />';
    const result = await renderMDXWithProvider(source, container, { Conditional });
    dispose = result.dispose;

    expect(container.querySelector('.cleanup')).toBeTruthy();
    expect(cleanupCalls).toHaveLength(0);

    show.set(false);
    await waitForDOM(10);

    expect(container.querySelector('.cleanup')).toBeFalsy();
    expect(cleanupCalls).toContain('cleaned');
  });

  test('should update component on prop changes', async () => {
    const name = signal('Alice');

    const Greeting = defineComponent<{ name: string }>((props) => {
      return () => jsx('div', {
        class: 'greeting',
        children: `Hello, ${props.name}!`
      });
    });

    const Wrapper = defineComponent(() => {
      return () => jsx(Greeting, { name: name() });
    });

    const source = '<Wrapper />';
    const result = await renderMDXWithProvider(source, container, { Wrapper });
    dispose = result.dispose;

    expect(container.querySelector('.greeting')?.textContent).toBe('Hello, Alice!');

    name.set('Bob');
    await waitForDOM(10);

    expect(container.querySelector('.greeting')?.textContent).toBe('Hello, Bob!');
  });

  test('should handle component remounting', async () => {
    const mountCount = signal(0);
    const show = signal(true);

    const MountTracker = defineComponent(() => {
      onMount(() => {
        mountCount.set(mountCount() + 1);
      });

      return () => jsx('div', { class: 'tracker', children: 'Mounted' });
    });

    const Conditional = defineComponent(() => {
      return () => show()
        ? jsx(MountTracker, {})
        : null;
    });

    const source = '<Conditional />';
    const result = await renderMDXWithProvider(source, container, { Conditional });
    dispose = result.dispose;

    await waitForDOM(10);
    expect(mountCount()).toBe(1);

    show.set(false);
    await waitForDOM(10);
    expect(container.querySelector('.tracker')).toBeFalsy();

    show.set(true);
    await waitForDOM(10);
    expect(mountCount()).toBe(2);
  });
});

// ============================================================================
// Test: 4. Event Handlers in MDX Components
// ============================================================================

describe('MDX E2E Tests - Event Handlers', () => {
  let container: HTMLElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    dispose?.();
    cleanupContainer(container);
  });

  test('should handle click events', async () => {
    const clicks = signal(0);

    const Button = defineComponent(() => {
      const handleClick = () => {
        clicks.set(clicks() + 1);
      };

      return () => jsx('button', {
        class: 'click-btn',
        onClick: handleClick,
        children: `Clicks: ${clicks()}`
      });
    });

    const source = '<Button />';
    const result = await renderMDXWithProvider(source, container, { Button });
    dispose = result.dispose;

    const button = container.querySelector('.click-btn') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.textContent).toBe('Clicks: 0');

    button.click();
    await waitForDOM(10);
    expect(button.textContent).toBe('Clicks: 1');

    button.click();
    button.click();
    await waitForDOM(10);
    expect(button.textContent).toBe('Clicks: 3');
  });

  test('should handle input events', async () => {
    const inputValue = signal('');

    const Input = defineComponent(() => {
      const handleInput = (e: Event) => {
        inputValue.set((e.target as HTMLInputElement).value);
      };

      return () => jsx('div', {
        children: [
          jsx('input', {
            type: 'text',
            class: 'test-input',
            value: inputValue(),
            onInput: handleInput
          }),
          jsx('div', {
            class: 'output',
            children: `Value: ${inputValue()}`
          })
        ]
      });
    });

    const source = '<Input />';
    const result = await renderMDXWithProvider(source, container, { Input });
    dispose = result.dispose;

    const input = container.querySelector('.test-input') as HTMLInputElement;
    const output = container.querySelector('.output');

    expect(output?.textContent).toBe('Value: ');

    input.value = 'Hello';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForDOM(10);

    expect(output?.textContent).toBe('Value: Hello');
  });

  test('should handle custom events', async () => {
    const eventData = signal<any>(null);

    const CustomEmitter = defineComponent<{ onCustomEvent?: (data: any) => void }>((props) => {
      const handleClick = () => {
        props.onCustomEvent?.({ type: 'custom', timestamp: Date.now() });
      };

      return () => jsx('button', {
        class: 'emitter',
        onClick: handleClick,
        children: 'Emit Event'
      });
    });

    const Wrapper = defineComponent(() => {
      const handleCustomEvent = (data: any) => {
        eventData.set(data);
      };

      return () => jsx('div', {
        children: [
          jsx(CustomEmitter, { onCustomEvent: handleCustomEvent }),
          jsx('div', {
            class: 'event-output',
            children: eventData() ? `Event: ${eventData().type}` : 'No event'
          })
        ]
      });
    });

    const source = '<Wrapper />';
    const result = await renderMDXWithProvider(source, container, { Wrapper });
    dispose = result.dispose;

    expect(container.querySelector('.event-output')?.textContent).toBe('No event');

    const button = container.querySelector('.emitter') as HTMLButtonElement;
    button.click();
    await waitForDOM(10);

    expect(container.querySelector('.event-output')?.textContent).toBe('Event: custom');
  });

  test('should handle multiple event types', async () => {
    const events = signal<string[]>([]);

    const MultiEvent = defineComponent(() => {
      const addEvent = (type: string) => {
        events.set([...events(), type]);
      };

      return () => jsx('div', {
        class: 'multi-event',
        onClick: () => addEvent('click'),
        onMouseEnter: () => addEvent('mouseenter'),
        onMouseLeave: () => addEvent('mouseleave'),
        children: jsx('span', { children: `Events: ${events().length}` })
      });
    });

    const source = '<MultiEvent />';
    const result = await renderMDXWithProvider(source, container, { MultiEvent });
    dispose = result.dispose;

    const element = container.querySelector('.multi-event') as HTMLDivElement;

    element.click();
    await waitForDOM(10);
    expect(events()).toContain('click');

    element.dispatchEvent(new MouseEvent('mouseenter'));
    await waitForDOM(10);
    expect(events()).toContain('mouseenter');

    element.dispatchEvent(new MouseEvent('mouseleave'));
    await waitForDOM(10);
    expect(events()).toContain('mouseleave');

    expect(events()).toHaveLength(3);
  });
});

// ============================================================================
// Test: 5. Navigation and TOC Functionality
// ============================================================================

describe('MDX E2E Tests - Navigation and TOC', () => {
  let container: HTMLElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = createContainer();
    // Mock window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { hash: '' }
    });
  });

  afterEach(() => {
    dispose?.();
    cleanupContainer(container);
  });

  test('should generate IDs for headings', async () => {
    const source = `
# Main Title
## Sub Section
### Deep Heading
`;

    const result = await renderMDXWithProvider(source, container);
    dispose = result.dispose;

    expect(container.querySelector('h1')?.id).toBeTruthy();
    expect(container.querySelector('h2')?.id).toBeTruthy();
    expect(container.querySelector('h3')?.id).toBeTruthy();
  });

  test('should support anchor navigation', async () => {
    const source = `
# Section One
## Section Two
`;

    const result = await renderMDXWithProvider(source, container);
    dispose = result.dispose;

    const h1 = container.querySelector('h1');
    const h2 = container.querySelector('h2');

    // Check that auto-generated IDs are applied
    expect(h1?.id).toBe('section-one');
    expect(h2?.id).toBe('section-two');

    // Check that headings have the correct text
    expect(h1?.textContent).toBe('Section One');
    expect(h2?.textContent).toBe('Section Two');

    // Verify we can navigate to anchors
    expect(document.getElementById('section-one')).toBe(h1);
    expect(document.getElementById('section-two')).toBe(h2);
  });

  test('should handle TOC navigation', async () => {
    const activeSection = signal<string | null>(null);

    const TOC = defineComponent<{ sections: Array<{ id: string; title: string }> }>((props) => {
      const handleClick = (id: string) => {
        activeSection.set(id);
        const element = document.getElementById(id);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        }
      };

      return () => jsx('nav', {
        class: 'toc',
        children: jsx('ul', {
          children: props.sections.map(section =>
            jsx('li', {
              class: activeSection() === section.id ? 'active' : '',
              onClick: () => handleClick(section.id),
              children: section.title,
              key: section.id
            })
          )
        })
      });
    });

    const source = '<TOC sections={sections} />';
    const sections = [
      { id: 'intro', title: 'Introduction' },
      { id: 'content', title: 'Content' }
    ];

    const result = await renderMDXWithProvider(source, container, { TOC }, { sections });
    dispose = result.dispose;

    const tocItems = container.querySelectorAll('.toc li');
    expect(tocItems).toHaveLength(2);

    (tocItems[0] as HTMLElement).click();
    await waitForDOM(10);

    expect(container.querySelector('.toc li.active')).toBeTruthy();
  });
});

// ============================================================================
// Test: 6. Error Boundaries
// ============================================================================

describe('MDX E2E Tests - Error Boundaries', () => {
  let container: HTMLElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    dispose?.();
    cleanupContainer(container);
  });

  test('should handle component errors gracefully', async () => {
    const errors: Error[] = [];

    const ErrorComponent = defineComponent(() => {
      return () => {
        throw new Error('Component error');
      };
    });

    const ErrorBoundary = defineComponent<{ children?: any }>((props) => {
      const hasError = signal(false);
      const errorMessage = signal('');

      return () => {
        try {
          if (hasError()) {
            return jsx('div', {
              class: 'error-boundary',
              children: `Error: ${errorMessage()}`
            });
          }
          return props.children;
        } catch (error) {
          hasError.set(true);
          errorMessage.set((error as Error).message);
          errors.push(error as Error);
          return jsx('div', {
            class: 'error-boundary',
            children: `Error: ${(error as Error).message}`
          });
        }
      };
    });

    const source = '<ErrorBoundary><ErrorComponent /></ErrorBoundary>';

    // Should not throw
    const onError = vi.fn();
    const result = await renderMDXWithProvider(source, container, { ErrorBoundary, ErrorComponent }, undefined);
    dispose = result.dispose;

    // Error boundary should be present even if component errors
    expect(container.querySelector('div')).toBeTruthy();
  });

  test('should handle MDX compilation errors', async () => {
    const invalidSource = '<InvalidJSX';

    await expect(compileMDX(invalidSource)).rejects.toThrow();
  });

  test('should handle missing component errors', async () => {
    const source = '<NonExistentComponent />';

    // Should compile but may error at runtime
    const module = await compileMDX(source);
    expect(module).toBeDefined();
  });
});

// ============================================================================
// Test: 7. Custom Component Integration
// ============================================================================

describe('MDX E2E Tests - Custom Components', () => {
  let container: HTMLElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    dispose?.();
    cleanupContainer(container);
  });

  test('should integrate custom Alert component', async () => {
    const Alert = defineComponent<{ type: string; children?: any }>((props) => {
      return () => jsx('div', {
        class: `alert alert-${props.type}`,
        role: 'alert',
        children: props.children
      });
    });

    const source = '<Alert type="warning">This is a warning!</Alert>';
    const result = await renderMDXWithProvider(source, container, { Alert });
    dispose = result.dispose;

    expect(container.querySelector('.alert')).toBeTruthy();
    expect(container.querySelector('.alert-warning')).toBeTruthy();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('This is a warning!');
  });

  test('should integrate custom Card with complex structure', async () => {
    const Card = defineComponent<{ title: string; footer?: string; children?: any }>((props) => {
      return () => jsx('div', {
        class: 'card',
        children: [
          jsx('div', { class: 'card-header', children: props.title }),
          jsx('div', { class: 'card-body', children: props.children }),
          props.footer && jsx('div', { class: 'card-footer', children: props.footer })
        ]
      });
    });

    const source = `
<Card title="My Card" footer="Footer text">

## Card Content

This is **markdown** inside the card.

</Card>
`;

    const result = await renderMDXWithProvider(source, container, { Card });
    dispose = result.dispose;

    expect(container.querySelector('.card')).toBeTruthy();
    expect(container.querySelector('.card-header')?.textContent).toBe('My Card');
    expect(container.querySelector('.card-body h2')).toBeTruthy();
    expect(container.querySelector('.card-body strong')).toBeTruthy();
    expect(container.querySelector('.card-footer')?.textContent).toBe('Footer text');
  });

  test('should integrate reactive custom components', async () => {
    const count = signal(0);

    const Counter = defineComponent(() => {
      return () => jsx('div', {
        class: 'counter',
        children: [
          jsx('span', { children: `Count: ${count()}` }),
          jsx('button', {
            onClick: () => count.set(count() + 1),
            children: 'Increment'
          })
        ]
      });
    });

    const source = '<Counter />';
    const result = await renderMDXWithProvider(source, container, { Counter });
    dispose = result.dispose;

    expect(container.querySelector('.counter span')?.textContent).toBe('Count: 0');

    const button = container.querySelector('.counter button') as HTMLButtonElement;
    button.click();
    await waitForDOM(10);

    expect(container.querySelector('.counter span')?.textContent).toBe('Count: 1');
  });

  test('should pass props to custom components', async () => {
    const Badge = defineComponent<{ color: string; size: string; children?: any }>((props) => {
      return () => jsx('span', {
        class: `badge badge-${props.color} badge-${props.size}`,
        children: props.children
      });
    });

    const source = '<Badge color="blue" size="large">Premium</Badge>';
    const result = await renderMDXWithProvider(source, container, { Badge });
    dispose = result.dispose;

    expect(container.querySelector('.badge')).toBeTruthy();
    expect(container.querySelector('.badge-blue')).toBeTruthy();
    expect(container.querySelector('.badge-large')).toBeTruthy();
    expect(container.querySelector('.badge')?.textContent).toBe('Premium');
  });
});

// ============================================================================
// Test: 8. Lazy Loading of MDX Modules
// ============================================================================

describe('MDX E2E Tests - Lazy Loading', () => {
  let container: HTMLElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    dispose?.();
    cleanupContainer(container);
  });

  test('should lazy load MDX module', async () => {
    const loadMDX = async () => {
      // Add artificial delay to simulate async loading
      await new Promise(resolve => setTimeout(resolve, 20));
      return compileMDX('# Lazy Loaded Content\n\nThis content was loaded lazily.');
    };

    const LazyMDX = defineComponent(() => {
      const module = signal<any>(null);
      const loading = signal(true);

      onMount(async () => {
        const loaded = await loadMDX();
        module.set(loaded);
        loading.set(false);
      });

      return () => {
        if (loading()) {
          return jsx('div', { class: 'loading', children: 'Loading...' });
        }
        if (module()) {
          return jsx(module().default, {});
        }
        return null;
      };
    });

    const source = '<LazyMDX />';
    const result = await renderMDXWithProvider(source, container, { LazyMDX });
    dispose = result.dispose;

    // Initially should show loading
    expect(container.querySelector('.loading')).toBeTruthy();

    // Wait for lazy load
    await waitForDOM(100);

    // Should show loaded content
    expect(container.querySelector('h1')?.textContent).toContain('Lazy Loaded Content');
  });

  test('should handle lazy loading errors', async () => {
    const loadMDX = async () => {
      throw new Error('Failed to load MDX');
    };

    const LazyMDX = defineComponent(() => {
      const error = signal<Error | null>(null);
      const loading = signal(true);

      onMount(async () => {
        try {
          await loadMDX();
        } catch (err) {
          error.set(err as Error);
        } finally {
          loading.set(false);
        }
      });

      return () => {
        if (loading()) {
          return jsx('div', { class: 'loading', children: 'Loading...' });
        }
        if (error()) {
          return jsx('div', {
            class: 'error',
            children: `Error: ${error()!.message}`
          });
        }
        return null;
      };
    });

    const source = '<LazyMDX />';
    const result = await renderMDXWithProvider(source, container, { LazyMDX });
    dispose = result.dispose;

    await waitForDOM(100);

    expect(container.querySelector('.error')).toBeTruthy();
    expect(container.querySelector('.error')?.textContent).toContain('Failed to load MDX');
  });
});

// ============================================================================
// Test: 9. Theme Switching
// ============================================================================

describe('MDX E2E Tests - Theme Switching', () => {
  let container: HTMLElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = createContainer();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    dispose?.();
    cleanupContainer(container);
    document.documentElement.removeAttribute('data-theme');
  });

  test('should switch themes reactively', async () => {
    const theme = signal<'light' | 'dark'>('light');

    const ThemeToggle = defineComponent(() => {
      const toggleTheme = () => {
        theme.set(theme() === 'light' ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme());
      };

      return () => jsx('div', {
        class: `theme-container theme-${theme()}`,
        children: [
          jsx('div', {
            class: 'current-theme',
            children: `Current theme: ${theme()}`
          }),
          jsx('button', {
            class: 'theme-toggle',
            onClick: toggleTheme,
            children: 'Toggle Theme'
          })
        ]
      });
    });

    const source = '<ThemeToggle />';
    const result = await renderMDXWithProvider(source, container, { ThemeToggle });
    dispose = result.dispose;

    expect(container.querySelector('.theme-light')).toBeTruthy();
    expect(container.querySelector('.current-theme')?.textContent).toBe('Current theme: light');

    const button = container.querySelector('.theme-toggle') as HTMLButtonElement;
    button.click();
    await waitForDOM(10);

    expect(container.querySelector('.theme-dark')).toBeTruthy();
    expect(container.querySelector('.current-theme')?.textContent).toBe('Current theme: dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  test('should apply theme-specific styles', async () => {
    const theme = signal<'light' | 'dark'>('light');

    const ThemedContent = defineComponent(() => {
      const styles = computed(() =>
        theme() === 'light'
          ? 'background: white; color: black;'
          : 'background: black; color: white;'
      );

      return () => jsx('div', {
        class: 'themed-content',
        style: styles(),
        children: 'Themed content'
      });
    });

    const source = '<ThemedContent />';
    const result = await renderMDXWithProvider(source, container, { ThemedContent });
    dispose = result.dispose;

    const element = container.querySelector('.themed-content') as HTMLElement;
    expect(element.style.background).toBe('white');
    expect(element.style.color).toBe('black');

    theme.set('dark');
    await waitForDOM(10);

    expect(element.style.background).toBe('black');
    expect(element.style.color).toBe('white');
  });

  test('should persist theme preference', async () => {
    const theme = signal<'light' | 'dark'>('light');

    const ThemeProvider = defineComponent<{ children?: any }>((props) => {
      onMount(() => {
        const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
        if (saved) {
          theme.set(saved);
        }
      });

      effect(() => {
        localStorage.setItem('theme', theme());
      });

      return () => props.children;
    });

    const source = '<ThemeProvider><div>Content</div></ThemeProvider>';
    const result = await renderMDXWithProvider(source, container, { ThemeProvider });
    dispose = result.dispose;

    theme.set('dark');
    await waitForDOM(10);

    expect(localStorage.getItem('theme')).toBe('dark');

    localStorage.removeItem('theme');
  });
});

// ============================================================================
// Test: 10. Complex Integration Scenarios
// ============================================================================

describe('MDX E2E Tests - Complex Integration', () => {
  let container: HTMLElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    dispose?.();
    cleanupContainer(container);
  });

  test('should handle full application with MDX, reactivity, and events', async () => {
    // Create shared signals that both test and component will use
    const todos = signal<Array<{ id: number; text: string; done: boolean }>>([]);
    const input = signal('');
    const filter = signal<'all' | 'active' | 'completed'>('all');

    const TodoApp = defineComponent(() => {
      // Use the shared signals from closure
      const addTodo = () => {
        if (input().trim()) {
          todos.set([...todos(), {
            id: Date.now(),
            text: input(),
            done: false
          }]);
          input.set('');
        }
      };

      const toggleTodo = (id: number) => {
        todos.set(todos().map(todo =>
          todo.id === id ? { ...todo, done: !todo.done } : todo
        ));
      };

      const filteredTodos = computed(() => {
        switch (filter()) {
          case 'active': return todos().filter(t => !t.done);
          case 'completed': return todos().filter(t => t.done);
          default: return todos();
        }
      });

      return () => jsx('div', {
        class: 'todo-app',
        children: [
          jsx('h1', { children: 'Todo App' }),
          jsx('div', {
            class: 'input-group',
            children: [
              jsx('input', {
                type: 'text',
                class: 'todo-input',
                value: input(),
                onInput: (e: Event) => input.set((e.target as HTMLInputElement).value),
                placeholder: 'Add todo...'
              }),
              jsx('button', {
                class: 'add-btn',
                onClick: addTodo,
                children: 'Add'
              })
            ]
          }),
          jsx('div', {
            class: 'filters',
            children: ['all', 'active', 'completed'].map(f =>
              jsx('button', {
                class: filter() === f ? 'active' : '',
                onClick: () => filter.set(f as any),
                children: f,
                key: f
              })
            )
          }),
          jsx('ul', {
            class: 'todo-list',
            children: filteredTodos().map(todo =>
              jsx('li', {
                class: todo.done ? 'done' : '',
                onClick: () => toggleTodo(todo.id),
                children: todo.text,
                key: todo.id
              })
            )
          }),
          jsx('div', {
            class: 'stats',
            children: `${todos().filter(t => !t.done).length} remaining`
          })
        ]
      });
    });

    const source = '<TodoApp />';
    const result = await renderMDXWithProvider(source, container, { TodoApp });
    dispose = result.dispose;

    expect(container.querySelector('.todo-app')).toBeTruthy();

    // Add todo
    const inputElement = container.querySelector('.todo-input') as HTMLInputElement;
    const addBtn = container.querySelector('.add-btn') as HTMLButtonElement;

    inputElement.value = 'Test todo';
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForDOM(10);

    addBtn.click();
    await waitForDOM(50); // Wait for add operation to complete

    expect(container.querySelectorAll('.todo-list li')).toHaveLength(1);
    expect(container.querySelector('.todo-list li')?.textContent).toBe('Test todo');
    expect(container.querySelector('.stats')?.textContent).toBe('1 remaining');

    // Toggle todo - find element fresh after render
    await waitForDOM(50); // Ensure all effects have run
    const todoItem = container.querySelector('.todo-list li') as HTMLElement;
    expect(todoItem).toBeTruthy();

    todoItem.click();
    await waitForDOM(100); // Give time for reactive update and re-render

    // Verify the DOM was updated - the todo item should have 'done' class
    const updatedTodoItem = container.querySelector('.todo-list li') as HTMLElement;
    expect(updatedTodoItem.classList.contains('done')).toBe(true);

    // Verify stats reflect the change
    expect(container.querySelector('.stats')?.textContent).toBe('0 remaining');

    // Filter todos
    const filterBtns = container.querySelectorAll('.filters button');
    (filterBtns[2] as HTMLButtonElement).click(); // completed
    await waitForDOM(10);

    expect(container.querySelectorAll('.todo-list li')).toHaveLength(1);
  });

  test('should handle nested MDX with scoped reactivity', async () => {
    const globalCount = signal(0);

    const ParentComponent = defineComponent(() => {
      const localCount = signal(0);

      return () => jsx('div', {
        class: 'parent',
        children: [
          jsx('div', {
            class: 'global-count',
            children: `Global: ${globalCount()}`
          }),
          jsx('div', {
            class: 'local-count',
            children: `Local: ${localCount()}`
          }),
          jsx('button', {
            class: 'inc-global',
            onClick: () => globalCount.set(globalCount() + 1),
            children: 'Inc Global'
          }),
          jsx('button', {
            class: 'inc-local',
            onClick: () => localCount.set(localCount() + 1),
            children: 'Inc Local'
          })
        ]
      });
    });

    const source = '<ParentComponent />';
    const result = await renderMDXWithProvider(source, container, { ParentComponent });
    dispose = result.dispose;

    expect(container.querySelector('.global-count')?.textContent).toBe('Global: 0');
    expect(container.querySelector('.local-count')?.textContent).toBe('Local: 0');

    (container.querySelector('.inc-global') as HTMLButtonElement).click();
    await waitForDOM(10);
    expect(container.querySelector('.global-count')?.textContent).toBe('Global: 1');
    expect(container.querySelector('.local-count')?.textContent).toBe('Local: 0');

    (container.querySelector('.inc-local') as HTMLButtonElement).click();
    await waitForDOM(10);
    expect(container.querySelector('.global-count')?.textContent).toBe('Global: 1');
    expect(container.querySelector('.local-count')?.textContent).toBe('Local: 1');
  });

  test('should handle performance with many reactive components', async () => {
    const items = signal(Array.from({ length: 100 }, (_, i) => ({
      id: i,
      value: signal(i)
    })));

    const List = defineComponent(() => {
      return () => jsx('div', {
        class: 'perf-list',
        children: items().map(item =>
          jsx('div', {
            class: 'item',
            children: `Item ${item.id}: ${item.value()}`,
            key: item.id
          })
        )
      });
    });

    const source = '<List />';
    const result = await renderMDXWithProvider(source, container, { List });
    dispose = result.dispose;

    expect(container.querySelectorAll('.item')).toHaveLength(100);

    // Update single item
    const startTime = performance.now();
    items()[50].value.set(999);
    await waitForDOM(10);
    const endTime = performance.now();

    expect(container.querySelectorAll('.item')[50].textContent).toContain('999');
    // Update should be fast (< 100ms)
    expect(endTime - startTime).toBeLessThan(100);
  });
});
