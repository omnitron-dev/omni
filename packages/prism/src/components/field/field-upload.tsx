'use client';

/**
 * Field.Upload Component Suite
 *
 * React Hook Form integrated file upload components using react-dropzone.
 * Includes Upload, UploadBox, and UploadAvatar variants.
 *
 * @module @omnitron-dev/prism/components/field
 */

import type { ReactNode } from 'react';
import { useState, useCallback, useMemo } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { useDropzone } from 'react-dropzone';
import type { DropzoneOptions, FileRejection } from 'react-dropzone';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import FormHelperText from '@mui/material/FormHelperText';
import Avatar from '@mui/material/Avatar';
import { alpha, useTheme } from '@mui/material/styles';
import type { BoxProps } from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

/** File value can be File object or URL string */
export type FileValue = File | string;

/** Single or multiple file values */
export type UploadValue = FileValue | FileValue[] | null;

/**
 * Base props shared by all upload variants
 */
export interface UploadBaseProps extends Omit<DropzoneOptions, 'onDrop'> {
  /** Field name in the form */
  name: string;
  /** Error state */
  error?: boolean;
  /** Disable upload */
  disabled?: boolean;
  /** Helper text shown below */
  helperText?: ReactNode;
  /** Custom placeholder content */
  placeholder?: ReactNode;
  /** Custom styles */
  sx?: SxProps<Theme>;
}

/**
 * Props for Field.Upload component
 */
export interface FieldUploadProps extends UploadBaseProps {
  /** Enable multiple file selection */
  multiple?: boolean;
  /** Show thumbnail previews */
  thumbnail?: boolean;
  /** Callback when files are removed */
  onRemove?: (file: FileValue) => void;
  /** Callback to remove all files */
  onRemoveAll?: () => void;
  /** Slot props for nested components */
  slotProps?: {
    wrapper?: Partial<BoxProps>;
  };
}

/**
 * Props for Field.UploadBox component
 */
export interface FieldUploadBoxProps extends UploadBaseProps {
  /** Box size in pixels */
  size?: number;
}

/**
 * Props for Field.UploadAvatar component
 */
export interface FieldUploadAvatarProps extends UploadBaseProps {
  /** Avatar size in pixels */
  size?: number;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Get preview URL for a file
 */
function getPreviewUrl(file: FileValue): string | null {
  if (typeof file === 'string') return file;
  if (file instanceof File && file.type.startsWith('image/')) {
    return URL.createObjectURL(file);
  }
  return null;
}

/**
 * Get file name for display
 */
function getFileName(file: FileValue): string {
  if (typeof file === 'string') {
    return file.split('/').pop() ?? 'file';
  }
  return file.name;
}

// =============================================================================
// UPLOAD PLACEHOLDER
// =============================================================================

interface PlaceholderProps {
  isDragActive: boolean;
  disabled?: boolean;
}

function UploadPlaceholder({ isDragActive, disabled }: PlaceholderProps): ReactNode {
  const theme = useTheme();

  return (
    <Stack
      spacing={1}
      alignItems="center"
      justifyContent="center"
      sx={{
        p: 3,
        textAlign: 'center',
        color: disabled ? 'text.disabled' : 'text.secondary',
      }}
    >
      <Box
        component="span"
        sx={{
          width: 48,
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          color: 'primary.main',
          fontSize: 24,
        }}
      >
        📁
      </Box>
      <Typography variant="body2" component="span">
        {isDragActive ? (
          'Drop files here'
        ) : (
          <>
            Drag & drop files here, or{' '}
            <Typography component="span" variant="body2" sx={{ color: 'primary.main', textDecoration: 'underline' }}>
              browse
            </Typography>
          </>
        )}
      </Typography>
    </Stack>
  );
}

// =============================================================================
// FILE PREVIEW
// =============================================================================

interface FilePreviewProps {
  files: FileValue[];
  thumbnail?: boolean;
  onRemove?: (file: FileValue) => void;
}

function FilePreview({ files, thumbnail, onRemove }: FilePreviewProps): ReactNode {
  if (files.length === 0) return null;

  return (
    <Stack spacing={1} sx={{ mt: 2 }}>
      {files.map((file, index) => {
        const previewUrl = thumbnail ? getPreviewUrl(file) : null;
        const fileName = getFileName(file);
        const fileSize = file instanceof File ? formatFileSize(file.size) : '';

        return (
          <Box
            key={`${fileName}-${index}`}
            sx={{
              p: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              borderRadius: 1,
              bgcolor: 'background.neutral',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            {previewUrl && (
              <Box
                component="img"
                src={previewUrl}
                alt={fileName}
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 0.5,
                  objectFit: 'cover',
                  flexShrink: 0,
                }}
              />
            )}
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {fileName}
              </Typography>
              {fileSize && (
                <Typography variant="caption" color="text.secondary">
                  {fileSize}
                </Typography>
              )}
            </Box>
            {onRemove && (
              <IconButton size="small" onClick={() => onRemove(file)} sx={{ flexShrink: 0 }}>
                ✕
              </IconButton>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

// =============================================================================
// REJECTION FILES
// =============================================================================

interface RejectionFilesProps {
  rejections: FileRejection[];
}

function RejectionFiles({ rejections }: RejectionFilesProps): ReactNode {
  if (rejections.length === 0) return null;

  return (
    <Box sx={{ mt: 2 }}>
      {rejections.map(({ file, errors }) => (
        <Box
          key={file.name}
          sx={{
            p: 1,
            mb: 1,
            borderRadius: 1,
            bgcolor: 'error.lighter',
            border: '1px solid',
            borderColor: 'error.light',
          }}
        >
          <Typography variant="body2" color="error">
            {file.name}
          </Typography>
          {errors.map((error) => (
            <Typography key={error.code} variant="caption" color="error">
              {error.message}
            </Typography>
          ))}
        </Box>
      ))}
    </Box>
  );
}

// =============================================================================
// FIELD.UPLOAD INNER COMPONENT
// =============================================================================

interface FieldUploadInnerProps {
  value: UploadValue;
  error?: { message?: string };
  multiple: boolean;
  thumbnail: boolean;
  disabled?: boolean;
  helperText?: ReactNode;
  placeholder?: ReactNode;
  onRemove?: (file: FileValue) => void;
  onRemoveAll?: () => void;
  slotProps?: FieldUploadProps['slotProps'];
  sx?: SxProps<Theme>;
  dropzoneOptions: Omit<DropzoneOptions, 'onDrop'>;
  setValue: (name: string, value: UploadValue, options?: { shouldValidate?: boolean }) => void;
  name: string;
}

/**
 * Inner component for FieldUpload to properly use hooks.
 * Extracted to comply with Rules of Hooks.
 */
function FieldUploadInner({
  value,
  error,
  multiple,
  thumbnail,
  disabled,
  helperText,
  placeholder,
  onRemove,
  onRemoveAll,
  slotProps,
  sx,
  dropzoneOptions,
  setValue,
  name,
}: FieldUploadInnerProps): ReactNode {
  const theme = useTheme();
  const [rejections, setRejections] = useState<FileRejection[]>([]);

  const files: FileValue[] = useMemo(() => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }, [value]);

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setRejections(fileRejections);

      if (acceptedFiles.length === 0) return;

      if (multiple) {
        setValue(name, [...files, ...acceptedFiles], { shouldValidate: true });
      } else {
        setValue(name, acceptedFiles[0], { shouldValidate: true });
      }
    },
    [files, multiple, name, setValue]
  );

  const handleRemove = useCallback(
    (file: FileValue) => {
      const newFiles = files.filter((f) => f !== file);
      setValue(name, multiple ? newFiles : null, { shouldValidate: true });
      onRemove?.(file);
    },
    [files, multiple, name, onRemove, setValue]
  );

  const handleRemoveAll = useCallback(() => {
    setValue(name, multiple ? [] : null, { shouldValidate: true });
    onRemoveAll?.();
  }, [multiple, name, onRemoveAll, setValue]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    ...dropzoneOptions,
    multiple,
    disabled,
    onDrop,
  });

  const hasError = !!error;
  const hasFiles = files.length > 0;

  return (
    <Box {...slotProps?.wrapper}>
      <Box
        {...getRootProps()}
        sx={{
          p: 0,
          outline: 'none',
          borderRadius: 1,
          cursor: disabled ? 'default' : 'pointer',
          overflow: 'hidden',
          border: '1px dashed',
          borderColor: hasError ? 'error.main' : isDragActive ? 'primary.main' : 'divider',
          bgcolor: isDragActive ? alpha(theme.palette.primary.main, 0.08) : 'background.paper',
          transition: theme.transitions.create(['border-color', 'background-color']),
          '&:hover': {
            borderColor: disabled ? 'divider' : 'primary.main',
            bgcolor: disabled ? 'background.paper' : alpha(theme.palette.primary.main, 0.04),
          },
          ...sx,
        }}
      >
        <input {...getInputProps()} />
        {placeholder ?? <UploadPlaceholder isDragActive={isDragActive} disabled={disabled} />}
      </Box>

      <RejectionFiles rejections={rejections} />

      <FilePreview files={files} thumbnail={thumbnail} onRemove={handleRemove} />

      {hasFiles && multiple && onRemoveAll && (
        <Box sx={{ mt: 1, textAlign: 'right' }}>
          <Typography
            component="button"
            variant="caption"
            onClick={handleRemoveAll}
            sx={{
              color: 'error.main',
              cursor: 'pointer',
              border: 'none',
              bgcolor: 'transparent',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            Remove all
          </Typography>
        </Box>
      )}

      {(error?.message || helperText) && (
        <FormHelperText error={hasError} sx={{ mt: 1 }}>
          {error?.message ?? helperText}
        </FormHelperText>
      )}
    </Box>
  );
}

// =============================================================================
// FIELD.UPLOAD
// =============================================================================

/**
 * Field.Upload - File upload with drag & drop and React Hook Form integration.
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.Upload
 *     name="documents"
 *     multiple
 *     accept={{ 'application/pdf': ['.pdf'] }}
 *     maxSize={5 * 1024 * 1024}
 *   />
 * </FormProvider>
 * ```
 *
 * @example
 * ```tsx
 * // With thumbnail previews
 * <Field.Upload
 *   name="images"
 *   multiple
 *   thumbnail
 *   accept={{ 'image/*': [] }}
 *   onRemove={(file) => console.log('Removed:', file)}
 * />
 * ```
 */
export function FieldUpload({
  name,
  multiple = false,
  thumbnail = false,
  disabled,
  helperText,
  placeholder,
  onRemove,
  onRemoveAll,
  slotProps,
  sx,
  ...dropzoneOptions
}: FieldUploadProps): ReactNode {
  const { control, setValue } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <FieldUploadInner
          value={field.value}
          error={error}
          multiple={multiple}
          thumbnail={thumbnail}
          disabled={disabled}
          helperText={helperText}
          placeholder={placeholder}
          onRemove={onRemove}
          onRemoveAll={onRemoveAll}
          slotProps={slotProps}
          sx={sx}
          dropzoneOptions={dropzoneOptions}
          setValue={setValue}
          name={name}
        />
      )}
    />
  );
}

// =============================================================================
// FIELD.UPLOAD BOX INNER
// =============================================================================

interface FieldUploadBoxInnerProps {
  value: FileValue | null;
  error?: { message?: string };
  size: number;
  disabled?: boolean;
  helperText?: ReactNode;
  sx?: SxProps<Theme>;
  dropzoneOptions: Omit<DropzoneOptions, 'onDrop'>;
  setValue: (name: string, value: UploadValue, options?: { shouldValidate?: boolean }) => void;
  name: string;
}

function FieldUploadBoxInner({
  value,
  error,
  size,
  disabled,
  helperText,
  sx,
  dropzoneOptions,
  setValue,
  name,
}: FieldUploadBoxInnerProps): ReactNode {
  const theme = useTheme();

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        setValue(name, acceptedFiles[0], { shouldValidate: true });
      }
    },
    [name, setValue]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    ...dropzoneOptions,
    multiple: false,
    disabled,
    onDrop,
  });

  const previewUrl = value ? getPreviewUrl(value) : null;
  const hasError = !!error;

  return (
    <Box>
      <Box
        {...getRootProps()}
        sx={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 1,
          cursor: disabled ? 'default' : 'pointer',
          border: '1px dashed',
          borderColor: hasError ? 'error.main' : isDragActive ? 'primary.main' : 'divider',
          bgcolor: isDragActive ? alpha(theme.palette.primary.main, 0.08) : 'background.paper',
          backgroundImage: previewUrl ? `url(${previewUrl})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          transition: theme.transitions.create(['border-color', 'background-color']),
          '&:hover': {
            borderColor: disabled ? 'divider' : 'primary.main',
          },
          ...sx,
        }}
      >
        <input {...getInputProps()} />
        {!previewUrl && (
          <Typography
            sx={{
              fontSize: size / 3,
              color: isDragActive ? 'primary.main' : 'text.disabled',
            }}
          >
            +
          </Typography>
        )}
      </Box>

      {(error?.message || helperText) && (
        <FormHelperText error={hasError} sx={{ mt: 0.5 }}>
          {error?.message ?? helperText}
        </FormHelperText>
      )}
    </Box>
  );
}

// =============================================================================
// FIELD.UPLOAD BOX
// =============================================================================

/**
 * Field.UploadBox - Compact square upload box for minimal UI.
 *
 * @example
 * ```tsx
 * <Field.UploadBox
 *   name="thumbnail"
 *   size={80}
 *   accept={{ 'image/*': [] }}
 * />
 * ```
 */
export function FieldUploadBox({
  name,
  size = 64,
  disabled,
  helperText,
  sx,
  ...dropzoneOptions
}: FieldUploadBoxProps): ReactNode {
  const { control, setValue } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <FieldUploadBoxInner
          value={field.value}
          error={error}
          size={size}
          disabled={disabled}
          helperText={helperText}
          sx={sx}
          dropzoneOptions={dropzoneOptions}
          setValue={setValue}
          name={name}
        />
      )}
    />
  );
}

// =============================================================================
// FIELD.UPLOAD AVATAR INNER
// =============================================================================

interface FieldUploadAvatarInnerProps {
  value: FileValue | null;
  error?: { message?: string };
  size: number;
  disabled?: boolean;
  helperText?: ReactNode;
  sx?: SxProps<Theme>;
  dropzoneOptions: Omit<DropzoneOptions, 'onDrop'>;
  setValue: (name: string, value: UploadValue, options?: { shouldValidate?: boolean }) => void;
  name: string;
}

function FieldUploadAvatarInner({
  value,
  error,
  size,
  disabled,
  helperText,
  sx,
  dropzoneOptions,
  setValue,
  name,
}: FieldUploadAvatarInnerProps): ReactNode {
  const theme = useTheme();

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        setValue(name, acceptedFiles[0], { shouldValidate: true });
      }
    },
    [name, setValue]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    ...dropzoneOptions,
    multiple: false,
    disabled,
    accept: dropzoneOptions.accept ?? { 'image/*': [] },
    onDrop,
  });

  const previewUrl = value ? getPreviewUrl(value) : null;
  const hasError = !!error;

  return (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box
        {...getRootProps()}
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          cursor: disabled ? 'default' : 'pointer',
          position: 'relative',
          overflow: 'hidden',
          border: '1px dashed',
          borderColor: hasError ? 'error.main' : isDragActive ? 'primary.main' : 'divider',
          transition: theme.transitions.create(['border-color']),
          '&:hover .upload-overlay': {
            opacity: disabled ? 0 : 1,
          },
          ...sx,
        }}
      >
        <input {...getInputProps()} />

        <Avatar
          src={previewUrl ?? undefined}
          sx={{
            width: '100%',
            height: '100%',
            bgcolor: 'background.neutral',
          }}
        >
          {!previewUrl && <Typography sx={{ fontSize: size / 4, color: 'text.disabled' }}>📷</Typography>}
        </Avatar>

        {/* Hover overlay */}
        <Box
          className="upload-overlay"
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(theme.palette.grey[900], 0.64),
            color: 'common.white',
            opacity: isDragActive ? 1 : 0,
            transition: theme.transitions.create('opacity'),
          }}
        >
          <Typography sx={{ fontSize: size / 6 }}>📷</Typography>
          <Typography variant="caption">{previewUrl ? 'Update' : 'Upload'}</Typography>
        </Box>
      </Box>

      {(error?.message || helperText) && (
        <FormHelperText error={hasError} sx={{ mt: 1, textAlign: 'center' }}>
          {error?.message ?? helperText}
        </FormHelperText>
      )}
    </Box>
  );
}

// =============================================================================
// FIELD.UPLOAD AVATAR
// =============================================================================

/**
 * Field.UploadAvatar - Circular avatar upload with preview.
 *
 * @example
 * ```tsx
 * <Field.UploadAvatar
 *   name="avatar"
 *   size={120}
 *   accept={{ 'image/*': [] }}
 *   maxSize={3 * 1024 * 1024}
 * />
 * ```
 */
export function FieldUploadAvatar({
  name,
  size = 144,
  disabled,
  helperText,
  sx,
  ...dropzoneOptions
}: FieldUploadAvatarProps): ReactNode {
  const { control, setValue } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <FieldUploadAvatarInner
          value={field.value}
          error={error}
          size={size}
          disabled={disabled}
          helperText={helperText}
          sx={sx}
          dropzoneOptions={dropzoneOptions}
          setValue={setValue}
          name={name}
        />
      )}
    />
  );
}
