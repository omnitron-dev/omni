/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import {
  Editable,
  EditablePreview,
  EditableInput,
  EditableControls,
  EditableSubmit,
  EditableCancel,
} from '../../../src/primitives/Editable.js';
import { renderComponent, createSpy, nextTick } from '../../helpers/test-utils.js';

describe('Editable', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Component Exports', () => {
    it('should export Editable component', () => {
      expect(Editable).toBeDefined();
      expect(typeof Editable).toBe('function');
    });

    it('should export EditablePreview component', () => {
      expect(EditablePreview).toBeDefined();
      expect(typeof EditablePreview).toBe('function');
    });

    it('should export EditableInput component', () => {
      expect(EditableInput).toBeDefined();
      expect(typeof EditableInput).toBe('function');
    });

    it('should export EditableControls component', () => {
      expect(EditableControls).toBeDefined();
      expect(typeof EditableControls).toBe('function');
    });

    it('should export EditableSubmit component', () => {
      expect(EditableSubmit).toBeDefined();
      expect(typeof EditableSubmit).toBe('function');
    });

    it('should export EditableCancel component', () => {
      expect(EditableCancel).toBeDefined();
      expect(typeof EditableCancel).toBe('function');
    });

    it('should have sub-components attached', () => {
      expect((Editable as any).Preview).toBe(EditablePreview);
      expect((Editable as any).Input).toBe(EditableInput);
      expect((Editable as any).Controls).toBe(EditableControls);
      expect((Editable as any).Submit).toBe(EditableSubmit);
      expect((Editable as any).Cancel).toBe(EditableCancel);
    });
  });

  describe('Basic Rendering', () => {
    it('should render container with data-editable attribute', () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({ children: 'Click to edit' }), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const editableEl = container.querySelector('[data-editable]');
      expect(editableEl).toBeTruthy();
    });

    it('should render preview in display mode', () => {
      const component = () =>
        Editable({
          children: () => [
            EditablePreview({ children: 'Click to edit' }),
            EditableInput({}),
          ],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]');
      expect(preview).toBeTruthy();
      expect(preview?.textContent).toBe('Click to edit');
    });

    it('should not render input in display mode', () => {
      const component = () =>
        Editable({
          children: () => [
            EditablePreview({ children: 'Click to edit' }),
            EditableInput({}),
          ],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('[data-editable-input]') as HTMLElement;
      expect(input.style.display).toBe('none');
    });
  });

  describe('Display Mode vs Edit Mode', () => {
    it('should start in display mode by default', () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({ children: 'Text' }), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const editableEl = container.querySelector('[data-editable]');
      expect(editableEl?.hasAttribute('data-editing')).toBe(false);
    });

    it('should start in edit mode when startWithEditView is true', () => {
      const component = () =>
        Editable({
          startWithEditView: true,
          children: () => [EditablePreview({ children: 'Text' }), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const editableEl = container.querySelector('[data-editable]');
      expect(editableEl?.hasAttribute('data-editing')).toBe(true);
    });

    it('should switch to edit mode when preview is clicked', async () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({ children: 'Click me' }), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]');
      expect(input).toBeTruthy();
    });

    it('should render input in edit mode', async () => {
      const component = () =>
        Editable({
          defaultValue: 'Test',
          children: () => [EditablePreview({ children: 'Test' }), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe('Test');
    });

    it('should hide preview in edit mode', async () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({ children: 'Text' }), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const previewAfter = container.querySelector('[data-editable-preview]') as HTMLElement;
      expect(previewAfter.style.display).toBe('none');
    });
  });

  describe('Controlled Mode', () => {
    it('should use controlled value', () => {
      const value = signal('Controlled text');
      const component = () =>
        Editable({
          value: value(),
          children: () => [EditablePreview({ children: value() }), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]');
      expect(preview?.textContent).toBe('Controlled text');
    });

    it('should update when signal changes', async () => {
      const value = signal('Initial');
      const component = () =>
        Editable({
          value: value, // Pass signal directly
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      let preview = container.querySelector('[data-editable-preview]');
      expect(preview?.textContent).toBe('Initial');

      value.set('Updated');

      await nextTick();

      preview = container.querySelector('[data-editable-preview]');
      expect(preview?.textContent).toBe('Updated');
    });

    it('should call onValueChange when submitted', async () => {
      const value = signal('Initial');
      const onValueChange = createSpy();
      const component = () =>
        Editable({
          value: value(),
          onValueChange,
          children: () => [EditablePreview({ children: value() }), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.value = 'New value';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      input.dispatchEvent(enterEvent);

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toBe('New value');
    });
  });

  describe('Uncontrolled Mode', () => {
    it('should use defaultValue', () => {
      const component = () =>
        Editable({
          defaultValue: 'Default text',
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]');
      expect(preview?.textContent).toBe('Default text');
    });

    it('should start with empty value if no defaultValue', () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]');
      expect(preview?.textContent).toBe('Enter text...');
    });
  });

  describe('onValueChange Callback', () => {
    it('should call onValueChange when value is submitted', async () => {
      const onValueChange = createSpy();
      const component = () =>
        Editable({
          defaultValue: 'Initial',
          onValueChange,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.value = 'Changed';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      input.dispatchEvent(enterEvent);

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toBe('Changed');
    });

    it('should work with vi.fn() spy', async () => {
      const onValueChange = vi.fn();
      const component = () =>
        Editable({
          defaultValue: 'Test',
          onValueChange,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.value = 'New';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith('New');
    });
  });

  describe('Submit on Enter', () => {
    it('should submit value on Enter key', async () => {
      const onSubmit = createSpy();
      const component = () =>
        Editable({
          defaultValue: 'Text',
          onSubmit,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.value = 'Submitted';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      input.dispatchEvent(enterEvent);

      expect(onSubmit.callCount).toBe(1);
      expect(onSubmit.calls[0][0]).toBe('Submitted');
    });

    it('should prevent default on Enter key', async () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const preventDefaultSpy = vi.spyOn(enterEvent, 'preventDefault');

      input.dispatchEvent(enterEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should not submit on Shift+Enter', async () => {
      const onSubmit = createSpy();
      const component = () =>
        Editable({
          onSubmit,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      const shiftEnterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
      });
      input.dispatchEvent(shiftEnterEvent);

      expect(onSubmit.callCount).toBe(0);
    });

    it('should return to preview mode after submit', async () => {
      const component = () =>
        Editable({
          defaultValue: 'Text',
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      await nextTick();

      const previewAfter = container.querySelector('[data-editable-preview]') as HTMLElement;
      expect(previewAfter.style.display).not.toBe('none');

      const inputAfter = container.querySelector('[data-editable-input]') as HTMLElement;
      expect(inputAfter.style.display).toBe('none');
    });
  });

  describe('Cancel on Escape', () => {
    it('should cancel edit on Escape key', async () => {
      const onCancel = createSpy();
      const component = () =>
        Editable({
          defaultValue: 'Original',
          onCancel,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.value = 'Changed';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      input.dispatchEvent(escapeEvent);

      expect(onCancel.callCount).toBe(1);
    });

    it('should prevent default on Escape key', async () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      const preventDefaultSpy = vi.spyOn(escapeEvent, 'preventDefault');

      input.dispatchEvent(escapeEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should revert to original value on cancel', async () => {
      const component = () =>
        Editable({
          defaultValue: 'Original',
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      let preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      expect(preview.textContent).toBe('Original');

      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.value = 'Changed';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      await nextTick();

      preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      expect(preview.textContent).toBe('Original');
    });

    it('should return to preview mode after cancel', async () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      await nextTick();

      const previewAfter = container.querySelector('[data-editable-preview]');
      expect(previewAfter).toBeTruthy();
    });
  });

  describe('Submit on Blur', () => {
    it('should submit on blur by default', async () => {
      const onSubmit = createSpy();
      const component = () =>
        Editable({
          defaultValue: 'Text',
          onSubmit,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.value = 'Changed';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

      expect(onSubmit.callCount).toBe(1);
    });

    it('should not submit on blur when submitOnBlur is false', async () => {
      const onSubmit = createSpy();
      const component = () =>
        Editable({
          submitOnBlur: false,
          onSubmit,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.value = 'Changed';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

      expect(onSubmit.callCount).toBe(0);
    });
  });

  describe('Disabled State', () => {
    it('should have data-disabled attribute', () => {
      const component = () =>
        Editable({
          disabled: true,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const editableEl = container.querySelector('[data-editable]');
      expect(editableEl?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not switch to edit mode when disabled', async () => {
      const component = () =>
        Editable({
          disabled: true,
          children: () => [EditablePreview({ children: 'Text' }), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLElement;
      expect(input.style.display).toBe('none');
    });

    it('should disable input when disabled', async () => {
      const component = () =>
        Editable({
          disabled: true,
          startWithEditView: true,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      expect(input?.disabled).toBe(true);
    });
  });

  describe('Placeholder Text', () => {
    it('should show placeholder when value is empty', () => {
      const component = () =>
        Editable({
          placeholder: 'Enter your name',
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]');
      expect(preview?.textContent).toBe('Enter your name');
    });

    it('should use default placeholder if not provided', () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]');
      expect(preview?.textContent).toBe('Enter text...');
    });

    it('should show value instead of placeholder when value exists', () => {
      const component = () =>
        Editable({
          defaultValue: 'John',
          placeholder: 'Enter your name',
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]');
      expect(preview?.textContent).toBe('John');
    });

    it('should set placeholder on input element', async () => {
      const component = () =>
        Editable({
          placeholder: 'Type here',
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      expect(input.placeholder).toBe('Type here');
    });
  });

  describe('ARIA Attributes', () => {
    it('should have role="button" on preview', () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]');
      expect(preview?.getAttribute('role')).toBe('button');
    });

    it('should have aria-label on preview', () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]');
      expect(preview?.getAttribute('aria-label')).toBe('Click to edit');
    });

    it('should have tabIndex=0 on preview when not disabled', () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]');
      expect(preview?.getAttribute('tabindex')).toBe('0');
    });

    it('should have tabIndex=-1 on preview when disabled', () => {
      const component = () =>
        Editable({
          disabled: true,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]');
      expect(preview?.getAttribute('tabindex')).toBe('-1');
    });

    it('should have aria-label on submit button', async () => {
      const component = () =>
        Editable({
          startWithEditView: true,
          children: () => [
            EditablePreview({}),
            EditableInput({}),
            EditableControls({
              children: [EditableSubmit({}), EditableCancel({})],
            }),
          ],
        });
      const { container } = renderComponent(component);

      const submitBtn = container.querySelector('[data-editable-submit]');
      expect(submitBtn?.getAttribute('aria-label')).toBe('Submit');
    });

    it('should have aria-label on cancel button', async () => {
      const component = () =>
        Editable({
          startWithEditView: true,
          children: () => [
            EditablePreview({}),
            EditableInput({}),
            EditableControls({
              children: [EditableSubmit({}), EditableCancel({})],
            }),
          ],
        });
      const { container } = renderComponent(component);

      const cancelBtn = container.querySelector('[data-editable-cancel]');
      expect(cancelBtn?.getAttribute('aria-label')).toBe('Cancel');
    });
  });

  describe('Data Attributes', () => {
    it('should have data-editing when in edit mode', async () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const editableEl = container.querySelector('[data-editable]');
      expect(editableEl?.hasAttribute('data-editing')).toBe(true);
    });

    it('should not have data-editing in preview mode', () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const editableEl = container.querySelector('[data-editable]');
      expect(editableEl?.hasAttribute('data-editing')).toBe(false);
    });
  });

  describe('EditableControls', () => {
    it('should render controls in edit mode', async () => {
      const component = () =>
        Editable({
          startWithEditView: true,
          children: () => [
            EditablePreview({}),
            EditableInput({}),
            EditableControls({
              children: 'Controls',
            }),
          ],
        });
      const { container } = renderComponent(component);

      const controls = container.querySelector('[data-editable-controls]');
      expect(controls).toBeTruthy();
    });

    it('should not render controls in preview mode', () => {
      const component = () =>
        Editable({
          children: () => [
            EditablePreview({}),
            EditableInput({}),
            EditableControls({
              children: 'Controls',
            }),
          ],
        });
      const { container } = renderComponent(component);

      const controls = container.querySelector('[data-editable-controls]') as HTMLElement;
      expect(controls.style.display).toBe('none');
    });
  });

  describe('EditableSubmit Button', () => {
    it('should render submit button with default text', async () => {
      const component = () =>
        Editable({
          startWithEditView: true,
          children: () => [
            EditablePreview({}),
            EditableInput({}),
            EditableControls({
              children: EditableSubmit({}),
            }),
          ],
        });
      const { container } = renderComponent(component);

      const submitBtn = container.querySelector('[data-editable-submit]');
      expect(submitBtn).toBeTruthy();
      expect(submitBtn?.textContent).toBe('✓');
    });

    it('should submit on click', async () => {
      const onSubmit = createSpy();
      const component = () =>
        Editable({
          startWithEditView: true,
          defaultValue: 'Test',
          onSubmit,
          children: () => [
            EditablePreview({}),
            EditableInput({}),
            EditableControls({
              children: EditableSubmit({}),
            }),
          ],
        });
      const { container } = renderComponent(component);

      const submitBtn = container.querySelector('[data-editable-submit]') as HTMLElement;
      submitBtn.click();

      expect(onSubmit.callCount).toBe(1);
    });

    it('should be disabled when editable is disabled', async () => {
      const component = () =>
        Editable({
          disabled: true,
          startWithEditView: true,
          children: () => [
            EditablePreview({}),
            EditableInput({}),
            EditableControls({
              children: EditableSubmit({}),
            }),
          ],
        });
      const { container } = renderComponent(component);

      const submitBtn = container.querySelector(
        '[data-editable-submit]',
      ) as HTMLButtonElement;
      expect(submitBtn.disabled).toBe(true);
    });
  });

  describe('EditableCancel Button', () => {
    it('should render cancel button with default text', async () => {
      const component = () =>
        Editable({
          startWithEditView: true,
          children: () => [
            EditablePreview({}),
            EditableInput({}),
            EditableControls({
              children: EditableCancel({}),
            }),
          ],
        });
      const { container } = renderComponent(component);

      const cancelBtn = container.querySelector('[data-editable-cancel]');
      expect(cancelBtn).toBeTruthy();
      expect(cancelBtn?.textContent).toBe('×');
    });

    it('should cancel on click', async () => {
      const onCancel = createSpy();
      const component = () =>
        Editable({
          startWithEditView: true,
          onCancel,
          children: () => [
            EditablePreview({}),
            EditableInput({}),
            EditableControls({
              children: EditableCancel({}),
            }),
          ],
        });
      const { container } = renderComponent(component);

      const cancelBtn = container.querySelector('[data-editable-cancel]') as HTMLElement;
      cancelBtn.click();

      expect(onCancel.callCount).toBe(1);
    });

    it('should be disabled when editable is disabled', async () => {
      const component = () =>
        Editable({
          disabled: true,
          startWithEditView: true,
          children: () => [
            EditablePreview({}),
            EditableInput({}),
            EditableControls({
              children: EditableCancel({}),
            }),
          ],
        });
      const { container } = renderComponent(component);

      const cancelBtn = container.querySelector(
        '[data-editable-cancel]',
      ) as HTMLButtonElement;
      expect(cancelBtn.disabled).toBe(true);
    });
  });

  describe('Custom Props Pass-through', () => {
    it('should pass custom props to input', async () => {
      const component = () =>
        Editable({
          startWithEditView: true,
          children: () => [
            EditablePreview({}),
            EditableInput({ 'data-testid': 'custom-input', class: 'custom-class' }),
          ],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      expect(input.getAttribute('data-testid')).toBe('custom-input');
      expect(input.classList.contains('custom-class')).toBe(true);
    });

    it('should pass custom props to preview', () => {
      const component = () =>
        Editable({
          children: () => [
            EditablePreview({ 'data-testid': 'custom-preview', class: 'preview-class' }),
            EditableInput({}),
          ],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      expect(preview.getAttribute('data-testid')).toBe('custom-preview');
      expect(preview.classList.contains('preview-class')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty value', async () => {
      const component = () =>
        Editable({
          defaultValue: '',
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('should handle very long text', async () => {
      const longText = 'a'.repeat(1000);
      const component = () =>
        Editable({
          defaultValue: longText,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      expect(input.value).toBe(longText);
    });

    it('should handle special characters', async () => {
      const specialText = '<script>alert("xss")</script>';
      const component = () =>
        Editable({
          defaultValue: specialText,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      expect(input.value).toBe(specialText);
    });

    it('should handle rapid mode switches', async () => {
      const component = () =>
        Editable({
          children: () => [EditablePreview({ children: 'Text' }), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;

      // Click multiple times
      preview.click();
      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextTick();

      const preview2 = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview2.click();
      await nextTick();

      const input2 = container.querySelector('[data-editable-input]');
      expect(input2).toBeTruthy();
    });
  });

  describe('Real-world Scenarios', () => {
    it('should work as an inline text editor', async () => {
      const value = signal('Original Title');
      const component = () =>
        Editable({
          value: value(),
          onValueChange: (newValue) => value.set(newValue),
          children: () => [EditablePreview({ children: value() }), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.value = 'New Title';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(value()).toBe('New Title');
    });

    it('should work with validation', async () => {
      const onSubmit = createSpy();
      const validator = (value: string) => value.length >= 3;

      const component = () =>
        Editable({
          defaultValue: 'OK',
          validator,
          onSubmit,
          children: () => [EditablePreview({}), EditableInput({})],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;

      // Try invalid value (< 3 chars)
      input.value = 'ab';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // Should not submit
      expect(onSubmit.callCount).toBe(0);

      // Try valid value (>= 3 chars)
      input.value = 'abc';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // Should submit
      expect(onSubmit.callCount).toBe(1);
    });

    it('should work with full controls', async () => {
      const value = signal('Edit me');
      const component = () =>
        Editable({
          value: value(),
          onValueChange: (newValue) => value.set(newValue),
          children: () => [
            EditablePreview({ children: value() }),
            EditableInput({}),
            EditableControls({
              children: [
                EditableSubmit({ children: 'Save' }),
                EditableCancel({ children: 'Cancel' }),
              ],
            }),
          ],
        });
      const { container } = renderComponent(component);

      const preview = container.querySelector('[data-editable-preview]') as HTMLElement;
      preview.click();

      await nextTick();

      const input = container.querySelector('[data-editable-input]') as HTMLInputElement;
      input.value = 'Changed';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const submitBtn = container.querySelector('[data-editable-submit]') as HTMLElement;
      submitBtn.click();

      expect(value()).toBe('Changed');
    });
  });
});
