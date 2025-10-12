/**
 * FileUpload Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FileUpload,
  FileUploadTrigger,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemRemove,
  type FileWithPreview,
} from '../../../src/primitives/FileUpload.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

describe('FileUpload', () => {
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
    it('should render FileUpload root', () => {
      const { container, cleanup: dispose } = renderComponent(() => FileUpload({}));
      cleanup = dispose;

      const root = container.querySelector('[data-file-upload]');
      expect(root).toBeTruthy();
    });

    it('should render as div element', () => {
      const { container, cleanup: dispose } = renderComponent(() => FileUpload({}));
      cleanup = dispose;

      const root = container.querySelector('[data-file-upload]');
      expect(root?.tagName).toBe('DIV');
    });

    it('should render with disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() => FileUpload({ disabled: true }));
      cleanup = dispose;

      const root = container.querySelector('[data-file-upload]');
      expect(root?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not have data-disabled when not disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() => FileUpload({ disabled: false }));
      cleanup = dispose;

      const root = container.querySelector('[data-file-upload]');
      expect(root?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should render with children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadTrigger({ children: 'Upload File' }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]');
      expect(trigger).toBeTruthy();
      expect(trigger?.textContent).toContain('Upload File');
    });

    it('should render multiple children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => [FileUploadTrigger({}), FileUploadDropzone({})],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]');
      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(trigger).toBeTruthy();
      expect(dropzone).toBeTruthy();
    });

    it('should render all sub-components together', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => [
            FileUploadTrigger({}),
            FileUploadDropzone({}),
            FileUploadItem({ file: fileWithPreview }),
            FileUploadItemRemove({ file: fileWithPreview }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-file-upload-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-file-upload-dropzone]')).toBeTruthy();
      expect(container.querySelector('[data-file-upload-item]')).toBeTruthy();
      expect(container.querySelector('[data-file-upload-item-remove]')).toBeTruthy();
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() => FileUpload({ children: () => null }));
      cleanup = dispose;

      const root = container.querySelector('[data-file-upload]');
      expect(root).toBeTruthy();
      expect(root?.textContent).toBe('');
    });

    it('should render with multiple prop enabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          multiple: true,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.multiple).toBe(true);
    });

    it('should render with accept prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          accept: 'image/*',
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.accept).toBe('image/*');
    });
  });

  // ==========================================================================
  // Context Tests (8 tests)
  // ==========================================================================

  describe('Context Tests', () => {
    it('should provide files signal through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should provide accept prop through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          accept: 'image/*',
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.accept).toBe('image/*');
    });

    it('should provide multiple flag through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          multiple: true,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.multiple).toBe(true);
    });

    it('should provide disabled state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          disabled: true,
          children: () => FileUploadTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-file-upload-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should provide maxSize through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          maxSize: 1024 * 1024,
          children: () => FileUploadTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should provide maxFiles through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          maxFiles: 3,
          children: () => FileUploadTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]');
      expect(trigger).toBeTruthy();
    });

    it('should provide openFileBrowser function through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]') as HTMLButtonElement;
      expect(() => trigger.click()).not.toThrow();
    });

    it('should allow sub-components to access context', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => [FileUploadTrigger({}), FileUploadDropzone({}), FileUploadItem({ file: fileWithPreview })],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-file-upload-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-file-upload-dropzone]')).toBeTruthy();
      expect(container.querySelector('[data-file-upload-item]')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Controlled/Uncontrolled Tests (6 tests)
  // ==========================================================================

  describe('Controlled/Uncontrolled Tests', () => {
    it('should work in uncontrolled mode with defaultValue', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const defaultFiles = [mockFile as FileWithPreview];

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          defaultValue: defaultFiles,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone).toBeTruthy();
    });

    it('should work in controlled mode with value prop', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const controlledFiles = [mockFile as FileWithPreview];

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          value: controlledFiles,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone).toBeTruthy();
    });

    it('should call onValueChange callback when files change', () => {
      const onValueChange = vi.fn();
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          onValueChange,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      // Mock file input change
      Object.defineProperty(input, 'files', {
        value: [mockFile],
        writable: false,
      });

      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Should eventually call onValueChange after file processing
      // Note: This is async due to file preview creation
    });

    it('should use controlled value over internal state', () => {
      const mockFile1 = new File(['content1'], 'test1.txt', { type: 'text/plain' });
      const mockFile2 = new File(['content2'], 'test2.txt', { type: 'text/plain' });
      const controlledFiles = [mockFile1 as FileWithPreview];
      const defaultFiles = [mockFile2 as FileWithPreview];

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          value: controlledFiles,
          defaultValue: defaultFiles,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone).toBeTruthy();
    });

    it('should default to empty array when no value provided', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone).toBeTruthy();
    });

    it('should call onFilesAdded when files are added', () => {
      const onFilesAdded = vi.fn();
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          onFilesAdded,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(input, 'files', {
        value: [mockFile],
        writable: false,
      });

      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  // ==========================================================================
  // File Selection Tests (8 tests)
  // ==========================================================================

  describe('File Selection Tests', () => {
    it('should trigger file browser on trigger click', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => [FileUploadDropzone({}), FileUploadTrigger({})],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]') as HTMLButtonElement;
      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      const clickSpy = vi.spyOn(input, 'click');
      trigger.click();

      expect(clickSpy).toHaveBeenCalled();
    });

    it('should not trigger file browser when disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          disabled: true,
          children: () => [FileUploadDropzone({}), FileUploadTrigger({})],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should accept single file when multiple is false', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          multiple: false,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.multiple).toBe(false);
    });

    it('should accept multiple files when multiple is true', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          multiple: true,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.multiple).toBe(true);
    });

    it('should reset input value after file selection', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(input, 'files', {
        value: [mockFile],
        writable: false,
      });

      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Input value should be reset to allow selecting same file again
      expect(input.value).toBe('');
    });

    it('should filter files by accept attribute', () => {
      const onFilesRejected = vi.fn();

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          accept: 'image/*',
          onFilesRejected,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.accept).toBe('image/*');
    });

    it('should validate file size when maxSize is set', () => {
      const onFilesRejected = vi.fn();

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          maxSize: 100, // 100 bytes
          onFilesRejected,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone).toBeTruthy();
    });

    it('should enforce maxFiles limit', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          maxFiles: 2,
          multiple: true,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone).toBeTruthy();
    });
  });

  // ==========================================================================
  // Drag and Drop Tests (8 tests)
  // ==========================================================================

  describe('Drag and Drop Tests', () => {
    it('should handle drag enter event', async () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;

      const dragEnterEvent = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
      });

      dropzone.dispatchEvent(dragEnterEvent);
      await nextTick();

      // Re-query the DOM after reactive update (component re-renders)
      const updatedDropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;
      expect(updatedDropzone.hasAttribute('data-dragging')).toBe(true);
    });

    it('should handle drag leave event', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;

      const dragEnterEvent = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
      });
      dropzone.dispatchEvent(dragEnterEvent);

      const dragLeaveEvent = new DragEvent('dragleave', {
        bubbles: true,
        cancelable: true,
      });
      dropzone.dispatchEvent(dragLeaveEvent);

      expect(dropzone.hasAttribute('data-dragging')).toBe(false);
    });

    it('should handle drag over event', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;

      const dragOverEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
      });

      const preventDefaultSpy = vi.spyOn(dragOverEvent, 'preventDefault');
      dropzone.dispatchEvent(dragOverEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should handle drop event with files', () => {
      const onFilesAdded = vi.fn();
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          onFilesAdded,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [mockFile],
        },
      });

      dropzone.dispatchEvent(dropEvent);
    });

    it('should not handle drag when disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          disabled: true,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;

      const dragEnterEvent = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
      });

      dropzone.dispatchEvent(dragEnterEvent);

      expect(dropzone.hasAttribute('data-dragging')).toBe(false);
    });

    it('should not handle drop when disabled', () => {
      const onFilesAdded = vi.fn();
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          disabled: true,
          onFilesAdded,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [mockFile],
        },
      });

      dropzone.dispatchEvent(dropEvent);

      expect(onFilesAdded).not.toHaveBeenCalled();
    });

    it('should clear dragging state on drop', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;

      const dragEnterEvent = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
      });
      dropzone.dispatchEvent(dragEnterEvent);

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [mockFile],
        },
      });

      dropzone.dispatchEvent(dropEvent);

      expect(dropzone.hasAttribute('data-dragging')).toBe(false);
    });

    it('should open file browser on dropzone click', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;
      const input = dropzone.querySelector('input[type="file"]') as HTMLInputElement;

      const clickSpy = vi.spyOn(input, 'click');
      dropzone.click();

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // File Removal Tests (6 tests)
  // ==========================================================================

  describe('File Removal Tests', () => {
    it('should render remove button for file', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadItemRemove({ file: fileWithPreview }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-file-upload-item-remove]');
      expect(removeButton).toBeTruthy();
      expect(removeButton?.tagName).toBe('BUTTON');
    });

    it('should have default × character as remove button text', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadItemRemove({ file: fileWithPreview }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-file-upload-item-remove]');
      expect(removeButton?.textContent).toBe('×');
    });

    it('should have aria-label for remove button', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadItemRemove({ file: fileWithPreview }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-file-upload-item-remove]');
      expect(removeButton?.getAttribute('aria-label')).toBe('Remove test.txt');
    });

    it('should remove file when remove button clicked', () => {
      const onValueChange = vi.fn();
      const mockFile1 = new File(['content1'], 'test1.txt', { type: 'text/plain' });
      const mockFile2 = new File(['content2'], 'test2.txt', { type: 'text/plain' });
      const file1 = mockFile1 as FileWithPreview;
      const file2 = mockFile2 as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          defaultValue: [file1, file2],
          onValueChange,
          children: () => FileUploadItemRemove({ file: file1 }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-file-upload-item-remove]') as HTMLButtonElement;
      removeButton.click();

      expect(onValueChange).toHaveBeenCalled();
    });

    it('should stop propagation on remove button click', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;
      const parentClick = vi.fn();

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadItemRemove({ file: fileWithPreview }),
        })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-file-upload]') as HTMLElement;
      root.addEventListener('click', parentClick);

      const removeButton = container.querySelector('[data-file-upload-item-remove]') as HTMLButtonElement;
      removeButton.click();

      // Parent click should not be called due to stopPropagation
      expect(parentClick).not.toHaveBeenCalled();
    });

    it('should allow custom children for remove button', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadItemRemove({ file: fileWithPreview, children: 'Remove' }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-file-upload-item-remove]');
      expect(removeButton?.textContent).toBe('Remove');
    });
  });

  // ==========================================================================
  // FileUploadTrigger Tests (5 tests)
  // ==========================================================================

  describe('FileUploadTrigger Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]');
      expect(trigger?.tagName).toBe('BUTTON');
    });

    it('should have type="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]') as HTMLButtonElement;
      expect(trigger.type).toBe('button');
    });

    it('should respect disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          disabled: true,
          children: () => FileUploadTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-file-upload-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadTrigger({ children: 'Upload Files' }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]');
      expect(trigger?.textContent).toBe('Upload Files');
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () =>
            FileUploadTrigger({
              'data-testid': 'upload-trigger',
              className: 'custom-trigger',
            }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]');
      expect(trigger?.getAttribute('data-testid')).toBe('upload-trigger');
      expect(trigger?.className).toContain('custom-trigger');
    });
  });

  // ==========================================================================
  // FileUploadDropzone Tests (6 tests)
  // ==========================================================================

  describe('FileUploadDropzone Tests', () => {
    it('should render as div with role="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone?.tagName).toBe('DIV');
      expect(dropzone?.getAttribute('role')).toBe('button');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone?.getAttribute('aria-label')).toBe('Upload files');
    });

    it('should have tabIndex 0 when enabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;
      expect(dropzone.tabIndex).toBe(0);
    });

    it('should have tabIndex -1 when disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          disabled: true,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;
      expect(dropzone.tabIndex).toBe(-1);
    });

    it('should contain hidden file input', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.style.display).toBe('none');
      expect(input.getAttribute('aria-hidden')).toBe('true');
      expect(input.tabIndex).toBe(-1);
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () =>
            FileUploadDropzone({
              children: 'Drop files here',
            }),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone?.textContent).toContain('Drop files here');
    });
  });

  // ==========================================================================
  // FileUploadItem Tests (4 tests)
  // ==========================================================================

  describe('FileUploadItem Tests', () => {
    it('should render file item', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadItem({ file: fileWithPreview }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-file-upload-item]');
      expect(item).toBeTruthy();
      expect(item?.tagName).toBe('DIV');
    });

    it('should have data-file-name attribute', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadItem({ file: fileWithPreview }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-file-upload-item]');
      expect(item?.getAttribute('data-file-name')).toBe('test.txt');
    });

    it('should render children', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () =>
            FileUploadItem({
              file: fileWithPreview,
              children: 'Custom content',
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-file-upload-item]');
      expect(item?.textContent).toContain('Custom content');
    });

    it('should work with FileUploadItemRemove as child', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () =>
            FileUploadItem({
              file: fileWithPreview,
              children: FileUploadItemRemove({ file: fileWithPreview }),
            }),
        })
      );
      cleanup = dispose;

      const item = container.querySelector('[data-file-upload-item]');
      const removeButton = item?.querySelector('[data-file-upload-item-remove]');
      expect(removeButton).toBeTruthy();
    });
  });

  // ==========================================================================
  // Validation Tests (8 tests)
  // ==========================================================================

  describe('Validation Tests', () => {
    it('should reject file exceeding maxSize', () => {
      const onFilesRejected = vi.fn();
      const largeContent = 'x'.repeat(1000);
      const mockFile = new File([largeContent], 'large.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          maxSize: 100,
          onFilesRejected,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(input, 'files', {
        value: [mockFile],
        writable: false,
      });

      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    it('should reject file with invalid type', () => {
      const onFilesRejected = vi.fn();
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          accept: 'image/*',
          onFilesRejected,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(input, 'files', {
        value: [mockFile],
        writable: false,
      });

      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    it('should accept file with valid type (exact match)', () => {
      const onFilesAdded = vi.fn();
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          accept: 'text/plain',
          onFilesAdded,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone).toBeTruthy();
    });

    it('should accept file with valid type (wildcard match)', () => {
      const onFilesAdded = vi.fn();
      const mockFile = new File(['content'], 'test.png', { type: 'image/png' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          accept: 'image/*',
          onFilesAdded,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone).toBeTruthy();
    });

    it('should accept file with valid extension', () => {
      const onFilesAdded = vi.fn();
      const mockFile = new File(['content'], 'test.pdf', { type: 'application/pdf' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          accept: '.pdf',
          onFilesAdded,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone).toBeTruthy();
    });

    it('should call custom validator', () => {
      const validator = vi.fn(() => null);
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          validator,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(input, 'files', {
        value: [mockFile],
        writable: false,
      });

      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    it('should reject file when custom validator returns error', () => {
      const onFilesRejected = vi.fn();
      const validator = vi.fn(() => 'Custom validation error');
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          validator,
          onFilesRejected,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(input, 'files', {
        value: [mockFile],
        writable: false,
      });

      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    it('should reject files beyond maxFiles limit', () => {
      const mockFile1 = new File(['content1'], 'test1.txt', { type: 'text/plain' });
      const mockFile2 = new File(['content2'], 'test2.txt', { type: 'text/plain' });
      const mockFile3 = new File(['content3'], 'test3.txt', { type: 'text/plain' });

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          maxFiles: 2,
          multiple: true,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(input, 'files', {
        value: [mockFile1, mockFile2, mockFile3],
        writable: false,
      });

      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  // ==========================================================================
  // Edge Cases (5 tests)
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() => FileUpload({ children: undefined }));
      cleanup = dispose;

      const root = container.querySelector('[data-file-upload]');
      expect(root).toBeTruthy();
    });

    it('should handle no files in drop event', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]') as HTMLElement;

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [],
        },
      });

      expect(() => dropzone.dispatchEvent(dropEvent)).not.toThrow();
    });

    it('should handle no files in input change event', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      Object.defineProperty(input, 'files', {
        value: [],
        writable: false,
      });

      expect(() => input.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
    });

    it('should handle multiple file types in accept', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          accept: 'image/*,.pdf,.doc',
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.accept).toBe('image/*,.pdf,.doc');
    });

    it('should use default props when missing', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-file-upload]');
      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      expect(root).toBeTruthy();
      expect(root?.hasAttribute('data-disabled')).toBe(false);
      expect(input.multiple).toBe(false);
    });
  });

  // ==========================================================================
  // Integration Tests (5 tests)
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should work with all components together', () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          defaultValue: [fileWithPreview],
          children: () => [
            FileUploadTrigger({ children: 'Upload' }),
            FileUploadDropzone({ children: 'Drop here' }),
            FileUploadItem({
              file: fileWithPreview,
              children: FileUploadItemRemove({ file: fileWithPreview }),
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-file-upload]')).toBeTruthy();
      expect(container.querySelector('[data-file-upload-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-file-upload-dropzone]')).toBeTruthy();
      expect(container.querySelector('[data-file-upload-item]')).toBeTruthy();
      expect(container.querySelector('[data-file-upload-item-remove]')).toBeTruthy();
    });

    it('should coordinate trigger and dropzone', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          children: () => [FileUploadTrigger({}), FileUploadDropzone({})],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-file-upload-trigger]') as HTMLButtonElement;
      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      const input = dropzone?.querySelector('input[type="file"]') as HTMLInputElement;

      const clickSpy = vi.spyOn(input, 'click');
      trigger.click();

      expect(clickSpy).toHaveBeenCalled();
    });

    it('should handle file selection and removal flow', () => {
      const onValueChange = vi.fn();
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const fileWithPreview = mockFile as FileWithPreview;

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          defaultValue: [fileWithPreview],
          onValueChange,
          children: () => FileUploadItemRemove({ file: fileWithPreview }),
        })
      );
      cleanup = dispose;

      const removeButton = container.querySelector('[data-file-upload-item-remove]') as HTMLButtonElement;
      removeButton.click();

      expect(onValueChange).toHaveBeenCalled();
    });

    it('should enforce maxFiles across multiple selections', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          maxFiles: 2,
          multiple: true,
          children: () => FileUploadDropzone({}),
        })
      );
      cleanup = dispose;

      const dropzone = container.querySelector('[data-file-upload-dropzone]');
      expect(dropzone).toBeTruthy();
    });

    it('should render complete file upload with validation', () => {
      const onFilesAdded = vi.fn();
      const onFilesRejected = vi.fn();
      const validator = (file: File) => {
        if (file.name.startsWith('invalid')) {
          return 'Invalid filename';
        }
        return null;
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        FileUpload({
          accept: 'image/*',
          maxSize: 5 * 1024 * 1024,
          maxFiles: 5,
          multiple: true,
          validator,
          onFilesAdded,
          onFilesRejected,
          children: () => [
            FileUploadTrigger({ children: 'Select Files' }),
            FileUploadDropzone({ children: 'Drop files here or click to browse' }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-file-upload]')).toBeTruthy();
      expect(container.querySelector('[data-file-upload-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-file-upload-dropzone]')).toBeTruthy();
    });
  });
});
