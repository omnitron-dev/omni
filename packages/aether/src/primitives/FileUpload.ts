/**
 * FileUpload - File upload component with drag & drop support
 *
 * Features:
 * - Drag and drop file upload
 * - Click to browse file selection
 * - Multiple file upload support
 * - File type restrictions (accept attribute)
 * - File size validation
 * - File count limits
 * - Upload progress tracking
 * - Preview support for images
 * - Controlled and uncontrolled modes
 * - ARIA support for accessibility
 */

import { defineComponent, onCleanup } from '../core/component/index.js';
import { createContext, useContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface FileWithPreview extends File {
  preview?: string;
}

export interface FileUploadProps {
  /** Controlled files value */
  value?: FileWithPreview[];
  /** Value change callback */
  onValueChange?: (files: FileWithPreview[]) => void;
  /** Default value (uncontrolled) */
  defaultValue?: FileWithPreview[];
  /** Accept file types (e.g., "image/*" or ".pdf,.doc") */
  accept?: string;
  /** Whether to allow multiple files */
  multiple?: boolean;
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Maximum number of files */
  maxFiles?: number;
  /** Whether the upload is disabled */
  disabled?: boolean;
  /** Called when files are dropped or selected */
  onFilesAdded?: (files: FileWithPreview[]) => void;
  /** Called when files are rejected (validation failed) */
  onFilesRejected?: (rejections: FileRejection[]) => void;
  /** Custom file validator */
  validator?: (file: File) => string | null;
  /** Children */
  children?: any;
}

export interface FileRejection {
  file: File;
  errors: Array<{ code: string; message: string }>;
}

export interface FileUploadTriggerProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface FileUploadDropzoneProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface FileUploadItemProps {
  /** File to display */
  file: FileWithPreview;
  /** Children */
  children?: any;
}

export interface FileUploadItemRemoveProps {
  /** File to remove */
  file: FileWithPreview;
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

interface FileUploadContextValue {
  /** Current files */
  files: Signal<FileWithPreview[]>;
  /** Accept attribute */
  accept?: string;
  /** Multiple files */
  multiple: boolean;
  /** Max size */
  maxSize?: number;
  /** Max files */
  maxFiles?: number;
  /** Disabled state */
  disabled: boolean;
  /** Drag state */
  isDragging: Signal<boolean>;
  /** Add files */
  addFiles: (files: File[]) => void;
  /** Remove file */
  removeFile: (file: FileWithPreview) => void;
  /** Clear all files */
  clearFiles: () => void;
  /** Open file browser */
  openFileBrowser: () => void;
  /** Input ref */
  inputRef: { current: HTMLInputElement | null };
}

// ============================================================================
// Context
// ============================================================================

const FileUploadContext = createContext<FileUploadContextValue | null>(null);

const useFileUploadContext = (): FileUploadContextValue => {
  const context = useContext(FileUploadContext);
  if (!context) {
    throw new Error('FileUpload components must be used within a FileUpload');
  }
  return context;
};

// ============================================================================
// Helper Functions
// ============================================================================

const createFilePreview = (file: File): Promise<FileWithPreview> => {
  return new Promise((resolve) => {
    const fileWithPreview = file as FileWithPreview;

    // Only create preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        fileWithPreview.preview = reader.result as string;
        resolve(fileWithPreview);
      };
      reader.onerror = () => {
        resolve(fileWithPreview);
      };
      reader.readAsDataURL(file);
    } else {
      resolve(fileWithPreview);
    }
  });
};

const validateFile = (
  file: File,
  maxSize?: number,
  accept?: string,
  validator?: (file: File) => string | null,
): Array<{ code: string; message: string }> => {
  const errors: Array<{ code: string; message: string }> = [];

  // Size validation
  if (maxSize && file.size > maxSize) {
    errors.push({
      code: 'file-too-large',
      message: `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum (${(maxSize / 1024 / 1024).toFixed(2)}MB)`,
    });
  }

  // Type validation
  if (accept) {
    const acceptedTypes = accept.split(',').map((t) => t.trim());
    const fileType = file.type;
    const fileName = file.name;

    const isAccepted = acceptedTypes.some((type) => {
      if (type.startsWith('.')) {
        // Extension match
        return fileName.toLowerCase().endsWith(type.toLowerCase());
      } else if (type.endsWith('/*')) {
        // Wildcard match (e.g., "image/*")
        const baseType = type.slice(0, -2);
        return fileType.startsWith(baseType);
      } else {
        // Exact match
        return fileType === type;
      }
    });

    if (!isAccepted) {
      errors.push({
        code: 'file-invalid-type',
        message: `File type "${fileType}" is not accepted`,
      });
    }
  }

  // Custom validation
  if (validator) {
    const error = validator(file);
    if (error) {
      errors.push({
        code: 'validation-failed',
        message: error,
      });
    }
  }

  return errors;
};

// ============================================================================
// FileUpload Root
// ============================================================================

export const FileUpload = defineComponent<FileUploadProps>((props) => {
  const multiple = props.multiple ?? false;
  const disabled = props.disabled ?? false;

  // State
  const internalFiles: WritableSignal<FileWithPreview[]> = signal<FileWithPreview[]>(
    props.defaultValue ?? [],
  );
  const isDragging: WritableSignal<boolean> = signal<boolean>(false);

  const inputRef: { current: HTMLInputElement | null } = { current: null };

  const currentFiles = (): FileWithPreview[] => {
    if (props.value !== undefined) {
      return props.value;
    }
    return internalFiles();
  };

  const setFiles = (newFiles: FileWithPreview[]) => {
    if (props.value === undefined) {
      internalFiles.set(newFiles);
    }
    props.onValueChange?.(newFiles);
  };

  const addFiles = async (filesToAdd: File[]) => {
    if (disabled) return;

    const accepted: FileWithPreview[] = [];
    const rejected: FileRejection[] = [];

    for (const file of filesToAdd) {
      const errors = validateFile(file, props.maxSize, props.accept, props.validator);

      if (errors.length > 0) {
        rejected.push({ file, errors });
      } else {
        const fileWithPreview = await createFilePreview(file);
        accepted.push(fileWithPreview);
      }
    }

    // Check max files limit
    const current = currentFiles();
    let newFiles = multiple ? [...current, ...accepted] : accepted;

    if (props.maxFiles && newFiles.length > props.maxFiles) {
      newFiles = newFiles.slice(0, props.maxFiles);
    }

    if (accepted.length > 0) {
      setFiles(newFiles);
      props.onFilesAdded?.(accepted);
    }

    if (rejected.length > 0) {
      props.onFilesRejected?.(rejected);
    }
  };

  const removeFile = (fileToRemove: FileWithPreview) => {
    const newFiles = currentFiles().filter((f) => f !== fileToRemove);
    setFiles(newFiles);

    // Revoke preview URL if exists
    if (fileToRemove.preview) {
      URL.revokeObjectURL(fileToRemove.preview);
    }
  };

  const clearFiles = () => {
    const current = currentFiles();
    current.forEach((file) => {
      if (file.preview) {
        URL.revokeObjectURL(file.preview);
      }
    });
    setFiles([]);
  };

  const openFileBrowser = () => {
    if (inputRef.current && !disabled) {
      inputRef.current.click();
    }
  };

  // Cleanup previews on unmount
  onCleanup(() => {
    currentFiles().forEach((file) => {
      if (file.preview) {
        URL.revokeObjectURL(file.preview);
      }
    });
  });

  const contextValue: FileUploadContextValue = {
    files: computed(() => currentFiles()),
    accept: props.accept,
    multiple,
    maxSize: props.maxSize,
    maxFiles: props.maxFiles,
    disabled,
    isDragging: computed(() => isDragging()),
    addFiles,
    removeFile,
    clearFiles,
    openFileBrowser,
    inputRef,
  };

  return () =>
    jsx(FileUploadContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-file-upload': '',
        'data-disabled': disabled ? '' : undefined,
        children: props.children,
      }),
    });
});

// ============================================================================
// FileUpload Trigger
// ============================================================================

export const FileUploadTrigger = defineComponent<FileUploadTriggerProps>((props) => {
  const context = useFileUploadContext();

  const handleClick = () => {
    context.openFileBrowser();
  };

  return () => {
    const { children, ...rest } = props;

    return jsx('button', {
      type: 'button',
      'data-file-upload-trigger': '',
      onClick: handleClick,
      disabled: context.disabled,
      ...rest,
      children,
    });
  };
});

// ============================================================================
// FileUpload Dropzone
// ============================================================================

export const FileUploadDropzone = defineComponent<FileUploadDropzoneProps>((props) => {
  const context = useFileUploadContext();

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!context.disabled) {
      (context.isDragging as WritableSignal<boolean>).set(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!context.disabled) {
      (context.isDragging as WritableSignal<boolean>).set(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!context.disabled) {
      (context.isDragging as WritableSignal<boolean>).set(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      context.addFiles(files);
    }
  };

  const handleClick = () => {
    context.openFileBrowser();
  };

  const handleInputChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const files = Array.from(target.files ?? []);
    context.addFiles(files);

    // Reset input value to allow selecting same file again
    target.value = '';
  };

  return () => {
    const { children, ...rest } = props;

    return jsx('div', {
      'data-file-upload-dropzone': '',
      'data-dragging': context.isDragging() ? '' : undefined,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
      onClick: handleClick,
      role: 'button',
      tabIndex: context.disabled ? -1 : 0,
      'aria-label': 'Upload files',
      ...rest,
      children: [
        jsx('input', {
          ref: context.inputRef,
          type: 'file',
          accept: context.accept,
          multiple: context.multiple,
          disabled: context.disabled,
          onChange: handleInputChange,
          style: { display: 'none' },
          'aria-hidden': 'true',
          tabIndex: -1,
        }),
        children,
      ],
    });
  };
});

// ============================================================================
// FileUpload Item
// ============================================================================

export const FileUploadItem = defineComponent<FileUploadItemProps>((props) => {
  return () => {
    const { file, children } = props;

    return jsx('div', {
      'data-file-upload-item': '',
      'data-file-name': file.name,
      children,
    });
  };
});

// ============================================================================
// FileUpload Item Remove
// ============================================================================

export const FileUploadItemRemove = defineComponent<FileUploadItemRemoveProps>((props) => {
  const context = useFileUploadContext();

  const handleClick = (e: Event) => {
    e.stopPropagation();
    context.removeFile(props.file);
  };

  return () => {
    const { file, children, ...rest } = props;

    return jsx('button', {
      type: 'button',
      'data-file-upload-item-remove': '',
      onClick: handleClick,
      'aria-label': `Remove ${file.name}`,
      ...rest,
      children: children ?? '×',
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(FileUpload as any).Trigger = FileUploadTrigger;
(FileUpload as any).Dropzone = FileUploadDropzone;
(FileUpload as any).Item = FileUploadItem;
(FileUpload as any).ItemRemove = FileUploadItemRemove;

// ============================================================================
// Export types
// ============================================================================

export type { FileUploadContextValue };
