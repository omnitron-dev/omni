'use client';

/**
 * Field.MultiSelect Component
 *
 * React Hook Form integrated multi-select with chips.
 *
 * @module @omnitron/prism/components/field
 */

import type { ReactNode, SyntheticEvent } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import type { TextFieldProps } from '@mui/material/TextField';

/**
 * Option for multi-select.
 */
export interface MultiSelectOption {
  /** Option value */
  value: string | number;
  /** Display label */
  label: string;
  /** Optional group */
  group?: string;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * Props for Field.MultiSelect component.
 */
export interface FieldMultiSelectProps {
  /** Field name in the form */
  name: string;
  /** Select options */
  options: MultiSelectOption[];
  /** Field label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Helper text */
  helperText?: string;
  /** Props passed to TextField */
  textFieldProps?: Partial<TextFieldProps>;
  /** Maximum number of selections */
  maxSelections?: number;
  /** Chip variant */
  chipVariant?: 'filled' | 'outlined' | 'soft';
  /** Chip color */
  chipColor?: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
  /** Disable clearable */
  disableClearable?: boolean;
  /** Disable close on select */
  disableCloseOnSelect?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Loading text */
  loadingText?: ReactNode;
  /** No options text */
  noOptionsText?: ReactNode;
  /** Disabled state */
  disabled?: boolean;
  /** Read only state */
  readOnly?: boolean;
  /** Full width */
  fullWidth?: boolean;
  /** Size */
  size?: 'small' | 'medium';
  /** Limit number of visible tags */
  limitTags?: number;
}

/**
 * Field.MultiSelect - Multiple selection with React Hook Form integration.
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.MultiSelect
 *     name="tags"
 *     label="Tags"
 *     options={[
 *       { value: 'react', label: 'React' },
 *       { value: 'typescript', label: 'TypeScript' },
 *       { value: 'nodejs', label: 'Node.js' },
 *     ]}
 *   />
 * </FormProvider>
 * ```
 */
export function FieldMultiSelect({
  name,
  options,
  label,
  placeholder,
  helperText,
  textFieldProps,
  maxSelections,
  chipVariant = 'filled',
  chipColor = 'primary',
  disableClearable,
  disableCloseOnSelect,
  loading,
  loadingText,
  noOptionsText,
  disabled,
  readOnly,
  fullWidth = true,
  size,
  limitTags,
}: FieldMultiSelectProps): ReactNode {
  const { control, setValue } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        // Convert array of values to array of options
        const values = (field.value as (string | number)[] | undefined) ?? [];
        const selectedOptions = values
          .map((val) => options.find((opt) => opt.value === val))
          .filter((opt): opt is MultiSelectOption => opt !== undefined);

        const isMaxReached = maxSelections !== undefined && selectedOptions.length >= maxSelections;

        return (
          <Autocomplete
            multiple
            options={options}
            value={selectedOptions}
            disableClearable={disableClearable}
            disableCloseOnSelect={disableCloseOnSelect}
            loading={loading}
            loadingText={loadingText}
            noOptionsText={noOptionsText}
            disabled={disabled}
            readOnly={readOnly}
            fullWidth={fullWidth}
            size={size}
            limitTags={limitTags}
            getOptionLabel={(option) => option.label}
            getOptionDisabled={(option) => {
              if (option.disabled) return true;
              // Disable all options if max reached and option not already selected
              if (isMaxReached) {
                const isSelected = selectedOptions.some((sel) => sel.value === option.value);
                return !isSelected;
              }
              return false;
            }}
            isOptionEqualToValue={(option, value) => option.value === value.value}
            groupBy={options.some((opt) => opt.group) ? (option) => option.group ?? '' : undefined}
            onChange={(_event: SyntheticEvent, newValue: MultiSelectOption[]) => {
              const newValues = newValue.map((item) => item.value);
              setValue(name, newValues, { shouldValidate: true });
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                return (
                  <Chip
                    key={key}
                    label={option.label}
                    variant={chipVariant as 'filled' | 'outlined'}
                    color={chipColor}
                    size="small"
                    {...tagProps}
                  />
                );
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label={label}
                placeholder={selectedOptions.length === 0 ? placeholder : undefined}
                error={!!error}
                helperText={
                  error?.message ??
                  (maxSelections
                    ? `${selectedOptions.length}/${maxSelections} selected${helperText ? ` - ${helperText}` : ''}`
                    : helperText)
                }
                {...textFieldProps}
              />
            )}
          />
        );
      }}
    />
  );
}
