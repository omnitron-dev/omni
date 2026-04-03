'use client';

/**
 * Field.MultiCheckbox Component
 *
 * React Hook Form integrated multiple checkbox group.
 * Manages array values for multi-select scenarios.
 *
 * @module @omnitron/prism/components/field
 */

import { useId, type ReactNode } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import type { BoxProps } from '@mui/material/Box';
import type { CheckboxProps } from '@mui/material/Checkbox';
import type { FormControlProps } from '@mui/material/FormControl';
import type { FormGroupProps } from '@mui/material/FormGroup';
import type { FormHelperTextProps } from '@mui/material/FormHelperText';
import type { FormLabelProps } from '@mui/material/FormLabel';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Option for multi-checkbox selection
 */
export interface MultiCheckboxOption {
  /** Display label */
  label: string;
  /** Value stored when selected */
  value: string;
  /** Disable this option */
  disabled?: boolean;
}

/**
 * Props for Field.MultiCheckbox component.
 */
export interface FieldMultiCheckboxProps extends Omit<FormGroupProps, 'onChange'> {
  /** Field name in the form */
  name: string;
  /** Label for the checkbox group */
  label?: string;
  /** Available options */
  options: MultiCheckboxOption[];
  /** Helper text shown below the group */
  helperText?: ReactNode;
  /** Slot props for nested components */
  slotProps?: {
    /** Wrapper FormControl props */
    wrapper?: Partial<FormControlProps>;
    /** Individual Checkbox props */
    checkbox?: Partial<CheckboxProps>;
    /** FormLabel props */
    formLabel?: Partial<FormLabelProps>;
    /** FormHelperText props */
    helperText?: Partial<FormHelperTextProps>;
    /** Container Box props */
    container?: Partial<BoxProps>;
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Field.MultiCheckbox - Multiple checkbox group with React Hook Form integration.
 *
 * Stores selected values as an array. Toggle logic automatically adds/removes
 * values when checkboxes are clicked.
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.MultiCheckbox
 *     name="interests"
 *     label="Select your interests"
 *     options={[
 *       { label: 'Technology', value: 'tech' },
 *       { label: 'Sports', value: 'sports' },
 *       { label: 'Music', value: 'music' },
 *       { label: 'Art', value: 'art' },
 *     ]}
 *   />
 * </FormProvider>
 * ```
 *
 * @example
 * ```tsx
 * // Horizontal layout
 * <Field.MultiCheckbox
 *   name="features"
 *   label="Enable features"
 *   row
 *   options={[
 *     { label: 'Dark Mode', value: 'dark' },
 *     { label: 'Notifications', value: 'notify' },
 *     { label: 'Auto-save', value: 'autosave', disabled: true },
 *   ]}
 * />
 * ```
 */
export function FieldMultiCheckbox({
  name,
  label,
  options,
  helperText,
  slotProps,
  row,
  ...other
}: FieldMultiCheckboxProps): ReactNode {
  const { control } = useFormContext();
  const id = useId();
  const helperId = `field-multi-checkbox-helper-${id}`;

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const selectedValues: string[] = Array.isArray(field.value) ? field.value : [];
        const hasHelper = !!(error?.message || helperText);

        const handleToggle = (optionValue: string) => {
          const isSelected = selectedValues.includes(optionValue);
          const newValues = isSelected
            ? selectedValues.filter((v) => v !== optionValue)
            : [...selectedValues, optionValue];
          field.onChange(newValues);
        };

        return (
          <FormControl
            component="fieldset"
            error={!!error}
            aria-describedby={hasHelper ? helperId : undefined}
            {...slotProps?.wrapper}
          >
            {label && (
              <FormLabel
                component="legend"
                {...slotProps?.formLabel}
                sx={{
                  mb: 1,
                  ...slotProps?.formLabel?.sx,
                }}
              >
                {label}
              </FormLabel>
            )}

            <Box {...slotProps?.container}>
              <FormGroup row={row} {...other}>
                {options.map((option) => (
                  <FormControlLabel
                    key={option.value}
                    label={option.label}
                    disabled={option.disabled}
                    control={
                      <Checkbox
                        checked={selectedValues.includes(option.value)}
                        onChange={() => handleToggle(option.value)}
                        {...slotProps?.checkbox}
                      />
                    }
                  />
                ))}
              </FormGroup>
            </Box>

            {hasHelper && (
              <FormHelperText id={helperId} error={!!error} {...slotProps?.helperText}>
                {error?.message ?? helperText}
              </FormHelperText>
            )}
          </FormControl>
        );
      }}
    />
  );
}
