/**
 * Form Test Page
 *
 * Renders Prism Field components with React Hook Form for E2E testing.
 * Tests validation, submission, and field interactions.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm, FormProvider } from 'react-hook-form';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';

import { Field } from '../../../src/components/field';

// Form data type
interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  country: string;
  role?: 'admin' | 'user' | 'guest';
  age?: number;
  rating: number;
  experience: number;
  terms: boolean;
  newsletter?: boolean;
}

const countryOptions = [
  { value: 'us', label: 'United States' },
  { value: 'uk', label: 'United Kingdom' },
  { value: 'ca', label: 'Canada' },
  { value: 'au', label: 'Australia' },
  { value: 'de', label: 'Germany' },
];

const roleOptions = [
  { value: 'admin', label: 'Administrator' },
  { value: 'user', label: 'Regular User' },
  { value: 'guest', label: 'Guest' },
];

export function FormTestPage() {
  const [searchParams] = useSearchParams();
  const showAllFields = searchParams.get('full') === 'true';
  const [submitted, setSubmitted] = useState(false);
  const [submittedData, setSubmittedData] = useState<FormData | null>(null);

  const methods = useForm<FormData>({
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      country: '',
      role: undefined,
      age: undefined,
      rating: 0,
      experience: 50,
      terms: false,
      newsletter: false,
    },
    // Use 'all' mode for better validation UX:
    // - Shows errors on blur (immediate feedback)
    // - Validates all fields on submit (catches untouched fields)
    // - Re-validates on change (clears errors as user fixes them)
    mode: 'all',
    reValidateMode: 'onChange',
  });

  const {
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = methods;

  const onSubmit = async (data: FormData) => {
    // Simulate async submission
    await new Promise((resolve) => setTimeout(resolve, 500));
    setSubmittedData(data);
    setSubmitted(true);
  };

  const handleReset = () => {
    reset();
    setSubmitted(false);
    setSubmittedData(null);
  };

  return (
    <Box sx={{ p: 3, maxWidth: 600 }}>
      <Typography variant="h5" gutterBottom>
        Field System Test
      </Typography>

      {submitted && (
        <Alert
          severity="success"
          sx={{ mb: 3 }}
          data-testid="form-success-alert"
          action={
            <Button color="inherit" size="small" onClick={handleReset}>
              Reset
            </Button>
          }
        >
          Form submitted successfully!
        </Alert>
      )}

      {submittedData && (
        <Box sx={{ mb: 3, p: 2, bgcolor: 'grey.100', borderRadius: 1 }} data-testid="submitted-data">
          <Typography variant="subtitle2" gutterBottom>
            Submitted Data:
          </Typography>
          <pre style={{ margin: 0, fontSize: '0.875rem' }}>{JSON.stringify(submittedData, null, 2)}</pre>
        </Box>
      )}

      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} data-testid="test-form">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {/* Text Fields */}
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mt: 1 }}>
              Text Fields
            </Typography>

            <Field.Text
              name="firstName"
              label="First Name"
              placeholder="Enter your first name"
              required
              data-testid="field-first-name"
              rules={{
                required: 'First name is required',
                minLength: { value: 2, message: 'First name must be at least 2 characters' },
              }}
            />

            <Field.Text
              name="lastName"
              label="Last Name"
              placeholder="Enter your last name"
              required
              data-testid="field-last-name"
              rules={{
                required: 'Last name is required',
                minLength: { value: 2, message: 'Last name must be at least 2 characters' },
              }}
            />

            <Field.Text
              name="email"
              label="Email"
              type="email"
              placeholder="you@example.com"
              required
              data-testid="field-email"
              rules={{
                required: 'Email is required',
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Invalid email address',
                },
              }}
            />

            <Field.Text
              name="phone"
              label="Phone Number"
              type="tel"
              placeholder="+1 (555) 000-0000"
              helperText="Optional"
              data-testid="field-phone"
            />

            <Divider sx={{ my: 1 }} />

            {/* Select Fields */}
            <Typography variant="subtitle1" fontWeight="bold">
              Selection Fields
            </Typography>

            <Field.Select
              name="country"
              label="Country"
              options={countryOptions}
              placeholder="Select a country"
              required
              data-testid="field-country"
              rules={{ required: 'Please select a country' }}
            />

            <Field.Radio
              name="role"
              label="User Role"
              options={roleOptions}
              data-testid="field-role"
              rules={{ required: 'Please select a role' }}
            />

            {showAllFields && (
              <>
                <Divider sx={{ my: 1 }} />

                {/* Number Fields */}
                <Typography variant="subtitle1" fontWeight="bold">
                  Numeric Fields
                </Typography>

                <Field.Number
                  name="age"
                  label="Age"
                  min={18}
                  max={120}
                  helperText="Must be 18 or older"
                  data-testid="field-age"
                  rules={{
                    min: { value: 18, message: 'Must be at least 18' },
                    max: { value: 120, message: 'Invalid age' },
                  }}
                />

                <Field.Rating name="rating" label="Overall Rating" data-testid="field-rating" />

                <Field.Slider
                  name="experience"
                  label="Experience Level"
                  min={0}
                  max={100}
                  marks={[
                    { value: 0, label: 'Beginner' },
                    { value: 50, label: 'Intermediate' },
                    { value: 100, label: 'Expert' },
                  ]}
                  data-testid="field-experience"
                />
              </>
            )}

            <Divider sx={{ my: 1 }} />

            {/* Boolean Fields */}
            <Typography variant="subtitle1" fontWeight="bold">
              Boolean Fields
            </Typography>

            <Field.Checkbox
              name="terms"
              label="I agree to the terms and conditions"
              data-testid="field-terms"
              rules={{ required: 'You must accept the terms' }}
            />

            <Field.Switch name="newsletter" label="Subscribe to newsletter" data-testid="field-newsletter" />

            <Divider sx={{ my: 1 }} />

            {/* Actions */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={isSubmitting}
                data-testid="submit-button"
              >
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </Button>

              <Button type="button" variant="outlined" size="large" onClick={handleReset} data-testid="reset-button">
                Reset
              </Button>
            </Box>

            {/* Error Summary */}
            {Object.keys(errors).length > 0 && (
              <Alert severity="error" data-testid="error-summary">
                Please fix the errors above before submitting.
              </Alert>
            )}
          </Box>
        </form>
      </FormProvider>
    </Box>
  );
}
