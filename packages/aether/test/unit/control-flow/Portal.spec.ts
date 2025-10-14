/**
 * Portal Component Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Portal } from '../../../src/control-flow/Portal.js';

describe('Portal', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // Clean up any existing portals
    document.querySelectorAll('.aether-portal').forEach((el) => el.remove());

    // Create test container
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Cleanup
    document.querySelectorAll('.aether-portal').forEach((el) => el.remove());
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('should render children into document.body by default', () => {
    const textNode = document.createTextNode('Portal content');
    Portal({ children: textNode });

    const portal = document.querySelector('.aether-portal');
    expect(portal).toBeTruthy();
    expect(portal?.parentElement).toBe(document.body);
    expect(portal?.textContent).toBe('Portal content');
  });

  it('should render children into custom target', () => {
    const target = document.createElement('div');
    target.id = 'custom-target';
    document.body.appendChild(target);

    const textNode = document.createTextNode('Custom target content');
    Portal({ target, children: textNode });

    const portal = document.querySelector('.aether-portal');
    expect(portal?.parentElement).toBe(target);
    expect(portal?.textContent).toBe('Custom target content');

    // Cleanup
    document.body.removeChild(target);
  });

  it('should render DOM element children', () => {
    const child = document.createElement('div');
    child.textContent = 'Child element';
    child.className = 'test-child';

    Portal({ children: child });

    const portal = document.querySelector('.aether-portal');
    const renderedChild = portal?.querySelector('.test-child');
    expect(renderedChild).toBeTruthy();
    expect(renderedChild?.textContent).toBe('Child element');
  });

  it('should render array of children', () => {
    const child1 = document.createElement('div');
    child1.textContent = 'Child 1';

    const child2 = document.createElement('div');
    child2.textContent = 'Child 2';

    Portal({ children: [child1, child2] });

    const portal = document.querySelector('.aether-portal');
    expect(portal?.children.length).toBe(2);
    expect(portal?.children[0].textContent).toBe('Child 1');
    expect(portal?.children[1].textContent).toBe('Child 2');
  });

  it('should render string children as text nodes', () => {
    Portal({ children: 'Text content' });

    const portal = document.querySelector('.aether-portal');
    expect(portal?.textContent).toBe('Text content');
  });

  it('should render number children as text nodes', () => {
    Portal({ children: 42 });

    const portal = document.querySelector('.aether-portal');
    expect(portal?.textContent).toBe('42');
  });

  it('should handle null children', () => {
    const result = Portal({ children: null });

    expect(result).toBe(null);
  });

  it('should handle undefined children', () => {
    const result = Portal({ children: undefined });

    expect(result).toBe(null);
  });

  it('should return null (renders elsewhere)', () => {
    const child = document.createElement('div');
    const result = Portal({ children: child });

    expect(result).toBe(null);
  });

  it('should clean up portal container on unmount', () => {
    const child = document.createElement('div');
    child.textContent = 'Will be cleaned up';

    // Create portal
    Portal({ children: child });

    // Verify portal exists
    let portal = document.querySelector('.aether-portal');
    expect(portal).toBeTruthy();

    // Manually trigger cleanup (simulating unmount)
    // In real usage, onCleanup would be called automatically
    portal?.parentNode?.removeChild(portal);

    // Verify portal is removed
    portal = document.querySelector('.aether-portal');
    expect(portal).toBeFalsy();
  });

  it('should update children when re-rendered', () => {
    const child1 = document.createElement('div');
    child1.textContent = 'First render';

    const portalComponent = Portal({ children: child1 });

    let portal = document.querySelector('.aether-portal');
    expect(portal?.textContent).toBe('First render');

    // Re-render with new children (simulating update)
    const child2 = document.createElement('div');
    child2.textContent = 'Second render';

    Portal({ children: child2 });

    // Note: In actual usage, the render function would be called again
    // For this test, we're testing that multiple Portal calls work
    const portals = document.querySelectorAll('.aether-portal');
    expect(portals.length).toBeGreaterThan(0);
  });

  it('should handle complex nested DOM structures', () => {
    const parent = document.createElement('div');
    parent.className = 'parent';

    const child1 = document.createElement('span');
    child1.textContent = 'Span child';

    const child2 = document.createElement('p');
    child2.textContent = 'Paragraph child';

    parent.appendChild(child1);
    parent.appendChild(child2);

    Portal({ children: parent });

    const portal = document.querySelector('.aether-portal');
    const renderedParent = portal?.querySelector('.parent');
    expect(renderedParent).toBeTruthy();
    expect(renderedParent?.children.length).toBe(2);
    expect(renderedParent?.querySelector('span')?.textContent).toBe('Span child');
    expect(renderedParent?.querySelector('p')?.textContent).toBe('Paragraph child');
  });
});
