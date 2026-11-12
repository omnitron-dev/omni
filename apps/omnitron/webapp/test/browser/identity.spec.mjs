import { test, expect, stubInventory } from './fixtures.mjs';

for (const mode of ['light', 'dark']) {
  test('shared identity remains readable and operable in ' + mode, async ({ page, url }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(url + '/identity.html?mode=' + mode);
    await expect(page.getByRole('heading', { name: 'Omnitron Console' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const password = page.getByRole('textbox', { name: 'Username' });
    await password.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const reveal = page.getByRole('button', { name: 'Show password' });
    await expect(reveal).toBeFocused();
    const focus = await reveal.evaluate(element => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset };
    });
    expect(focus).toEqual({ style: 'solid', width: '2px', offset: '3px' });
    await expect(page.getByRole('progressbar', { name: 'Uploading archive' })).toHaveAttribute('aria-valuenow', '37');
    await expect(page.getByRole('alert')).toHaveText('Connection lost');
    await page.screenshot({ path: test.info().outputPath('identity-' + mode + '-320.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({ path: test.info().outputPath('identity-' + mode + '-1440.png'), fullPage: true });
  });
}

test('Console navigation uses the same brand in both modes and on a narrow screen', async ({ page, url }) => {
  await stubInventory(page);
  for (const mode of ['light', 'dark']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url + '/workspace.html?mode=' + mode);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByText('OMNITRON', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('console-' + mode + '-1440.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 740 });
    const content = page.getByTestId('content');
    const contentBox = await content.boundingBox();
    expect(contentBox.x).toBe(8);
    expect(contentBox.width).toBe(304);
    const openMenu = page.getByRole('button', { name: 'Open menu' });
    await expect(openMenu).toBeVisible();
    await expect(content).toHaveText('Project content');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.screenshot({ path: test.info().outputPath('console-' + mode + '-320.png'), fullPage: true });
    await openMenu.click();
    const drawer = page.getByRole('dialog', { name: 'Main navigation' });
    await expect(drawer).toBeVisible();
    await expect.poll(async () => {
      const box = await drawer.boundingBox();
      return box.x >= 0 && box.x + box.width <= 320;
    }).toBe(true);
    await expect(drawer.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: 'Close menu' }).click();
    await expect(drawer).not.toBeVisible();
  }
});

for (const motion of ['reduce', 'no-preference']) {
  test('the first mobile frame releases the desktop sidebar inset with ' + motion + ' motion', async ({ page, url }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await stubInventory(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url + '/workspace.html');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await page.evaluate(() => {
      window.mobileFrame = new Promise(resolve => window.addEventListener('resize', () => requestAnimationFrame(() => {
        const main = document.getElementById('main-content').getBoundingClientRect();
        const content = document.querySelector('[data-testid="content"]').getBoundingClientRect();
        resolve({ mainX: main.x, mainWidth: main.width, contentX: content.x, contentWidth: content.width });
      }), { once: true }));
    });
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => window.mobileFrame)).toEqual({ mainX: 0, mainWidth: 320, contentX: 8, contentWidth: 304 });
  });
}

test('brand activity respects reduced motion and pauses outside the viewport', async ({ page, url }) => {
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.goto(url + '/identity.html');
  const facet = page.locator('[data-omnitron-mark="loading"] [data-facet]').first();
  await expect(facet).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => facet.evaluate(element => getComputedStyle(element).animationName)).not.toBe('none');
  await expect(facet).toHaveCSS('animation-play-state', 'running');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(facet).toHaveCSS('animation-play-state', 'paused');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(facet).toHaveCSS('animation-play-state', 'running');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(facet).toHaveCSS('animation-play-state', 'paused');
  for (const state of ['idle', 'success', 'error']) {
    await expect(page.locator('[data-omnitron-mark="' + state + '"] [data-facet]').first()).toHaveCSS('animation-name', 'none');
  }
});
