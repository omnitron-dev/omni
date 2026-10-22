import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.use({ video: 'off' });
const source = 'First statement.\r\n\r\n$$\nx^2+y^2=z^2\n$$\n\nThird statement.\n';
test.beforeEach(async ({ page }) => {
  await page.goto('/test/research');
  await expect(page.getByRole('button', { name: 'Block actions' })).toBeVisible();
});

test('block menu operates on the hovered formula; undo restores the exact original source', async ({ page }) => {
  const blocks = page.locator('[data-research-block]');
  await blocks.nth(1).hover();
  await page.getByRole('button', { name: 'Block actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate block' }).click();
  await expect(blocks).toHaveCount(4);
  await page.getByRole('button', { name: 'Capture source' }).click();
  expect(await page.getByTestId('captured-json').textContent()).toBe(
    JSON.stringify(source.replace('\n\nThird', () => '\n\n$$\nx^2+y^2=z^2\n$$\n\nThird'))
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Capture source' }).click();
  expect(await page.getByTestId('captured-json').textContent()).toBe(JSON.stringify(source));
});

test('native drag reorders blocks once, retains identities, and undo is one complete operation', async ({ page }) => {
  const blocks = page.locator('[data-research-block]');
  const ids = await blocks.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-research-block')));
  await blocks.nth(2).hover();
  await page.getByRole('button', { name: 'Block actions' }).dragTo(blocks.nth(0), { targetPosition: { x: 100, y: 2 } });
  await expect(blocks.nth(0)).toHaveAttribute('data-research-block', ids[2]!);
  expect(await blocks.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-research-block')))).toEqual([
    ids[2],
    ids[0],
    ids[1],
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await blocks.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-research-block')))).toEqual(ids);
  await page.getByRole('button', { name: 'Capture source' }).click();
  expect(await page.getByTestId('captured-json').textContent()).toBe(JSON.stringify(source));
});

test('keyboard movement works without pointer dragging and cannot modify a read-only document', async ({ page }) => {
  const first = page.locator('[data-research-block]').first();
  const id = await first.getAttribute('data-research-block');
  await first.locator('p').click();
  await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
  await expect(page.locator('[data-research-block]').nth(1)).toHaveAttribute('data-research-block', id!);
  await page.getByRole('checkbox', { name: 'Read only' }).check();
  await expect(page.getByRole('button', { name: 'Block actions' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Research document' })).toHaveAttribute('contenteditable', 'false');
});

test('touch-sized controls and scientific rendering work in a narrow dark viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('checkbox', { name: 'Dark theme' }).check();
  await page.getByRole('button', { name: 'Block actions' }).click();
  await page.getByRole('menuitem', { name: 'Move block down' }).click();
  await expect(page.locator('[data-research-block]').nth(1)).toContainText('First statement.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true
  );
  const accessibility = await new AxeBuilder({ page }).include('.prism-science').analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('editor-mobile-dark.png') });
});

test.describe('large-document measurement', () => {
  test('records native typing latency while preserving all 2000 blocks', async ({ page }, testInfo) => {
    await page.goto('/test/research?blocks=2000');
    const blocks = page.locator('[data-research-block]');
    await expect(blocks).toHaveCount(2000);
    await expect(page.locator('.prism-science__gutter')).toHaveCount(1);
    await page.evaluate(() => {
      const measurements: number[] = [];
      Object.assign(window, { researchInputFrames: measurements });
      document.addEventListener(
        'beforeinput',
        (event) => {
          if (!(event.target instanceof Element) || !event.target.closest('.tiptap')) return;
          const start = performance.now();
          requestAnimationFrame(() => measurements.push(performance.now() - start));
        },
        { capture: true }
      );
    });
    await blocks.first().locator('p').click();
    await page.keyboard.press('Home');
    await page.keyboard.type('abcdefghijklmnop', { delay: 30 });
    const samples = () =>
      page.evaluate(() => (window as unknown as { researchInputFrames: number[] }).researchInputFrames);
    await expect.poll(async () => (await samples()).length).toBe(16);
    const values = (await samples()).sort((a, b) => a - b);
    const receipt = {
      profile: 'beforeinput-to-next-animation-frame/1',
      browser: page.context().browser()?.version(),
      blocks: 2000,
      sample_count: values.length,
      p50_ms: values[Math.ceil(values.length * 0.5) - 1],
      p95_ms: values[Math.ceil(values.length * 0.95) - 1],
      max_ms: values.at(-1),
      samples_ms: values,
      limits:
        'Local warm Chromium, synthetic prose, no throttling, 16 keystrokes; not field INP or a comparison against another editor.',
    };
    await testInfo.attach('research-editor-latency', {
      body: JSON.stringify(receipt, null, 2),
      contentType: 'application/json',
    });
    console.log('RESEARCH_EDITOR_LATENCY ' + JSON.stringify(receipt));
    await page.getByRole('button', { name: 'Capture source' }).click();
    const captured = JSON.parse((await page.getByTestId('captured-json').textContent())!);
    expect(captured).toContain('abcdefghijklmnop');
    const original = Array.from(
      { length: 2000 },
      (_, i) => `Statement ${i}: precise source with Unicode Ω and 😀.`
    ).join('\n\n');
    expect(captured.replace('abcdefghijklmnop', '')).toBe(original);
    await expect(blocks).toHaveCount(2000);
  });
});

test('in-place equation typing, immediate snapshot, document undo and read-only handover', async ({ page }) => {
  await page.getByRole('button', { name: 'Equation: x^2+y^2=z^2', exact: true }).click();
  const field = page.locator('math-field');
  await expect(field).toBeVisible();
  await field.press('2');
  await page.getByRole('button', { name: 'Capture source' }).click();
  const changed = JSON.parse((await page.getByTestId('captured-json').textContent())!);
  expect(changed).toContain('x^2+y^2=z^22');
  expect(changed).toContain('First statement.\r\n\r\n');
  await field.press('ControlOrMeta+z');
  await page.getByRole('button', { name: 'Capture source' }).click();
  expect(await page.getByTestId('captured-json').textContent()).toBe(JSON.stringify(source));
  await page.getByRole('checkbox', { name: 'Read only', exact: true }).check();
  await expect(field).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Research document' })).toHaveAttribute('contenteditable', 'false');
});

test('inline navigation does not replace the equation or insert spurious paragraphs', async ({ page }) => {
  await page.getByRole('button', { name: 'Document source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Document source', exact: true }).fill('Before $x^2$ after.');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const paragraph = page.locator('[data-research-block] p');
  await paragraph.click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const field = page.locator('math-field');
  await expect(field).toBeVisible();
  await field.press('2');
  await field.press('3');
  await expect(field).toBeVisible();
  await field.press('Escape');
  await page.keyboard.type(' verified');
  await page.getByRole('button', { name: 'Capture source' }).click();
  expect(await page.getByTestId('captured-json').textContent()).toBe(JSON.stringify('Before $23x^2$ verified after.'));
  await expect(page.locator('[data-research-block]')).toHaveCount(1);
});
