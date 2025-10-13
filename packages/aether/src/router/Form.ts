/**
 * Router Form Component
 *
 * Form component that integrates with router actions for enhanced
 * form submissions without full page reloads.
 */

import { defineComponent } from '../core/component/define.js';
import { jsx } from '../jsx-runtime.js';
import { useSubmit, useFormAction } from './hooks.js';
import { useNavigation } from './data.js';
import type { SubmitOptions } from './hooks.js';

/**
 * Form component props
 */
export interface FormProps {
  /** Form action URL (defaults to current route) */
  action?: string;
  /** HTTP method */
  method?: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Form encoding type */
  encType?: 'application/x-www-form-urlencoded' | 'multipart/form-data';
  /** Replace current history entry */
  replace?: boolean;
  /** Prevent default form submission */
  preventScrollReset?: boolean;
  /** Form ID */
  id?: string;
  /** Form CSS class */
  class?: string;
  /** Form children */
  children?: any;
  /** Submit handler */
  onSubmit?: (event: SubmitEvent) => void | Promise<void>;
}

/**
 * Router-integrated Form component
 *
 * Automatically uses router actions for form submissions, providing
 * enhanced user experience without full page reloads.
 *
 * @example
 * ```typescript
 * import { Form } from '@omnitron-dev/aether/router';
 *
 * // Basic form with current route action
 * <Form method="post">
 *   <input name="email" type="email" />
 *   <button type="submit">Subscribe</button>
 * </Form>
 *
 * // Form with custom action
 * <Form action="/api/users" method="post">
 *   <input name="name" />
 *   <button type="submit">Create User</button>
 * </Form>
 *
 * // Form with custom submit handler
 * <Form
 *   method="post"
 *   onSubmit={async (event) => {
 *     // Custom validation or pre-processing
 *     console.log('Form submitted');
 *   }}
 * >
 *   <input name="data" />
 *   <button type="submit">Submit</button>
 * </Form>
 * ```
 */
export const Form = defineComponent<FormProps>((props) => {
  const submit = useSubmit();
  const navigation = useNavigation();
  const formAction = useFormAction(props.action);

  const handleSubmit = async (event: SubmitEvent) => {
    // Prevent default browser form submission
    event.preventDefault();

    // Call custom onSubmit handler if provided
    if (props.onSubmit) {
      await props.onSubmit(event);
    }

    // Get form data
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);

    // Submit via router
    const options: SubmitOptions = {
      method: props.method || 'post',
      action: formAction(),
      replace: props.replace,
      encType: props.encType,
    };

    await submit(formData, options);
  };

  const isSubmitting = () => navigation().state === 'submitting';

  return () =>
    jsx('form', {
      action: formAction(),
      method: props.method || 'post',
      enctype: props.encType,
      id: props.id,
      class: props.class,
      onsubmit: handleSubmit,
      'aria-busy': isSubmitting(),
      children: props.children,
    });
});

// Set display name for debugging
(Form as any).displayName = 'RouterForm';
