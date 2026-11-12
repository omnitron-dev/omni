import { expect } from '@playwright/test';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('diagrams.html');

test('real ELK produces non-overlapping labeled nodes and connected edges', async ({ page, url }) => {
  await page.goto(url);
  const svg = page.locator('.lumen-diagram-content svg');
  await expect(svg).toBeVisible();
  for (const label of ['Parser', 'Valid?', 'Commit', 'Reject']) await expect(svg).toContainText(label);
  const boxes = await svg.locator('.node').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  expect(boxes.length).toBe(4);
  for (const [index, box] of boxes.entries()) {
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    for (const other of boxes.slice(index + 1)) {
      expect(box.x + box.width <= other.x || other.x + other.width <= box.x || box.y + box.height <= other.y || other.y + other.height <= box.y).toBe(true);
    }
  }
  expect(await svg.locator('.edgePath, .flowchart-link').count()).toBeGreaterThanOrEqual(3);
  const light = await svg.innerHTML();
  await page.screenshot({ path: test.info().outputPath('elk-light.png') });
  await page.getByRole('button', { name: 'Change theme' }).click();
  await expect.poll(() => svg.innerHTML()).not.toBe(light);
  await expect(svg).toBeVisible();
  await expect(svg).toContainText('Commit');
  await page.screenshot({ path: test.info().outputPath('elk-dark.png') });
});

test('the official sequence and class engines preserve branches, loops and members', async ({ page, url }) => {
  await page.goto(url + '?example=sequence');
  const svg = page.locator('.lumen-diagram-content svg');
  await expect(svg).toBeVisible();
  for (const label of ['authenticated', 'denied', 'retry', 'Save', 'Denied', 'Complete contract']) await expect(svg).toContainText(label);
  await page.goto(url + '?example=classes');
  await expect(svg).toBeVisible();
  for (const label of ['Document', 'Revision', 'title', 'save()', 'history']) await expect(svg).toContainText(label);
});

test('syntax failure stays visible with source and a later valid diagram recovers', async ({ page, url }) => {
  await page.goto(url + '?example=invalid');
  await expect(page.getByRole('alert')).toContainText('Diagram unavailable');
  await expect(page.locator('details pre')).toBeVisible();
  await expect(page.locator('.lumen-diagram-content svg')).toHaveCount(0);
  await page.getByRole('button', { name: 'Valid diagram' }).click();
  await expect(page.locator('.lumen-diagram-content svg')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('document directives cannot enable script callbacks or page-level CSS', async ({ page, url }) => {
  let dialogs = 0;
  let canary = 0;
  page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
  await page.route('**/canary', route => { canary++; return route.fulfill({ body: 'private' }); });
  await page.goto(url + '?example=unsafe');
  const svg = page.locator('.lumen-diagram-content svg');
  await expect(svg).toBeVisible();
  await svg.getByText('Safe', { exact: true }).click();
  expect(dialogs).toBe(0);
  expect(canary).toBe(0);
  expect(await svg.locator('script,img,foreignObject,a[href^="javascript:"]').count()).toBe(0);
  expect(await page.locator('body').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
});

test('document directives cannot raise the edge budget and failure releases the renderer', async ({ page, url }) => {
  await page.goto(url + '?example=edges');
  await expect(page.getByRole('alert')).toContainText(/edge|limit/i);
  await expect(page.locator('.lumen-diagram-content svg')).toHaveCount(0);
  await page.getByRole('button', { name: 'Valid diagram' }).click();
  await expect(page.locator('.lumen-diagram-content svg')).toBeVisible();
});
