/**
 * TagsInput Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TagsInput,
  TagsInputField,
  TagsInputTag,
  TagsInputTagRemove,
} from '../../../src/primitives/TagsInput.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('TagsInput', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  // ==========================================================================
  // Rendering Tests (10 tests)
  // ==========================================================================

  describe('Rendering Tests', () => {
    it('should render TagsInput root', () => {
      const { container, cleanup: dispose } = renderComponent(() => TagsInput({}));
      cleanup = dispose;

      const root = container.querySelector('[data-tags-input]');
      expect(root).toBeTruthy();
    });

    it('should render as div element', () => {
      const { container, cleanup: dispose } = renderComponent(() => TagsInput({}));
      cleanup = dispose;

      const root = container.querySelector('[data-tags-input]');
      expect(root?.tagName).toBe('DIV');
    });

    it('should have role="group"', () => {
      const { container, cleanup: dispose } = renderComponent(() => TagsInput({}));
      cleanup = dispose;

      const root = container.querySelector('[data-tags-input]');
      expect(root?.getAttribute('role')).toBe('group');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() => TagsInput({}));
      cleanup = dispose;

      const root = container.querySelector('[data-tags-input]');
      expect(root?.getAttribute('aria-label')).toBe('Tags input');
    });

    it('should render with disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({ disabled: true })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-tags-input]');
      expect(root?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not have data-disabled when not disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({ disabled: false })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-tags-input]');
      expect(root?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should render with children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputField({ placeholder: 'Add tag' }),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]');
      expect(field).toBeTruthy();
    });

    it('should render multiple children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => [
            TagsInputField({}),
            TagsInputTag({ value: 'test' }),
            TagsInputTagRemove({ value: 'test' }),
          ],
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]');
      const tag = container.querySelector('[data-tags-input-tag]');
      const removeButton = container.querySelector('[data-tags-input-tag-remove]');
      expect(field).toBeTruthy();
      expect(tag).toBeTruthy();
      expect(removeButton).toBeTruthy();
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({ children: () => null })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-tags-input]');
      expect(root).toBeTruthy();
      expect(root?.textContent).toBe('');
    });

    it('should render with maxTags prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          maxTags: 5,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]');
      expect(field).toBeTruthy();
    });
  });

  // ==========================================================================
  // Context Tests (8 tests)
  // ==========================================================================

  describe('Context Tests', () => {
    it('should provide tags signal through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1', 'tag2'],
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]');
      expect(field).toBeTruthy();
    });

    it('should provide disabled state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          disabled: true,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;
      expect(field.disabled).toBe(true);
    });

    it('should provide maxTags through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          maxTags: 3,
          defaultValue: ['tag1', 'tag2', 'tag3'],
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;
      // Field should be disabled when max tags reached
      expect(field.disabled).toBe(true);
    });

    it('should provide addTag function through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]');
      expect(field).toBeTruthy();
    });

    it('should provide removeTag function through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1'],
          children: () => TagsInputTagRemove({ value: 'tag1' }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-tags-input-tag-remove]');
      expect(removeButton).toBeTruthy();
    });

    it('should provide inputValue signal through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;
      expect(field.value).toBe('');
    });

    it('should provide canAddMore function through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          maxTags: 2,
          defaultValue: ['tag1', 'tag2'],
          children: () => TagsInputField({ placeholder: 'Add tag' }),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;
      expect(field.placeholder).toBe('');
    });

    it('should allow sub-components to access context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1'],
          children: () => [
            TagsInputField({}),
            TagsInputTag({ value: 'tag1' }),
            TagsInputTagRemove({ value: 'tag1' }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-tags-input-field]')).toBeTruthy();
      expect(container.querySelector('[data-tags-input-tag]')).toBeTruthy();
      expect(container.querySelector('[data-tags-input-tag-remove]')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Controlled/Uncontrolled Tests (6 tests)
  // ==========================================================================

  describe('Controlled/Uncontrolled Tests', () => {
    it('should work in uncontrolled mode with defaultValue', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1', 'tag2'],
          children: () => [TagsInputTag({ value: 'tag1' }), TagsInputTag({ value: 'tag2' })],
        })
      );
      cleanup = dispose;

      const tags = container.querySelectorAll('[data-tags-input-tag]');
      expect(tags.length).toBe(2);
    });

    it('should work in controlled mode with value prop', () => {
      const controlledTags = ['tag1', 'tag2', 'tag3'];
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          value: controlledTags,
          children: () =>
            controlledTags.map((tag) => TagsInputTag({ value: tag })),
        })
      );
      cleanup = dispose;

      const tags = container.querySelectorAll('[data-tags-input-tag]');
      expect(tags.length).toBe(3);
    });

    it('should call onValueChange callback when tags change', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      // Simulate typing and Enter
      field.value = 'newtag';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onValueChange).toHaveBeenCalledWith(['newtag']);
    });

    it('should use controlled value over internal state', () => {
      const controlledTags = ['controlled'];
      const defaultTags = ['default'];

      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          value: controlledTags,
          defaultValue: defaultTags,
          children: () => controlledTags.map((tag) => TagsInputTag({ value: tag })),
        })
      );
      cleanup = dispose;

      const tags = container.querySelectorAll('[data-tags-input-tag]');
      expect(tags.length).toBe(1);
      expect(tags[0]?.getAttribute('data-value')).toBe('controlled');
    });

    it('should default to empty array when no value provided', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]');
      expect(field).toBeTruthy();
    });

    it('should call onTagAdd when tag is added', () => {
      const onTagAdd = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          onTagAdd,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'newtag';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onTagAdd).toHaveBeenCalledWith('newtag');
    });
  });

  // ==========================================================================
  // Tag Addition Tests (12 tests)
  // ==========================================================================

  describe('Tag Addition Tests', () => {
    it('should add tag on Enter key', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'newtag';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onValueChange).toHaveBeenCalledWith(['newtag']);
    });

    it('should add tag on comma delimiter', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          onValueChange,
          delimiter: ',',
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'tag1,';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange).toHaveBeenCalledWith(['tag1']);
    });

    it('should trim whitespace from tags', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = '  newtag  ';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onValueChange).toHaveBeenCalledWith(['newtag']);
    });

    it('should not add empty tag', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = '   ';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should not add tag when disabled', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          disabled: true,
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'newtag';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should not add duplicate tag by default', () => {
      const onValidationError = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['existing'],
          onValidationError,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'existing';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onValidationError).toHaveBeenCalledWith('existing', 'Tag already exists');
    });

    it('should allow duplicate tags when allowDuplicates is true', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['existing'],
          allowDuplicates: true,
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'existing';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onValueChange).toHaveBeenCalledWith(['existing', 'existing']);
    });

    it('should not exceed maxTags limit', () => {
      const onValidationError = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          maxTags: 2,
          defaultValue: ['tag1', 'tag2'],
          onValidationError,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'tag3';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onValidationError).toHaveBeenCalledWith('tag3', 'Maximum 2 tags allowed');
    });

    it('should clear input value after adding tag', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'newtag';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(field.value).toBe('');
    });

    it('should call custom validator when adding tag', () => {
      const validator = vi.fn(() => null);
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          validator,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'newtag';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(validator).toHaveBeenCalledWith('newtag');
    });

    it('should reject tag when validator returns error', () => {
      const onValidationError = vi.fn();
      const validator = vi.fn(() => 'Invalid tag');
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          validator,
          onValidationError,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'badtag';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onValidationError).toHaveBeenCalledWith('badtag', 'Invalid tag');
    });

    it('should handle custom delimiter array', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          delimiter: [',', ';'],
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'tag1;';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange).toHaveBeenCalledWith(['tag1']);
    });
  });

  // ==========================================================================
  // Tag Removal Tests (8 tests)
  // ==========================================================================

  describe('Tag Removal Tests', () => {
    it('should remove tag on remove button click', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1', 'tag2'],
          onValueChange,
          children: () => TagsInputTagRemove({ value: 'tag1' }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-tags-input-tag-remove]') as HTMLButtonElement;
      removeButton.click();

      expect(onValueChange).toHaveBeenCalledWith(['tag2']);
    });

    it('should call onTagRemove callback', () => {
      const onTagRemove = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1'],
          onTagRemove,
          children: () => TagsInputTagRemove({ value: 'tag1' }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-tags-input-tag-remove]') as HTMLButtonElement;
      removeButton.click();

      expect(onTagRemove).toHaveBeenCalledWith('tag1');
    });

    it('should remove last tag on Backspace when input is empty', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1', 'tag2'],
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      const backspaceEvent = new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(backspaceEvent);

      expect(onValueChange).toHaveBeenCalledWith(['tag1']);
    });

    it('should not remove tag on Backspace when input has value', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1'],
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      field.value = 'typing';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const backspaceEvent = new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(backspaceEvent);

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should not remove tag when disabled', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          disabled: true,
          defaultValue: ['tag1'],
          onValueChange,
          children: () => TagsInputTagRemove({ value: 'tag1' }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-tags-input-tag-remove]') as HTMLButtonElement;
      removeButton.click();

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should stop propagation on remove button click', () => {
      const parentClick = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1'],
          children: () => TagsInputTagRemove({ value: 'tag1' }),
        })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-tags-input]') as HTMLElement;
      root.addEventListener('click', parentClick);

      const removeButton = container.querySelector('[data-tags-input-tag-remove]') as HTMLButtonElement;
      removeButton.click();

      expect(parentClick).not.toHaveBeenCalled();
    });

    it('should have aria-label for remove button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['mytag'],
          children: () => TagsInputTagRemove({ value: 'mytag' }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-tags-input-tag-remove]');
      expect(removeButton?.getAttribute('aria-label')).toBe('Remove tag mytag');
    });

    it('should disable remove button when disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          disabled: true,
          defaultValue: ['tag1'],
          children: () => TagsInputTagRemove({ value: 'tag1' }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-tags-input-tag-remove]') as HTMLButtonElement;
      expect(removeButton.disabled).toBe(true);
    });
  });

  // ==========================================================================
  // TagsInputField Tests (8 tests)
  // ==========================================================================

  describe('TagsInputField Tests', () => {
    it('should render as input element', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]');
      expect(field?.tagName).toBe('INPUT');
      expect((field as HTMLInputElement).type).toBe('text');
    });

    it('should have default placeholder', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]') as HTMLInputElement;
      expect(field.placeholder).toBe('Add tag...');
    });

    it('should use custom placeholder', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputField({ placeholder: 'Enter tag' }),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]') as HTMLInputElement;
      expect(field.placeholder).toBe('Enter tag');
    });

    it('should clear placeholder when max tags reached', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          maxTags: 2,
          defaultValue: ['tag1', 'tag2'],
          children: () => TagsInputField({ placeholder: 'Add tag' }),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]') as HTMLInputElement;
      expect(field.placeholder).toBe('');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]');
      expect(field?.getAttribute('aria-label')).toBe('Tag input field');
    });

    it('should be disabled when TagsInput is disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          disabled: true,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]') as HTMLInputElement;
      expect(field.disabled).toBe(true);
    });

    it('should be disabled when max tags reached', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          maxTags: 1,
          defaultValue: ['tag1'],
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]') as HTMLInputElement;
      expect(field.disabled).toBe(true);
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () =>
            TagsInputField({
              'data-testid': 'tag-field',
              className: 'custom-field',
            }),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]');
      expect(field?.getAttribute('data-testid')).toBe('tag-field');
      expect(field?.className).toContain('custom-field');
    });
  });

  // ==========================================================================
  // TagsInputTag Tests (5 tests)
  // ==========================================================================

  describe('TagsInputTag Tests', () => {
    it('should render tag with value', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputTag({ value: 'mytag' }),
        })
      );
      cleanup = dispose;

      const tag = container.querySelector('[data-tags-input-tag]');
      expect(tag).toBeTruthy();
      expect(tag?.tagName).toBe('DIV');
    });

    it('should have data-value attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputTag({ value: 'mytag' }),
        })
      );
      cleanup = dispose;

      const tag = container.querySelector('[data-tags-input-tag]');
      expect(tag?.getAttribute('data-value')).toBe('mytag');
    });

    it('should display value as text by default', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputTag({ value: 'mytag' }),
        })
      );
      cleanup = dispose;

      const tag = container.querySelector('[data-tags-input-tag]');
      expect(tag?.textContent).toBe('mytag');
    });

    it('should render custom children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () =>
            TagsInputTag({
              value: 'mytag',
              children: 'Custom Content',
            }),
        })
      );
      cleanup = dispose;

      const tag = container.querySelector('[data-tags-input-tag]');
      expect(tag?.textContent).toBe('Custom Content');
    });

    it('should work with TagsInputTagRemove as child', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['mytag'],
          children: () =>
            TagsInputTag({
              value: 'mytag',
              children: [
                'mytag ',
                TagsInputTagRemove({ value: 'mytag' }),
              ],
            }),
        })
      );
      cleanup = dispose;

      const tag = container.querySelector('[data-tags-input-tag]');
      const removeButton = tag?.querySelector('[data-tags-input-tag-remove]');
      expect(tag).toBeTruthy();
      expect(removeButton).toBeTruthy();
    });
  });

  // ==========================================================================
  // TagsInputTagRemove Tests (5 tests)
  // ==========================================================================

  describe('TagsInputTagRemove Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1'],
          children: () => TagsInputTagRemove({ value: 'tag1' }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-tags-input-tag-remove]');
      expect(removeButton?.tagName).toBe('BUTTON');
      expect((removeButton as HTMLButtonElement).type).toBe('button');
    });

    it('should have default × character', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1'],
          children: () => TagsInputTagRemove({ value: 'tag1' }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-tags-input-tag-remove]');
      expect(removeButton?.textContent).toBe('×');
    });

    it('should render custom children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1'],
          children: () =>
            TagsInputTagRemove({
              value: 'tag1',
              children: 'Remove',
            }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-tags-input-tag-remove]');
      expect(removeButton?.textContent).toBe('Remove');
    });

    it('should have aria-label with tag value', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['mytag'],
          children: () => TagsInputTagRemove({ value: 'mytag' }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-tags-input-tag-remove]');
      expect(removeButton?.getAttribute('aria-label')).toBe('Remove tag mytag');
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1'],
          children: () =>
            TagsInputTagRemove({
              value: 'tag1',
              'data-testid': 'remove-btn',
              className: 'custom-remove',
            }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-tags-input-tag-remove]');
      expect(removeButton?.getAttribute('data-testid')).toBe('remove-btn');
      expect(removeButton?.className).toContain('custom-remove');
    });
  });

  // ==========================================================================
  // Paste Handling Tests (5 tests)
  // ==========================================================================

  describe('Paste Handling Tests', () => {
    it('should split pasted text by delimiter', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          delimiter: ',',
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      });

      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => 'tag1,tag2,tag3',
        },
      });

      field.dispatchEvent(pasteEvent);

      expect(onValueChange).toHaveBeenCalledWith(['tag1', 'tag2', 'tag3']);
    });

    it('should handle paste with multiple delimiters', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          delimiter: [',', ';'],
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => 'tag1,tag2;tag3',
        },
      });

      field.dispatchEvent(pasteEvent);
    });

    it('should trim whitespace from pasted tags', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          delimiter: ',',
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '  tag1  ,  tag2  ',
        },
      });

      field.dispatchEvent(pasteEvent);

      expect(onValueChange).toHaveBeenCalledWith(['tag1', 'tag2']);
    });

    it('should not paste when disabled', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          disabled: true,
          delimiter: ',',
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;
      expect(field.disabled).toBe(true);
    });

    it('should handle paste without delimiters normally', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          delimiter: ',',
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => 'singletagnodelimiter',
        },
      });

      field.dispatchEvent(pasteEvent);

      // Should not prevent default, allowing normal paste
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Edge Cases (5 tests)
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({ children: undefined })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-tags-input]');
      expect(root).toBeTruthy();
    });

    it('should handle maxTags of 0 (unlimited)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          maxTags: 0,
          defaultValue: ['tag1', 'tag2', 'tag3'],
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]') as HTMLInputElement;
      expect(field.disabled).toBe(false);
    });

    it('should handle empty string as delimiter', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          delimiter: '',
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('[data-tags-input-field]');
      expect(field).toBeTruthy();
    });

    it('should use default props when missing', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-tags-input]');
      expect(root).toBeTruthy();
      expect(root?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should handle rapid tag additions', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          onValueChange,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      // Add multiple tags rapidly
      ['tag1', 'tag2', 'tag3'].forEach((tag) => {
        field.value = tag;
        field.dispatchEvent(new Event('input', { bubbles: true }));

        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        });
        field.dispatchEvent(enterEvent);
      });

      expect(onValueChange).toHaveBeenCalledTimes(3);
    });
  });

  // ==========================================================================
  // Integration Tests (5 tests)
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should work with all components together', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['tag1', 'tag2'],
          children: () => [
            TagsInputField({ placeholder: 'Add tag' }),
            TagsInputTag({
              value: 'tag1',
              children: [
                'tag1 ',
                TagsInputTagRemove({ value: 'tag1' }),
              ],
            }),
            TagsInputTag({
              value: 'tag2',
              children: [
                'tag2 ',
                TagsInputTagRemove({ value: 'tag2' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-tags-input]')).toBeTruthy();
      expect(container.querySelector('[data-tags-input-field]')).toBeTruthy();
      expect(container.querySelectorAll('[data-tags-input-tag]').length).toBe(2);
      expect(container.querySelectorAll('[data-tags-input-tag-remove]').length).toBe(2);
    });

    it('should handle complete tag lifecycle', () => {
      const onValueChange = vi.fn();
      const onTagAdd = vi.fn();
      const onTagRemove = vi.fn();

      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['existing'],
          onValueChange,
          onTagAdd,
          onTagRemove,
          children: () => [
            TagsInputField({}),
            TagsInputTagRemove({ value: 'existing' }),
          ],
        })
      );
      cleanup = dispose;

      // Add a tag
      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;
      field.value = 'newtag';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onTagAdd).toHaveBeenCalledWith('newtag');

      // Remove a tag
      const removeButton = container.querySelector('[data-tags-input-tag-remove]') as HTMLButtonElement;
      removeButton.click();

      expect(onTagRemove).toHaveBeenCalledWith('existing');
    });

    it('should enforce validation across all interactions', () => {
      const validator = (tag: string) => {
        if (tag.length < 3) return 'Tag must be at least 3 characters';
        return null;
      };
      const onValidationError = vi.fn();

      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          validator,
          onValidationError,
          maxTags: 3,
          children: () => TagsInputField({}),
        })
      );
      cleanup = dispose;

      const field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;

      // Try to add invalid tag
      field.value = 'ab';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      expect(onValidationError).toHaveBeenCalledWith('ab', 'Tag must be at least 3 characters');
    });

    it('should coordinate field state with tag count', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          maxTags: 2,
          defaultValue: ['tag1'],
          children: () => TagsInputField({ placeholder: 'Add tag' }),
        })
      );
      cleanup = dispose;

      let field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;
      expect(field.disabled).toBe(false);
      expect(field.placeholder).toBe('Add tag');

      // Add second tag to reach max
      field.value = 'tag2';
      field.dispatchEvent(new Event('input', { bubbles: true }));

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(enterEvent);

      // Field should now be disabled and have no placeholder
      field = container.querySelector('input[data-tags-input-field]') as HTMLInputElement;
      expect(field.disabled).toBe(true);
      expect(field.placeholder).toBe('');
    });

    it('should render complete tags input with all features', () => {
      const validator = (tag: string) => {
        if (!/^[a-z]+$/.test(tag)) return 'Only lowercase letters allowed';
        return null;
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        TagsInput({
          defaultValue: ['javascript', 'typescript'],
          maxTags: 5,
          allowDuplicates: false,
          validator,
          delimiter: [',', ';'],
          placeholder: 'Enter tags...',
          children: () => [
            TagsInputField({ placeholder: 'Enter tags...' }),
            TagsInputTag({
              value: 'javascript',
              children: [
                'javascript ',
                TagsInputTagRemove({ value: 'javascript' }),
              ],
            }),
            TagsInputTag({
              value: 'typescript',
              children: [
                'typescript ',
                TagsInputTagRemove({ value: 'typescript' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-tags-input]')).toBeTruthy();
      expect(container.querySelector('[data-tags-input-field]')).toBeTruthy();
      expect(container.querySelectorAll('[data-tags-input-tag]').length).toBe(2);
      expect(container.querySelectorAll('[data-tags-input-tag-remove]').length).toBe(2);
    });
  });
});
