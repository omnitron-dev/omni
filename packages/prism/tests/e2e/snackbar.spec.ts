/**
 * E2E Tests: Snackbar Component
 *
 * Tests for snackbar notifications with SnackbarProvider.
 * Validates appearance, dismissal, and accessibility.
 *
 * @see https://playwright.dev/docs/test-components
 */

import { test, expect } from '@playwright/test';

test.describe('Snackbar with Context', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/snackbar');
  });

  test('should show success snackbar', async ({ page }) => {
    // Click success button
    await page.getByTestId('btn-success').click();

    // Snackbar should appear
    const snackbar = page.getByRole('alert');
    await expect(snackbar).toBeVisible();
    await expect(snackbar).toContainText('Operation completed successfully');
  });

  test('should show error snackbar', async ({ page }) => {
    await page.getByTestId('btn-error').click();

    const snackbar = page.getByRole('alert');
    await expect(snackbar).toBeVisible();
    await expect(snackbar).toContainText('An error occurred');
  });

  test('should show warning snackbar', async ({ page }) => {
    await page.getByTestId('btn-warning').click();

    const snackbar = page.getByRole('alert');
    await expect(snackbar).toBeVisible();
    await expect(snackbar).toContainText('Please review your input');
  });

  test('should show info snackbar', async ({ page }) => {
    await page.getByTestId('btn-info').click();

    const snackbar = page.getByRole('alert');
    await expect(snackbar).toBeVisible();
    await expect(snackbar).toContainText('Here is some information');
  });

  test('should close snackbar when close button is clicked', async ({ page }) => {
    // Show snackbar
    await page.getByTestId('btn-success').click();

    const snackbar = page.getByRole('alert');
    await expect(snackbar).toBeVisible();

    // Click close button
    await page.getByRole('button', { name: 'close' }).click();

    // Snackbar should be hidden
    await expect(snackbar).toBeHidden();
  });

  test('should auto-dismiss after duration', async ({ page }) => {
    // Show snackbar with short duration
    await page.getByTestId('simple-success').click();

    const snackbar = page.getByRole('alert');
    await expect(snackbar).toBeVisible();

    // Wait for auto-dismiss (3000ms + buffer)
    await page.waitForTimeout(3500);

    // Snackbar should be hidden
    await expect(snackbar).toBeHidden();
  });

  test('should show snackbar with custom action', async ({ page }) => {
    await page.getByTestId('btn-custom').click();

    const snackbar = page.getByRole('alert');
    await expect(snackbar).toBeVisible();

    // Should have UNDO action
    const undoButton = page.getByRole('button', { name: 'UNDO' });
    await expect(undoButton).toBeVisible();

    // Click UNDO to close
    await undoButton.click();
    await expect(snackbar).toBeHidden();
  });

  test('should show snackbar at top-right position', async ({ page }) => {
    await page.getByTestId('btn-top-right').click();

    const snackbar = page.getByRole('alert');
    await expect(snackbar).toBeVisible();

    // Verify position via parent snackbar element
    const snackbarContainer = page.locator('.MuiSnackbar-root');
    await expect(snackbarContainer).toBeVisible();

    // Check it's at top
    const box = await snackbarContainer.boundingBox();
    expect(box?.y).toBeLessThan(100); // Should be near top
  });

  test('should replace previous snackbar when new one is shown', async ({ page }) => {
    // Show first snackbar
    await page.getByTestId('btn-success').click();
    await expect(page.getByRole('alert')).toContainText('successfully');

    // Show second snackbar
    await page.getByTestId('btn-error').click();

    // Should show error message now
    await expect(page.getByRole('alert')).toContainText('error occurred');
  });
});

test.describe('SimpleSnackbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/snackbar');
  });

  test('should show simple snackbar on button click', async ({ page }) => {
    await page.getByTestId('simple-success').click();

    const snackbar = page.getByRole('alert');
    await expect(snackbar).toBeVisible();
    await expect(snackbar).toContainText('success message');
  });

  test('should show simple error snackbar', async ({ page }) => {
    await page.getByTestId('simple-error').click();

    const snackbar = page.getByRole('alert');
    await expect(snackbar).toBeVisible();
    await expect(snackbar).toContainText('error message');
  });
});

test.describe('Snackbar Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/snackbar');
  });

  test('should have role="alert"', async ({ page }) => {
    await page.getByTestId('btn-success').click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
  });

  test('should have accessible close button', async ({ page }) => {
    await page.getByTestId('btn-success').click();

    const closeButton = page.getByRole('button', { name: 'close' });
    await expect(closeButton).toBeVisible();
    await expect(closeButton).toHaveAttribute('aria-label', 'close');
  });

  test('should be dismissable with keyboard', async ({ page }) => {
    await page.getByTestId('btn-success').click();

    const snackbar = page.getByRole('alert');
    await expect(snackbar).toBeVisible();

    // Tab to close button and press Enter
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab'); // May need multiple tabs
    await page.keyboard.press('Enter');

    // Give it time to close
    await page.waitForTimeout(300);

    // Snackbar should be hidden
    await expect(snackbar).toBeHidden();
  });

  test('should announce to screen readers', async ({ page }) => {
    await page.getByTestId('btn-success').click();

    // Alert role automatically announces to screen readers
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();

    // Check that content is accessible
    const text = await alert.textContent();
    expect(text).toContain('successfully');
  });
});

test.describe('Snackbar Severity Styles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/snackbar');
  });

  /**
   * Severity has to reach MUI's Alert, or every snackbar looks alike.
   *
   * These four asserted `MuiAlert-filledSuccess` and friends — a compound
   * class MUI stopped emitting. Under @mui/material 9 the element carries
   * `MuiAlert-filled` and `MuiAlert-colorSuccess` separately, so all four
   * failed against a component that was doing exactly the right thing. That
   * is the cost of asserting on a proxy: the name is the library's to change,
   * and when it changes the test accuses the wrong party.
   *
   * The class assertions are kept, corrected, because they name the intent
   * readably. The property that actually matters is at the bottom: four
   * severities must paint four different colours. It holds across a rename
   * and across a repalette, and it goes red on the one failure these exist
   * for — `severity` not arriving.
   */
  const SEVERITIES = [
    { id: 'btn-success', severity: 'Success', hue: 'green' },
    { id: 'btn-error', severity: 'Error', hue: 'red' },
    { id: 'btn-warning', severity: 'Warning', hue: 'orange/yellow' },
    { id: 'btn-info', severity: 'Info', hue: 'blue' },
  ] as const;

  for (const { id, severity, hue } of SEVERITIES) {
    test(`${severity.toLowerCase()} snackbar should have ${hue} styling`, async ({ page }) => {
      await page.getByTestId(id).click();

      const alert = page.getByRole('alert');
      await expect(alert).toBeVisible();

      await expect(alert).toHaveClass(new RegExp(`MuiAlert-color${severity}\\b`));
      await expect(alert).toHaveClass(/MuiAlert-filled\b/);
    });
  }

  test('the four severities are painted four different colours', async ({ page }) => {
    // The assertion the class names stand in for. A component that dropped
    // `severity` on the floor would still carry `MuiAlert-filled` and would
    // still pass every test above if their class patterns ever went stale
    // again; it cannot pass this one.
    const painted = new Map<string, string>();

    for (const { id, severity } of SEVERITIES) {
      await page.getByTestId(id).click();
      const alert = page.getByRole('alert');
      await expect(alert).toBeVisible();
      const colour = await alert.evaluate((el) => getComputedStyle(el).backgroundColor);
      painted.set(severity, colour);
      // Let the snackbar close before the next one, so the colour read
      // belongs to the severity just clicked rather than to whichever alert
      // happened to still be on screen.
      await expect(alert).toBeHidden({ timeout: 15_000 });
    }

    expect(new Set(painted.values()).size, `each severity needs its own colour, got ${JSON.stringify([...painted])}`).toBe(
      SEVERITIES.length
    );
  });
});
