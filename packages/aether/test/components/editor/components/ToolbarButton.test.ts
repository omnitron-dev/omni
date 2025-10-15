/**
 * ToolbarButton component tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../../src/core/index.js';
import { ToolbarButton } from '../../../../src/components/editor/components/ToolbarButton.js';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';

describe('ToolbarButton', () => {
  let mockEditor: EditorInstance;
  let editorSignal: ReturnType<typeof signal<EditorInstance | null>>;

  beforeEach(() => {
    mockEditor = {
      commands: {
        execute: vi.fn(() => true),
        can: vi.fn(() => true),
        chain: vi.fn(),
      },
      state: {} as any,
      view: {} as any,
      schema: {} as any,
      signals: {} as any,
      getHTML: vi.fn(),
      getJSON: vi.fn(),
      getText: vi.fn(),
      setContent: vi.fn(),
      clearContent: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
      isEmpty: vi.fn(() => false),
      isFocused: vi.fn(() => false),
      isEditable: vi.fn(() => true),
      destroy: vi.fn(),
    };
    editorSignal = signal<EditorInstance | null>(mockEditor);
  });

  it('should be defined', () => {
    expect(ToolbarButton).toBeDefined();
    expect(typeof ToolbarButton).toBe('function');
  });

  it('should have displayName', () => {
    expect(ToolbarButton.displayName).toBe('ToolbarButton');
  });

  it('should render button with icon', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
    }) as HTMLButtonElement;

    expect(element).toBeDefined();
    expect(element.tagName).toBe('BUTTON');
    expect(element.textContent).toBe('B');
    expect(element.title).toBe('Bold');
  });

  it('should have toolbar-button class', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
    }) as HTMLButtonElement;

    expect(element.classList.contains('toolbar-button')).toBe(true);
  });

  it('should apply custom class', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
      class: 'custom-button',
    }) as HTMLButtonElement;

    expect(element.classList.contains('toolbar-button')).toBe(true);
    expect(element.classList.contains('custom-button')).toBe(true);
  });

  it('should execute command on click', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
    }) as HTMLButtonElement;

    element.click();

    expect(mockEditor.commands?.execute).toHaveBeenCalledWith('bold');
  });

  it('should execute command with args', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'H1',
      title: 'Heading 1',
      command: 'heading',
      args: [1],
    }) as HTMLButtonElement;

    element.click();

    expect(mockEditor.commands?.execute).toHaveBeenCalledWith('heading', 1);
  });

  it('should execute command with multiple args', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'T',
      title: 'Test',
      command: 'test',
      args: ['arg1', 'arg2', 123],
    }) as HTMLButtonElement;

    element.click();

    expect(mockEditor.commands?.execute).toHaveBeenCalledWith('test', 'arg1', 'arg2', 123);
  });

  it('should not execute command when editor is null', () => {
    editorSignal.set(null);

    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
    }) as HTMLButtonElement;

    element.click();

    expect(mockEditor.commands?.execute).not.toHaveBeenCalled();
  });

  it('should apply active class when isActive returns true', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
      isActive: (editor) => true,
    }) as HTMLButtonElement;

    expect(element.classList.contains('active')).toBe(true);
  });

  it('should not apply active class when isActive returns false', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
      isActive: (editor) => false,
    }) as HTMLButtonElement;

    expect(element.classList.contains('active')).toBe(false);
  });

  it('should not apply active class when isActive is not provided', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
    }) as HTMLButtonElement;

    expect(element.classList.contains('active')).toBe(false);
  });

  it('should disable button when isDisabled returns true', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
      isDisabled: (editor) => true,
    }) as HTMLButtonElement;

    expect(element.disabled).toBe(true);
    expect(element.classList.contains('disabled')).toBe(true);
  });

  it('should not disable button when isDisabled returns false', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
      isDisabled: (editor) => false,
    }) as HTMLButtonElement;

    expect(element.disabled).toBe(false);
    expect(element.classList.contains('disabled')).toBe(false);
  });

  it('should not disable button when isDisabled is not provided', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
    }) as HTMLButtonElement;

    expect(element.disabled).toBe(false);
    expect(element.classList.contains('disabled')).toBe(false);
  });

  it('should not execute command when button is disabled', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
      isDisabled: (editor) => true,
    }) as HTMLButtonElement;

    element.click();

    expect(mockEditor.commands?.execute).not.toHaveBeenCalled();
  });

  it('should handle both active and disabled states', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
      isActive: (editor) => true,
      isDisabled: (editor) => true,
    }) as HTMLButtonElement;

    expect(element.classList.contains('active')).toBe(true);
    expect(element.classList.contains('disabled')).toBe(true);
    expect(element.disabled).toBe(true);
  });

  it('should receive editor instance in isActive callback', () => {
    const isActiveSpy = vi.fn((editor: EditorInstance) => {
      expect(editor).toBe(mockEditor);
      return true;
    });

    ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
      isActive: isActiveSpy,
    });

    expect(isActiveSpy).toHaveBeenCalledWith(mockEditor);
  });

  it('should receive editor instance in isDisabled callback', () => {
    const isDisabledSpy = vi.fn((editor: EditorInstance) => {
      expect(editor).toBe(mockEditor);
      return false;
    });

    ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
      isDisabled: isDisabledSpy,
    });

    expect(isDisabledSpy).toHaveBeenCalledWith(mockEditor);
  });

  it('should handle editor becoming null', () => {
    const element = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
      isActive: (editor) => true,
    }) as HTMLButtonElement;

    expect(element.classList.contains('active')).toBe(true);

    // Set editor to null
    editorSignal.set(null);

    // Create a new button instance to see the effect
    const element2 = ToolbarButton({
      editor: editorSignal,
      icon: 'B',
      title: 'Bold',
      command: 'bold',
      isActive: (editor) => true,
    }) as HTMLButtonElement;

    // Button should no longer be active since editor is null
    expect(element2.classList.contains('active')).toBe(false);
  });
});
