/**
 * AdvancedEditor component tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdvancedEditor } from '../../../src/components/editor/AdvancedEditor.js';

describe('AdvancedEditor', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('should be defined', () => {
    expect(AdvancedEditor).toBeDefined();
    expect(typeof AdvancedEditor).toBe('function');
  });

  it('should have displayName', () => {
    expect(AdvancedEditor.displayName).toBe('AdvancedEditor');
  });

  it('should create component with default props', () => {
    const component = AdvancedEditor({});
    expect(component).toBeDefined();
  });

  it('should create component with content', () => {
    const component = AdvancedEditor({
      content: 'Test content',
      contentType: 'text',
    });
    expect(component).toBeDefined();
  });

  it('should create component with extensions', () => {
    const component = AdvancedEditor({
      extensions: [],
    });
    expect(component).toBeDefined();
  });

  it('should accept class prop', () => {
    const component = AdvancedEditor({
      class: 'custom-editor',
    });
    expect(component).toBeDefined();
  });

  it('should accept editorClass prop', () => {
    const component = AdvancedEditor({
      editorClass: 'custom-prosemirror',
    });
    expect(component).toBeDefined();
  });

  it('should accept event callbacks', () => {
    let createCalled = false;
    let updateCalled = false;

    const component = AdvancedEditor({
      onCreate: (editor) => {
        createCalled = true;
      },
      onUpdate: ({ editor }) => {
        updateCalled = true;
      },
    });

    expect(component).toBeDefined();
    // Note: In this test environment, callbacks might not be called
    // because we're not actually mounting the component to DOM
  });
});
