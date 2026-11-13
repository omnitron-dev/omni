import { expect } from '@playwright/test';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('diagrams.html');

test('tab alternatives remain labelled and readable without the client', async ({ browser, cliSiteUrl }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(cliSiteUrl);
    const group = page.locator('.lumen-tabs').first();
    await expect(group.getByRole('heading', { name: 'pnpm', exact: true })).toBeVisible();
    await expect(group.getByRole('region', { name: 'npm', exact: true })).toContainText('Second install command.');
    await expect(group.getByRole('tab')).toHaveCount(0);
    await expect(group.locator('[hidden]')).toHaveCount(0);
  } finally { await context.close(); }
});

test('the shared tabs keep deep links, panel identity, keyboard focus and synchronized choices', async ({ page, cliSiteUrl }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto(`${cliSiteUrl}#npm-installation`);
  const first = page.getByRole('tablist', { name: 'Installation command' });
  const second = page.getByRole('tablist', { name: 'Preview command' });
  const npm = first.getByRole('tab', { name: 'npm', exact: true });
  const pnpm = first.getByRole('tab', { name: 'pnpm' });
  await expect(npm).toHaveAttribute('aria-selected', 'true');
  await expect(second.getByRole('tab', { name: 'npm', exact: true })).toHaveAttribute('aria-selected', 'true');
  const anchor = await page.locator('#npm-installation').elementHandle();
  await npm.focus();
  await page.keyboard.press('Home');
  await expect(pnpm).toBeFocused();
  await expect(pnpm).toHaveAttribute('aria-selected', 'true');
  await expect(second.getByRole('tab', { name: 'pnpm' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(npm).toBeFocused();
  await expect(second.getByRole('tab', { name: 'npm', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'npm', exact: true })).toHaveCount(2);
  const relationships = await npm.evaluate(button => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    return Boolean(panel && panel.getAttribute('aria-labelledby') === button.id && !panel.hidden);
  });
  expect(relationships).toBe(true);
  await page.keyboard.press('ArrowLeft');
  await expect(pnpm).toBeFocused();
  await page.keyboard.press('End');
  await expect(npm).toBeFocused();
  expect(await anchor.evaluate(node => node === document.querySelector('#npm-installation'))).toBe(true);
  const groupWidth = await first.evaluate(list => {
    const group = list.closest('.lumen-tabs');
    return { content: group.scrollWidth, viewport: group.clientWidth };
  });
  expect(groupWidth.content).toBeLessThanOrEqual(groupWidth.viewport);
  expect(groupWidth.viewport).toBeLessThanOrEqual(320);
});
