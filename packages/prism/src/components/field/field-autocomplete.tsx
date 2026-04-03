'use client';

/**
 * Field.Autocomplete Component
 *
 * React Hook Form integrated autocomplete with search.
 *
 * @module @omnitron/prism/components/field
 */

import type { ReactNode, SyntheticEvent } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import type { TextFieldProps } from '@mui/material/TextField';

/**
 * Option for autocomplete.
 */
export interface AutocompleteOption {
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
 * Props for Field.Autocomplete component.
 */
export interface FieldAutocompleteProps {
  /** Field name in the form */
  name: string;
  /** Autocomplete options */
  options: AutocompleteOption[];
  /** Field label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Helper text */
  helperText?: string;
  /** Props passed to TextField */
  textFieldProps?: Partial<TextFieldProps>;
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
}

/**
 * Field.Autocomplete - Autocomplete with React Hook Form integration.
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.Autocomplete
 *     name="country"
 *     label="Country"
 *     options={countries}
 *     placeholder="Select a country..."
 *   />
 * </FormProvider>
 * ```
 */
export function FieldAutocomplete({
  name,
  options,
  label,
  placeholder,
  helperText,
  textFieldProps,
  disableClearable,
  disableCloseOnSelect,
  loading,
  loadingText,
  noOptionsText,
  disabled,
  readOnly,
  fullWidth = true,
  size,
}: FieldAutocompleteProps): ReactNode {
  const { control, setValue } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        // Find selected option
        const selectedOption = options.find((opt) => opt.value === field.value) ?? null;

        return (
          <Autocomplete
            options={options}
            value={selectedOption}
            disableClearable={disableClearable}
            disableCloseOnSelect={disableCloseOnSelect}
            loading={loading}
            loadingText={loadingText}
            noOptionsText={noOptionsText}
            disabled={disabled}
            readOnly={readOnly}
            fullWidth={fullWidth}
            size={size}
            getOptionLabel={(option) => option.label}
            getOptionDisabled={(option) => !!option.disabled}
            isOptionEqualToValue={(option, value) => option.value === value.value}
            groupBy={options.some((opt) => opt.group) ? (option) => option.group ?? '' : undefined}
            onChange={(_event: SyntheticEvent, newValue: AutocompleteOption | null) => {
              setValue(name, newValue?.value ?? '', { shouldValidate: true });
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label={label}
                placeholder={placeholder}
                error={!!error}
                helperText={error?.message ?? helperText}
                {...textFieldProps}
              />
            )}
          />
        );
      }}
    />
  );
}
