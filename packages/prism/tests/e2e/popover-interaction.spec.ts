import { expect, test, type Locator, type Page } from '@playwright/test';

// Locator.click() retries until overlays stop intercepting events. Use a real
// coordinate click so a swallowed first click fails instead of being retried.
async function clickOnce(page: Page, locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const x = bounds!.x + bounds!.width / 2;
  const y = bounds!.y + bounds!.height / 2;
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

for (const kind of ['menu', 'select', 'popover']) {
  for (const keepMounted of [false, true]) {
    test(`${kind} releases adjacent controls during exit (keepMounted=${keepMounted})`, async ({ page }) => {
      await page.goto(`/test/popover-interaction?kind=${kind}${keepMounted ? '&keepMounted' : ''}`);
      const trigger = page.getByRole(kind === 'select' ? 'combobox' : 'button', { name: 'Choose value', includeHidden: true });
      const action = page.getByRole('button', { name: 'Adjacent action', includeHidden: true });
      await trigger.click();
      if (kind === 'select') await page.getByRole('option', { name: 'Selected', exact: true }).click();
      else await page.getByRole(kind === 'menu' ? 'menuitem' : 'button', { name: 'Select value' }).click();
      await expect(page.getByTestId('selection')).toHaveText('Selected');
      await expect(trigger).toBeFocused();
      const root = page.locator('.MuiPopover-root');
      await expect(root).toBeAttached();
      // The animation remains mounted; the first physical click must work now.
      await clickOnce(page, action);
      await expect(page.getByTestId('actions')).toHaveText('1');
      await expect(action).toBeFocused();
      await expect(root).toBeAttached();
    });
  }

  test(`${kind} supports immediate reopening and native keyboard focus`, async ({ page }) => {
    await page.goto(`/test/popover-interaction?kind=${kind}`);
    const trigger = page.getByRole(kind === 'select' ? 'combobox' : 'button', { name: 'Choose value', includeHidden: true });
    const action = page.getByRole('button', { name: 'Adjacent action', includeHidden: true });
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await clickOnce(page, trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.MuiPopover-root')).toHaveCSS('pointer-events', 'auto');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('actions')).toHaveText('1');
  });
}

test('an open menu consumes outside clicks and keeps its parent dialog modal after closing', async ({ page }) => {
  await page.goto('/test/popover-interaction?dialog=1');
  const trigger = page.getByRole('button', { name: 'Choose value', includeHidden: true });
  const action = page.getByRole('button', { name: 'Adjacent action', includeHidden: true });
  await trigger.click();
  await clickOnce(page, action);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('actions')).toHaveText('0');
  await clickOnce(page, action);
  await expect(page.getByTestId('actions')).toHaveText('1');
  // Hidden to accessibility while its enclosing Dialog is open, but present.
  await clickOnce(page, page.getByRole('button', { name: 'Background action', includeHidden: true }));
  await expect(page.getByTestId('background-actions')).toHaveText('0');
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
});
