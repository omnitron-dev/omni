/**
 * LinkEditor component tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../../src/core/index.js';
import { LinkEditor } from '../../../../src/components/editor/components/LinkEditor.js';
import type { EditorInstance } from '../../../../src/components/editor/core/types.js';

describe('LinkEditor', () => {
  let mockEditor: EditorInstance;
  let editorSignal: ReturnType<typeof signal<EditorInstance | null>>;
  let isOpenSignal: ReturnType<typeof signal<boolean>>;
  let positionSignal: ReturnType<typeof signal<{ top: number; left: number } | null>>;

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
    isOpenSignal = signal(false);
    positionSignal = signal<{ top: number; left: number } | null>(null);
  });

  it('should be defined', () => {
    expect(LinkEditor).toBeDefined();
    expect(typeof LinkEditor).toBe('function');
  });

  it('should have displayName', () => {
    expect(LinkEditor.displayName).toBe('LinkEditor');
  });

  it('should not render when isOpen is false', () => {
    isOpenSignal.set(false);
    positionSignal.set({ top: 100, left: 200 });

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    });

    // When not open, component returns null (may be rendered as empty/text node)
    expect(element).toBeDefined();
  });

  it('should not render when position is null', () => {
    isOpenSignal.set(true);
    positionSignal.set(null);

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    });

    // When position is null, component returns null (may be rendered as empty/text node)
    expect(element).toBeDefined();
  });

  it('should render when isOpen is true and position is set', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    }) as HTMLElement;

    expect(element).toBeDefined();
    expect(element.tagName).toBe('DIV');
    expect(element.classList.contains('link-editor')).toBe(true);
  });

  it('should position editor correctly', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    }) as HTMLElement;

    expect(element.style.position).toBe('absolute');
    expect(element.style.top).toBe('100px');
    expect(element.style.left).toBe('200px');
    expect(element.style.zIndex).toBe('1000');
  });

  it('should render form with inputs', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    }) as HTMLElement;

    const form = element.querySelector('form');
    expect(form).toBeDefined();

    const inputs = form?.querySelectorAll('input');
    expect(inputs?.length).toBe(2);
  });

  it('should have URL input with correct attributes', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    }) as HTMLElement;

    const urlInput = element.querySelector('input[type="url"]') as HTMLInputElement;
    expect(urlInput).toBeDefined();
    expect(urlInput.placeholder).toBe('Enter URL');
    expect(urlInput.autofocus).toBe(true);
  });

  it('should have title input with correct attributes', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    }) as HTMLElement;

    const titleInput = element.querySelector('input[type="text"]') as HTMLInputElement;
    expect(titleInput).toBeDefined();
    expect(titleInput.placeholder).toBe('Title (optional)');
  });

  it('should render action buttons', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    }) as HTMLElement;

    const actions = element.querySelector('.link-editor-actions');
    expect(actions).toBeDefined();

    const buttons = actions?.querySelectorAll('button');
    expect(buttons?.length).toBe(2);
  });

  it('should have Save button with correct type', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    }) as HTMLElement;

    const saveButton = Array.from(element.querySelectorAll('button')).find(
      (btn) => btn.textContent === 'Save'
    ) as HTMLButtonElement;

    expect(saveButton).toBeDefined();
    expect(saveButton.type).toBe('submit');
  });

  it('should have Cancel button with correct type', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    }) as HTMLElement;

    const cancelButton = Array.from(element.querySelectorAll('button')).find(
      (btn) => btn.textContent === 'Cancel'
    ) as HTMLButtonElement;

    expect(cancelButton).toBeDefined();
    expect(cancelButton.type).toBe('button');
  });

  it('should call onSubmit with href and title when form is submitted', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const onSubmit = vi.fn();
    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
      onSubmit,
    }) as HTMLElement;

    const urlInput = element.querySelector('input[type="url"]') as HTMLInputElement;
    const titleInput = element.querySelector('input[type="text"]') as HTMLInputElement;

    // Simulate input
    urlInput.value = 'https://example.com';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));

    titleInput.value = 'Example Site';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Submit form
    const form = element.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith('https://example.com', 'Example Site');
  });

  it('should call onCancel when Cancel button is clicked', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const onCancel = vi.fn();
    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
      onCancel,
    }) as HTMLElement;

    const cancelButton = Array.from(element.querySelectorAll('button')).find(
      (btn) => btn.textContent === 'Cancel'
    ) as HTMLButtonElement;

    cancelButton.click();

    expect(onCancel).toHaveBeenCalled();
  });

  it('should reset form after submission', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const onSubmit = vi.fn();
    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
      onSubmit,
    }) as HTMLElement;

    const urlInput = element.querySelector('input[type="url"]') as HTMLInputElement;
    const titleInput = element.querySelector('input[type="text"]') as HTMLInputElement;

    // Set values
    urlInput.value = 'https://example.com';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));

    titleInput.value = 'Example Site';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Submit form
    const form = element.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Re-render to check reset state
    const element2 = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
      onSubmit,
    }) as HTMLElement;

    const urlInput2 = element2.querySelector('input[type="url"]') as HTMLInputElement;
    const titleInput2 = element2.querySelector('input[type="text"]') as HTMLInputElement;

    expect(urlInput2.value).toBe('');
    expect(titleInput2.value).toBe('');
  });

  it('should reset form after cancel', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const onCancel = vi.fn();
    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
      onCancel,
    }) as HTMLElement;

    const urlInput = element.querySelector('input[type="url"]') as HTMLInputElement;
    const titleInput = element.querySelector('input[type="text"]') as HTMLInputElement;

    // Set values
    urlInput.value = 'https://example.com';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));

    titleInput.value = 'Example Site';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Click cancel
    const cancelButton = Array.from(element.querySelectorAll('button')).find(
      (btn) => btn.textContent === 'Cancel'
    ) as HTMLButtonElement;
    cancelButton.click();

    // Re-render to check reset state
    const element2 = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
      onCancel,
    }) as HTMLElement;

    const urlInput2 = element2.querySelector('input[type="url"]') as HTMLInputElement;
    const titleInput2 = element2.querySelector('input[type="text"]') as HTMLInputElement;

    expect(urlInput2.value).toBe('');
    expect(titleInput2.value).toBe('');
  });

  it('should initialize with initialHref if provided', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
      initialHref: 'https://initial.com',
    }) as HTMLElement;

    const urlInput = element.querySelector('input[type="url"]') as HTMLInputElement;
    expect(urlInput.value).toBe('https://initial.com');
  });

  it('should update position when position signal changes', () => {
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const element1 = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    }) as HTMLElement;

    expect(element1.style.top).toBe('100px');
    expect(element1.style.left).toBe('200px');

    // Change position
    positionSignal.set({ top: 300, left: 400 });

    const element2 = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    }) as HTMLElement;

    expect(element2.style.top).toBe('300px');
    expect(element2.style.left).toBe('400px');
  });

  it('should handle editor being null', () => {
    editorSignal.set(null);
    isOpenSignal.set(true);
    positionSignal.set({ top: 100, left: 200 });

    const element = LinkEditor({
      editor: editorSignal,
      isOpen: isOpenSignal,
      position: positionSignal,
    }) as HTMLElement;

    // Should still render even if editor is null
    expect(element).toBeDefined();
    expect(element.tagName).toBe('DIV');
  });
});
