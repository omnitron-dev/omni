/**
 * Styled Form Component
 *
 * A form wrapper with validation support.
 * Built on top of the Form primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Form as FormPrimitive } from '../../primitives/Form.js';

/**
 * Form - Form wrapper with validation
 *
 * @example
 * ```tsx
 * <Form onSubmit={handleSubmit} spacing="md">
 *   <Label for="email">Email</Label>
 *   <Input id="email" type="email" />
 *   <Button type="submit">Submit</Button>
 * </Form>
 * ```
 */
export const Form = styled(FormPrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  variants: {
    spacing: {
      none: {
        gap: '0',
      },
      sm: {
        gap: '0.5rem',
      },
      md: {
        gap: '1rem',
      },
      lg: {
        gap: '1.5rem',
      },
      xl: {
        gap: '2rem',
      },
    },
    layout: {
      vertical: {
        flexDirection: 'column',
      },
      horizontal: {
        flexDirection: 'row',
        alignItems: 'flex-end',
      },
    },
  },
  defaultVariants: {
    spacing: 'md',
    layout: 'vertical',
  },
});

// Attach display name
(Form as any).displayName = 'Form';
