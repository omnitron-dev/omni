import { test, expect, stubInventory } from './fixtures.mjs';

const rows = [
  { id: 'one', actorType: 'user', actorId: 'omnitron-local' },
  { id: 'two', actorType: 'system', actorId: null },
  { id: 'three', actorType: 'service', actorId: 'node-with-a-very-long-recorded-name' },
].map((row) => ({
  ...row,
  action: 'stack.start',
  resourceType: 'stack',
  resourceId: 'original-project-name/local',
  createdAt: '2026-11-02T03:55:01.123Z',
  ipAddress: null,
  details: { outcome: 'partial', notUp: 'collector', trees: [{ app: 'collector', commit: 'a'.repeat(40) }] },
}));

for (const [width, direction] of [
  [320, 'ltr'],
  [768, 'ltr'],
  [908, 'ltr'],
  [1440, 'ltr'],
  [908, 'rtl'],
]) {
  test(`audit reading does not overlap at ${width}px ${direction}`, async ({ page, url }) => {
    await stubInventory(page, { 'OmnitronAudit.available': { available: true }, 'OmnitronAudit.list': rows });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${url}/workspace.html?view=audit&dir=${direction}`);
    const table = page.getByRole('table', { name: 'Audit events' });
    await expect(table).toBeVisible();
    await expect(page.getByText('Control-plane audit · all projects')).toBeVisible();
    for (const name of ['Resource', 'Actor', 'Latest entries'])
      await expect(page.getByRole('combobox', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Action (exact)' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    // The historical locale timestamp overflowed its fixed 110px cell and
    // painted over Event. Check each visible cell's actual rendered contents.
    const cells = await table
      .locator('tbody tr')
      .first()
      .locator('td')
      .evaluateAll((items) =>
        items
          .filter((item) => getComputedStyle(item).display !== 'none')
          .map((item) => ({ visible: item.clientWidth, content: item.scrollWidth }))
      );
    for (const cell of cells) expect(cell.content).toBeLessThanOrEqual(cell.visible + 1);
    const controls = await page
      .getByRole('region', { name: 'Audit filters' })
      .locator('.MuiFormControl-root')
      .evaluateAll((items) =>
        items.map((item) => {
          const box = item.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        })
      );
    for (let a = 0; a < controls.length; a++)
      for (let b = a + 1; b < controls.length; b++) {
        const one = controls[a],
          two = controls[b];
        expect(one.right <= two.left || two.right <= one.left || one.bottom <= two.top || two.bottom <= one.top).toBe(
          true
        );
      }
    const toggle = page.getByRole('button', { name: /Details for stack.start/ }).first();
    await toggle.click();
    const details = page.getByRole('region', { name: 'Audit details: stack.start' });
    await expect(details.getByText('2026-11-02T03:55:01.123Z', { exact: true })).toBeVisible();
    await expect(details.getByText('omnitron-local', { exact: true })).toBeVisible();
    await details.getByRole('button', { name: 'Raw event' }).click();
    await expect(page.getByLabel('Raw audit event')).toContainText('original-project-name/local');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByLabel('Raw audit event').focus();
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    if (width >= 1440) {
      const icon = page.getByRole('link', { name: 'Settings', exact: true }).locator('svg');
      await expect(icon).toBeVisible();
      expect(await icon.locator('path').count()).toBe(3);
      const box = await icon.evaluate((element) => {
        const value = element.getBBox();
        return { x: value.x, y: value.y, right: value.x + value.width, bottom: value.y + value.height };
      });
      expect(box.x).toBeGreaterThanOrEqual(0.75);
      expect(box.y).toBeGreaterThanOrEqual(0.75);
      expect(box.right).toBeLessThanOrEqual(23.25);
      expect(box.bottom).toBeLessThanOrEqual(23.25);
    }
  });
}
