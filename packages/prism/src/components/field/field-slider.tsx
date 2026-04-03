'use client';

/**
 * Field.Slider Component
 *
 * React Hook Form integrated slider.
 *
 * @module @omnitron-dev/prism/components/field
 */

import { useId, type ReactNode } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import type { SliderProps } from '@mui/material/Slider';
import type { FormControlProps } from '@mui/material/FormControl';

/**
 * Props for Field.Slider component.
 */
export interface FieldSliderProps extends Omit<SliderProps, 'name' | 'value' | 'onChange'> {
  /** Field name in the form */
  name: string;
  /** Field label */
  label?: string;
  /** Helper text */
  helperText?: string;
  /** Props passed to FormControl */
  formControlProps?: FormControlProps;
  /** Show current value */
  showValue?: boolean;
  /** Format value display */
  formatValue?: (value: number | number[]) => string;
  /** Unit suffix (e.g., '%', 'px', 'MB') */
  unit?: string;
}

/**
 * Field.Slider - Slider with React Hook Form integration.
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.Slider
 *     name="volume"
 *     label="Volume"
 *     min={0}
 *     max={100}
 *     unit="%"
 *     showValue
 *   />
 *   <Field.Slider
 *     name="priceRange"
 *     label="Price Range"
 *     min={0}
 *     max={1000}
 *     formatValue={(val) => `$${val[0]} - $${val[1]}`}
 *     showValue
 *   />
 * </FormProvider>
 * ```
 */
export function FieldSlider({
  name,
  label,
  helperText,
  formControlProps,
  showValue = false,
  formatValue,
  unit,
  min = 0,
  max = 100,
  step = 1,
  ...other
}: FieldSliderProps): ReactNode {
  const { control } = useFormContext();
  const id = useId();
  const helperId = `field-slider-helper-${id}`;
  const labelId = `field-slider-label-${id}`;

  const defaultFormatValue = (value: number | number[]): string => {
    if (Array.isArray(value)) {
      return `${value[0]}${unit ?? ''} - ${value[1]}${unit ?? ''}`;
    }
    return `${value}${unit ?? ''}`;
  };

  const displayValue = formatValue ?? defaultFormatValue;

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const hasHelper = !!(error?.message || helperText);
        return (
          <FormControl error={!!error} fullWidth {...formControlProps}>
            {(label || showValue) && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                {label && <FormLabel id={labelId}>{label}</FormLabel>}
                {showValue && (
                  <Typography variant="body2" color="text.secondary">
                    {displayValue(field.value ?? (Array.isArray(other.defaultValue) ? [min, max] : min))}
                  </Typography>
                )}
              </Box>
            )}
            <Slider
              {...other}
              {...field}
              value={field.value ?? (Array.isArray(other.defaultValue) ? [min, max] : min)}
              min={min}
              max={max}
              step={step}
              onChange={(_event, newValue) => {
                field.onChange(newValue);
              }}
              valueLabelDisplay={other.valueLabelDisplay ?? 'auto'}
              valueLabelFormat={(value) => `${value}${unit ?? ''}`}
              aria-labelledby={label ? labelId : undefined}
              aria-describedby={hasHelper ? helperId : undefined}
              aria-invalid={!!error}
            />
            {hasHelper && <FormHelperText id={helperId}>{error?.message ?? helperText}</FormHelperText>}
          </FormControl>
        );
      }}
    />
  );
}
