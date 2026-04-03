/**
 * E2E Tests: Field System Components
 *
 * Tests for the Prism Field components with React Hook Form + Zod integration.
 * Validates form interactions, validation, submission, and accessibility.
 *
 * @see https://playwright.dev/docs/test-components
 */

import { test, expect } from '@playwright/test';

test.describe('Field System - Basic Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/form');
  });

  test('should render all basic form fields', async ({ page }) => {
    // Text fields
    await expect(page.getByLabel('First Name')).toBeVisible();
    await expect(page.getByLabel('Last Name')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Phone Number')).toBeVisible();

    // Select field
    await expect(page.getByLabel('Country')).toBeVisible();

    // Radio group
    await expect(page.getByRole('radiogroup')).toBeVisible();
    await expect(page.getByLabel('Administrator')).toBeVisible();
    await expect(page.getByLabel('Regular User')).toBeVisible();
    await expect(page.getByLabel('Guest')).toBeVisible();

    // Boolean fields
    await expect(page.getByLabel(/terms and conditions/i)).toBeVisible();
    await expect(page.getByLabel(/Subscribe to newsletter/i)).toBeVisible();

    // Buttons
    await expect(page.getByTestId('submit-button')).toBeVisible();
    await expect(page.getByTestId('reset-button')).toBeVisible();
  });
});

test.describe('Field.Text - Text Input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/form');
  });

  test('should accept text input', async ({ page }) => {
    const firstNameField = page.getByLabel('First Name');
    await firstNameField.fill('John');
    await expect(firstNameField).toHaveValue('John');
  });

  test('should show validation error for short input', async ({ page }) => {
    const firstNameField = page.getByLabel('First Name');

    // Type single character
    await firstNameField.click();
    await firstNameField.fill('J');

    // Click elsewhere to trigger blur
    await page.getByLabel('Last Name').click();

    // Wait for validation - should show validation error
    await expect(page.getByText('First name must be at least 2 characters')).toBeVisible({ timeout: 5000 });
  });

  test('should validate email format', async ({ page }) => {
    const emailField = page.getByLabel('Email');

    // Type invalid email
    await emailField.click();
    await emailField.fill('invalid-email');

    // Click elsewhere to trigger blur
    await page.getByLabel('First Name').click();

    // Should show validation error
    await expect(page.getByText('Invalid email address')).toBeVisible({ timeout: 5000 });

    // Fix email
    await emailField.click();
    await emailField.fill('john@example.com');
    await page.getByLabel('First Name').click();

    // Error should be gone
    await expect(page.getByText('Invalid email address')).toBeHidden();
  });

  test('should clear validation error when fixed', async ({ page }) => {
    const lastNameField = page.getByLabel('Last Name');

    // Trigger validation error
    await lastNameField.click();
    await lastNameField.fill('D');
    await page.getByLabel('First Name').click();
    await expect(page.getByText('Last name must be at least 2 characters')).toBeVisible({ timeout: 5000 });

    // Fix the error
    await lastNameField.click();
    await lastNameField.fill('Doe');
    await page.getByLabel('First Name').click();

    // Error should be cleared
    await expect(page.getByText('Last name must be at least 2 characters')).toBeHidden();
  });
});

test.describe('Field.Select - Dropdown Select', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/form');
  });

  test('should open dropdown and select option', async ({ page }) => {
    // Use combobox role for MUI Select
    const countryField = page.getByRole('combobox', { name: /country/i });

    // Click to open dropdown
    await countryField.click();

    // Wait for dropdown options
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();

    // Select an option
    await page.getByRole('option', { name: 'Canada' }).click();

    // Dropdown should close and value should be set
    await expect(listbox).toBeHidden();
    await expect(countryField).toContainText('Canada');
  });

  test('should show all available options', async ({ page }) => {
    await page.getByRole('combobox', { name: /country/i }).click();

    const listbox = page.getByRole('listbox');
    await expect(listbox.getByRole('option', { name: 'United States' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'United Kingdom' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'Canada' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'Australia' })).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'Germany' })).toBeVisible();
  });

  test('should support keyboard navigation', async ({ page }) => {
    const countryField = page.getByRole('combobox', { name: /country/i });

    // Focus and open with keyboard
    await countryField.focus();
    await page.keyboard.press('ArrowDown');

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();

    // Navigate with arrow keys
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // Should have selected an option
    await expect(listbox).toBeHidden();
  });
});

test.describe('Field.Radio - Radio Button Group', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/form');
  });

  test('should select radio option', async ({ page }) => {
    const adminRadio = page.getByLabel('Administrator');
    const userRadio = page.getByLabel('Regular User');

    // Initially none selected
    await expect(adminRadio).not.toBeChecked();
    await expect(userRadio).not.toBeChecked();

    // Select admin
    await adminRadio.click();
    await expect(adminRadio).toBeChecked();
    await expect(userRadio).not.toBeChecked();

    // Change selection
    await userRadio.click();
    await expect(adminRadio).not.toBeChecked();
    await expect(userRadio).toBeChecked();
  });

  test('should only allow one selection at a time', async ({ page }) => {
    const adminRadio = page.getByLabel('Administrator');
    const userRadio = page.getByLabel('Regular User');
    const guestRadio = page.getByLabel('Guest');

    await adminRadio.click();
    await expect(adminRadio).toBeChecked();

    await guestRadio.click();
    await expect(adminRadio).not.toBeChecked();
    await expect(userRadio).not.toBeChecked();
    await expect(guestRadio).toBeChecked();
  });
});

test.describe('Field.Checkbox - Checkbox Input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/form');
  });

  test('should toggle checkbox', async ({ page }) => {
    const termsCheckbox = page.getByLabel(/terms and conditions/i);

    // Initially unchecked
    await expect(termsCheckbox).not.toBeChecked();

    // Check
    await termsCheckbox.click();
    await expect(termsCheckbox).toBeChecked();

    // Uncheck
    await termsCheckbox.click();
    await expect(termsCheckbox).not.toBeChecked();
  });

  test('should support keyboard toggle', async ({ page }) => {
    const termsCheckbox = page.getByLabel(/terms and conditions/i);

    await termsCheckbox.focus();
    await page.keyboard.press('Space');
    await expect(termsCheckbox).toBeChecked();

    await page.keyboard.press('Space');
    await expect(termsCheckbox).not.toBeChecked();
  });
});

test.describe('Field.Switch - Toggle Switch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/form');
  });

  test('should toggle switch', async ({ page }) => {
    const newsletterSwitch = page.getByLabel(/Subscribe to newsletter/i);

    // Initially off
    await expect(newsletterSwitch).not.toBeChecked();

    // Toggle on
    await newsletterSwitch.click();
    await expect(newsletterSwitch).toBeChecked();

    // Toggle off
    await newsletterSwitch.click();
    await expect(newsletterSwitch).not.toBeChecked();
  });
});

test.describe('Form Submission', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/form');
  });

  test('should show validation errors on submit with empty form', async ({ page }) => {
    // React Hook Form with mode: 'all' validates on blur and submit
    // Touch required fields to trigger validation (realistic user flow)
    await page.getByLabel('First Name').click();
    await page.getByLabel('Last Name').click();
    await page.getByLabel('Email').click();

    // Submit the form - this will validate all fields
    await page.getByTestId('submit-button').click();

    // Wait for error summary to appear (indicates validation ran)
    await expect(page.getByTestId('error-summary')).toBeVisible();

    // Check individual field errors appear in helper text areas
    await expect(page.getByText('First name is required')).toBeVisible();
    await expect(page.getByText('Last name is required')).toBeVisible();
    await expect(page.getByText('Email is required')).toBeVisible();
  });

  test('should submit valid form successfully', async ({ page }) => {
    // Fill all required fields
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Email').fill('john@example.com');

    // Select country
    await page.getByLabel('Country').click();
    await page.getByRole('option', { name: 'United States' }).click();

    // Select role
    await page.getByLabel('Administrator').click();

    // Accept terms
    await page.getByLabel(/terms and conditions/i).click();

    // Submit
    await page.getByTestId('submit-button').click();

    // Should show success message
    await expect(page.getByTestId('form-success-alert')).toBeVisible();
    await expect(page.getByText('Form submitted successfully!')).toBeVisible();

    // Should show submitted data
    await expect(page.getByTestId('submitted-data')).toBeVisible();
    await expect(page.getByTestId('submitted-data')).toContainText('John');
    await expect(page.getByTestId('submitted-data')).toContainText('Doe');
    await expect(page.getByTestId('submitted-data')).toContainText('john@example.com');
  });

  test('should disable submit button during submission', async ({ page }) => {
    // Fill required fields quickly
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Email').fill('john@example.com');
    await page.getByLabel('Country').click();
    await page.getByRole('option', { name: 'Canada' }).click();
    await page.getByLabel('Regular User').click();
    await page.getByLabel(/terms and conditions/i).click();

    // Click submit
    const submitButton = page.getByTestId('submit-button');
    await submitButton.click();

    // Button should show loading state
    await expect(submitButton).toContainText(/Submitting/i);
    await expect(submitButton).toBeDisabled();

    // After submission completes
    await expect(page.getByTestId('form-success-alert')).toBeVisible();
  });

  test('should reset form on reset button click', async ({ page }) => {
    // Fill some fields
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Email').fill('john@example.com');

    // Click reset
    await page.getByTestId('reset-button').click();

    // Fields should be empty
    await expect(page.getByLabel('First Name')).toHaveValue('');
    await expect(page.getByLabel('Email')).toHaveValue('');
  });
});

test.describe('Form Validation Messages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/form');
  });

  test('should show required field errors', async ({ page }) => {
    // Focus and blur to trigger validation
    await page.getByLabel('First Name').focus();
    await page.getByLabel('First Name').blur();

    // Country field - click and blur without selecting
    await page.getByLabel('Country').click();
    await page.keyboard.press('Escape');

    // Submit to trigger all validations
    await page.getByTestId('submit-button').click();

    // Check for error summary
    await expect(page.getByTestId('error-summary')).toBeVisible();
  });

  test('should validate terms checkbox is required', async ({ page }) => {
    // Fill all fields except terms
    await page.getByLabel('First Name').fill('John');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('Email').fill('john@example.com');
    await page.getByLabel('Country').click();
    await page.getByRole('option', { name: 'Canada' }).click();
    await page.getByLabel('Administrator').click();

    // Try to submit
    await page.getByTestId('submit-button').click();

    // Should show error about terms
    await expect(page.getByText('You must accept the terms')).toBeVisible();
  });
});

test.describe('Field Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/form');
  });

  test('should support tab navigation through fields', async ({ page }) => {
    // Start tabbing through form
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('First Name')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Last Name')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Phone Number')).toBeFocused();
  });

  test('should have proper labels associated with inputs', async ({ page }) => {
    const firstNameField = page.getByLabel('First Name');

    // Verify the field is accessible by label - if getByLabel finds it, it's properly associated
    await expect(firstNameField).toBeVisible();

    // Check that field has an accessible name (via id/for, aria-label, or aria-labelledby)
    const hasAccessibleLabel = await firstNameField.evaluate((el) => {
      const id = el.id;
      const ariaLabel = el.getAttribute('aria-label');
      const ariaLabelledby = el.getAttribute('aria-labelledby');
      const hasMatchingLabel = id && document.querySelector(`label[for="${id}"]`);
      return !!(hasMatchingLabel || ariaLabel || ariaLabelledby);
    });

    expect(hasAccessibleLabel).toBe(true);
  });

  test('should announce validation errors to screen readers', async ({ page }) => {
    const emailField = page.getByLabel('Email');

    // Enter invalid email
    await emailField.click();
    await emailField.fill('invalid');
    await page.getByLabel('First Name').click();

    // Error message should be visible (and announced)
    const errorMessage = page.getByText('Invalid email address');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });

    // Check if error is associated with field via aria-describedby
    const ariaDescribedBy = await emailField.getAttribute('aria-describedby');
    expect(ariaDescribedBy).toBeTruthy();
  });
});

test.describe('Field System - Full Fields Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/form?full=true');
  });

  test('should render numeric fields in full mode', async ({ page }) => {
    await expect(page.getByLabel('Age')).toBeVisible();
    await expect(page.getByTestId('field-rating')).toBeVisible();
    await expect(page.getByTestId('field-experience')).toBeVisible();
  });

  test('should accept number input in age field', async ({ page }) => {
    const ageField = page.getByLabel('Age');
    await ageField.fill('25');
    await expect(ageField).toHaveValue('25');
  });
});
