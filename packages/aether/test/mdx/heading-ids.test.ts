/**
 * Heading ID Generation Tests
 *
 * Tests for automatic ID generation on heading elements
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { compileMDXSync, MDXProvider } from '../../src/mdx/index.js';
import { render } from '../../src/testing/render.js';
import { jsx } from '../../src/jsx-runtime.js';
import { defineComponent } from '../../src/core/component/define.js';

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
 * Helper to render MDX with provider (similar to e2e tests)
 */
async function renderMDXWithProvider(
  source: string,
  container: HTMLElement,
  components?: Record<string, any>,
  scope?: Record<string, any>
): Promise<{ dispose: () => void; unmount: () => void }> {
  const module = compileMDXSync(source, {
    components,
    scope,
    mode: 'production',
    jsx: true,
    gfm: true,
    frontmatter: true
  });

  const MDXContent = module.default;

  const App = defineComponent(() => () => jsx(MDXProvider, {
      components,
      scope,
      children: jsx(MDXContent, {})
    }));

  const result = render(() => jsx(App, {}), { container });
  await waitForDOM(10);

  return {
    dispose: () => result.unmount(),
    unmount: () => result.unmount()
  };
}

describe('MDX Heading ID Generation', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    cleanupContainer(container);
  });

  test('should generate IDs for all heading levels', async () => {
    const source = `
# Level 1
## Level 2
### Level 3
#### Level 4
##### Level 5
###### Level 6
`;

    const result = await renderMDXWithProvider(source, container);

    expect(container.querySelector('h1')?.id).toBe('level-1');
    expect(container.querySelector('h2')?.id).toBe('level-2');
    expect(container.querySelector('h3')?.id).toBe('level-3');
    expect(container.querySelector('h4')?.id).toBe('level-4');
    expect(container.querySelector('h5')?.id).toBe('level-5');
    expect(container.querySelector('h6')?.id).toBe('level-6');

    result.unmount();
  });

  test('should slugify heading text correctly', async () => {
    const source = `
# Hello World
## This Is A Test
### UPPERCASE HEADING
#### with-dashes-already
##### Multiple   Spaces   Here
###### Special!@#$%Characters
`;

    const result = await renderMDXWithProvider(source, container);

    expect(container.querySelector('h1')?.id).toBe('hello-world');
    expect(container.querySelector('h2')?.id).toBe('this-is-a-test');
    expect(container.querySelector('h3')?.id).toBe('uppercase-heading');
    expect(container.querySelector('h4')?.id).toBe('with-dashes-already');
    expect(container.querySelector('h5')?.id).toBe('multiple-spaces-here');
    expect(container.querySelector('h6')?.id).toBe('specialcharacters');

    result.unmount();
  });

  test('should handle duplicate heading IDs with counters', async () => {
    const source = `
# Introduction
## Introduction
### Introduction
# Getting Started
## Getting Started
`;

    const result = await renderMDXWithProvider(source, container);

    const h1s = container.querySelectorAll('h1');
    const h2s = container.querySelectorAll('h2');
    const h3s = container.querySelectorAll('h3');

    expect(h1s[0]?.id).toBe('introduction');
    expect(h2s[0]?.id).toBe('introduction-2');
    expect(h3s[0]?.id).toBe('introduction-3');
    expect(h1s[1]?.id).toBe('getting-started');
    expect(h2s[1]?.id).toBe('getting-started-2');

    result.unmount();
  });

  test('should generate TOC with correct IDs', () => {
    const source = `
# Main Title
## Sub Section
### Deep Heading
`;

    const module = compileMDXSync(source);

    expect(module.toc).toBeDefined();
    expect(module.toc).toHaveLength(3);
    expect(module.toc[0]).toEqual({
      level: 1,
      title: 'Main Title',
      id: 'main-title'
    });
    expect(module.toc[1]).toEqual({
      level: 2,
      title: 'Sub Section',
      id: 'sub-section'
    });
    expect(module.toc[2]).toEqual({
      level: 3,
      title: 'Deep Heading',
      id: 'deep-heading'
    });
  });

  test('should handle empty headings', async () => {
    const source = `
#
##
`;

    const result = await renderMDXWithProvider(source, container);

    const h1 = container.querySelector('h1');
    const h2 = container.querySelector('h2');

    // Empty headings should still get some ID (empty string after slugification)
    expect(h1?.id).toBeDefined();
    expect(h2?.id).toBeDefined();

    result.unmount();
  });

  test('should handle headings with inline code', async () => {
    const source = '# Using `Array.map()` in JavaScript';

    const result = await renderMDXWithProvider(source, container);

    const h1 = container.querySelector('h1');
    // Note: Inline code elements get stripped during text extraction,
    // leaving only the surrounding text
    expect(h1?.id).toBe('using-in-javascript');

    result.unmount();
  });

  test('should handle headings with emphasis', async () => {
    const source = '# This is *emphasized* text';

    const result = await renderMDXWithProvider(source, container);

    const h1 = container.querySelector('h1');
    expect(h1?.id).toBe('this-is-emphasized-text');

    result.unmount();
  });

  test('should handle numbers in headings', async () => {
    const source = `
# Section 123
## Version 2.0
### Top 10 Items
`;

    const result = await renderMDXWithProvider(source, container);

    expect(container.querySelector('h1')?.id).toBe('section-123');
    expect(container.querySelector('h2')?.id).toBe('version-20');
    expect(container.querySelector('h3')?.id).toBe('top-10-items');

    result.unmount();
  });
});
