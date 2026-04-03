'use client';

/**
 * Field.Rating Component
 *
 * React Hook Form integrated star rating.
 *
 * @module @omnitron/prism/components/field
 */

import { useId, type ReactNode } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Rating from '@mui/material/Rating';
import type { RatingProps } from '@mui/material/Rating';
import type { FormControlProps } from '@mui/material/FormControl';

/**
 * Props for Field.Rating component.
 */
export interface FieldRatingProps extends Omit<RatingProps, 'name' | 'value' | 'onChange'> {
  /** Field name in the form */
  name: string;
  /** Field label */
  label?: string;
  /** Helper text */
  helperText?: string;
  /** Props passed to FormControl */
  formControlProps?: FormControlProps;
  /** Show numeric value next to rating */
  showValue?: boolean;
}

/**
 * Field.Rating - Star rating with React Hook Form integration.
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.Rating
 *     name="rating"
 *     label="How would you rate this?"
 *     max={5}
 *     precision={0.5}
 *     showValue
 *   />
 * </FormProvider>
 * ```
 */
export function FieldRating({
  name,
  label,
  helperText,
  formControlProps,
  showValue = false,
  max = 5,
  precision = 1,
  size = 'medium',
  ...other
}: FieldRatingProps): ReactNode {
  const { control } = useFormContext();
  const id = useId();
  const helperId = `field-rating-helper-${id}`;
  const labelId = `field-rating-label-${id}`;

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const hasHelper = !!(error?.message || helperText);
        return (
          <FormControl error={!!error} {...formControlProps}>
            {label && (
              <FormLabel id={labelId} sx={{ mb: 1 }}>
                {label}
              </FormLabel>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Rating
                {...other}
                {...field}
                value={field.value ?? 0}
                max={max}
                precision={precision}
                size={size}
                onChange={(_event, newValue) => {
                  field.onChange(newValue);
                }}
                aria-labelledby={label ? labelId : undefined}
                aria-describedby={hasHelper ? helperId : undefined}
                aria-invalid={!!error}
              />
              {showValue && (
                <Box
                  component="span"
                  sx={{
                    color: 'text.secondary',
                    fontSize: size === 'small' ? '0.75rem' : size === 'large' ? '1rem' : '0.875rem',
                  }}
                >
                  {field.value ?? 0}/{max}
                </Box>
              )}
            </Box>
            {hasHelper && <FormHelperText id={helperId}>{error?.message ?? helperText}</FormHelperText>}
          </FormControl>
        );
      }}
    />
  );
}
