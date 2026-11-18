import { expect, test, type Locator } from '@playwright/test';

async function expectVisibleInScroller(tab: Locator, vertical = false) {
  await expect
    .poll(() =>
      tab.evaluate((element, isVertical) => {
        const tab = element.getBoundingClientRect();
        const port = element.closest('.MuiTabs-scroller')!.getBoundingClientRect();
        return isVertical
          ? tab.top >= port.top - 1 && tab.bottom <= port.bottom + 1
          : tab.left >= port.left - 1 && tab.right <= port.right + 1;
      }, vertical)
    )
    .toBe(true);
}

// Wait past the configured 300 ms transition: native focus can make a tab
// visible immediately while an obsolete animation still owns later frames.
async function finishAnimation(tab: Locator) {
  await tab.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const until = performance.now() + 400;
        const frame = () => (performance.now() >= until ? resolve() : requestAnimationFrame(frame));
        requestAnimationFrame(frame);
      })
  );
}

for (const width of [320, 1024])
  for (const orientation of ['horizontal', 'vertical']) {
    const vertical = orientation === 'vertical';
    test(`rapid End Enter Home Enter keeps selected tab visible: ${orientation}, ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/test/tabs?scroll&orientation=${orientation}`);
      const tabs = page.getByRole('tablist', { name: 'Scrollable workspace sections' });
      const first = tabs.getByRole('tab').first();
      const last = tabs.getByRole('tab').last();
      await first.focus();
      for (let repetition = 0; repetition < 3; repetition++) {
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await expect(last).toBeFocused();
        await expect(last).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('Home');
        await page.keyboard.press('Enter');
        await expect(first).toBeFocused();
        await expect(first).toHaveAttribute('aria-selected', 'true');
        await finishAnimation(first);
        await expectVisibleInScroller(first, vertical);
      }
      await page.screenshot({ path: info.outputPath('tabs-reversal.png') });
    });

    test(`ordinary keyboard reaches every tab: ${orientation}, ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/test/tabs?scroll&orientation=${orientation}`);
      const tabs = page.getByRole('tablist', { name: 'Scrollable workspace sections' });
      await tabs.getByRole('tab').first().focus();
      for (let index = 1; index < 5; index++) {
        await page.keyboard.press(vertical ? 'ArrowDown' : 'ArrowRight');
        await page.keyboard.press('Enter');
        const selected = tabs.getByRole('tab').nth(index);
        await expect(selected).toBeFocused();
        await expect(selected).toHaveAttribute('aria-selected', 'true');
        await finishAnimation(selected);
        await expectVisibleInScroller(selected, vertical);
      }
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      await finishAnimation(tabs.getByRole('tab').first());
      await expectVisibleInScroller(tabs.getByRole('tab').first(), vertical);
    });
  }

for (const immediate of [false, true]) {
  test(`${immediate ? 'direct reduced-motion scroll' : 'new animated scroll'} cancels the previous destination`, async ({
    page,
  }) => {
    await page.goto('/test/tabs?scroll');
    const tabs = page.getByRole('tablist', { name: 'Scrollable workspace sections' });
    const scroller = page.locator('.MuiTabs-scroller');
    await page.getByRole('button', { name: 'Select last', exact: true }).click();
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await page
      .getByRole('button', { name: immediate ? 'Reduce motion and select first' : 'Select first', exact: true })
      .click();
    const first = tabs.getByRole('tab').first();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await finishAnimation(first);
    await expectVisibleInScroller(first);
  });
}

test('unmount cancels frames that would write to a detached scroller', async ({ page }) => {
  await page.goto('/test/tabs?scroll');
  await page.locator('.MuiTabs-scroller').evaluate((element) => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft')!;
    const observation = { detachedWrites: 0 };
    Object.defineProperty(element, 'scrollLeft', {
      get: () => descriptor.get!.call(element),
      set: (value) => {
        if (!element.isConnected) observation.detachedWrites++;
        descriptor.set!.call(element, value);
      },
    });
    (window as unknown as { scrollObservation: typeof observation }).scrollObservation = observation;
  });
  await page.getByRole('button', { name: 'Select last', exact: true }).click();
  await expect
    .poll(() => page.locator('.MuiTabs-scroller').evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Unmount tabs', exact: true }).click();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await finishAnimation(page.locator('body'));
  expect(
    await page.evaluate(
      () => (window as unknown as { scrollObservation: { detachedWrites: number } }).scrollObservation.detachedWrites
    )
  ).toBe(0);
});
