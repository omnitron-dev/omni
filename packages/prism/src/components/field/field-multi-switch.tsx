'use client';

/**
 * Field.MultiSwitch Component
 *
 * React Hook Form integrated multiple switch group.
 * Manages array values for multi-toggle scenarios.
 *
 * @module @omnitron-dev/prism/components/field
 */

import { useId, type ReactNode } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import Box from '@mui/material/Box';
import Switch from '@mui/material/Switch';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import type { BoxProps } from '@mui/material/Box';
import type { SwitchProps } from '@mui/material/Switch';
import type { FormControlProps } from '@mui/material/FormControl';
import type { FormGroupProps } from '@mui/material/FormGroup';
import type { FormHelperTextProps } from '@mui/material/FormHelperText';
import type { FormLabelProps } from '@mui/material/FormLabel';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Option for multi-switch selection
 */
export interface MultiSwitchOption {
  /** Display label */
  label: string;
  /** Value stored when enabled */
  value: string;
  /** Disable this option */
  disabled?: boolean;
}

/**
 * Props for Field.MultiSwitch component.
 */
export interface FieldMultiSwitchProps extends Omit<FormGroupProps, 'onChange'> {
  /** Field name in the form */
  name: string;
  /** Label for the switch group */
  label?: string;
  /** Available options */
  options: MultiSwitchOption[];
  /** Helper text shown below the group */
  helperText?: ReactNode;
  /** Slot props for nested components */
  slotProps?: {
    /** Wrapper FormControl props */
    wrapper?: Partial<FormControlProps>;
    /** Individual Switch props */
    switch?: Partial<SwitchProps>;
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
 * Field.MultiSwitch - Multiple switch group with React Hook Form integration.
 *
 * Stores enabled values as an array. Toggle logic automatically adds/removes
 * values when switches are toggled.
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.MultiSwitch
 *     name="notifications"
 *     label="Notification Settings"
 *     options={[
 *       { label: 'Email notifications', value: 'email' },
 *       { label: 'Push notifications', value: 'push' },
 *       { label: 'SMS notifications', value: 'sms' },
 *     ]}
 *   />
 * </FormProvider>
 * ```
 *
 * @example
 * ```tsx
 * // Horizontal layout with custom styling
 * <Field.MultiSwitch
 *   name="features"
 *   label="Feature Toggles"
 *   row
 *   options={[
 *     { label: 'Beta Features', value: 'beta' },
 *     { label: 'Analytics', value: 'analytics' },
 *     { label: 'Debug Mode', value: 'debug', disabled: true },
 *   ]}
 *   slotProps={{
 *     switch: { color: 'success' },
 *   }}
 * />
 * ```
 */
export function FieldMultiSwitch({
  name,
  label,
  options,
  helperText,
  slotProps,
  row,
  ...other
}: FieldMultiSwitchProps): ReactNode {
  const { control } = useFormContext();
  const id = useId();
  const helperId = `field-multi-switch-helper-${id}`;

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
                      <Switch
                        checked={selectedValues.includes(option.value)}
                        onChange={() => handleToggle(option.value)}
                        {...slotProps?.switch}
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
