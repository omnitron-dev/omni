import { expect } from '@playwright/test';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('diagrams.html');

test('the ordinary diagram-only site build ships its bootstrap, renderer and Pagefind WASM', async ({ page, siteUrl }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(siteUrl);
  const svg = page.locator('.lumen-diagram-content svg');
  await expect(svg).toBeVisible();
  await expect(svg).toContainText('Archive input');
  await expect(svg).toContainText('Archive output');
  const results = await page.evaluate(async () => {
    const pagefind = await import('/pagefind/pagefind.js');
    const reply = await pagefind.search('ArchiveSearchToken');
    return Promise.all(reply.results.map(async result => (await result.data()).url));
  });
  expect(results).toEqual(['/docs']);
  expect(errors).toEqual([]);
});

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

test('the official sequence, class and state engines preserve their contracts in both themes', async ({ page, url }) => {
  const svg = page.locator('.lumen-diagram-content svg');
  for (const [example, labels] of Object.entries({
    sequence: ['authenticated', 'denied', 'retry', 'Save', 'Denied', 'Complete contract'],
    classes: ['Document', 'Revision', 'title', 'save()', 'history'],
    states: ['Pending', 'Running', 'Finished', 'Failed', 'accepted', 'complete'],
  })) {
    await page.goto(url + '?example=' + example);
    await expect(svg).toBeVisible();
    for (const label of labels) await expect(svg).toContainText(label);
    const light = await svg.innerHTML();
    await page.getByRole('button', { name: 'Change theme' }).click();
    await expect.poll(() => svg.innerHTML()).not.toBe(light);
    for (const label of labels) await expect(svg).toContainText(label);
  }
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

test('quoted labels and Mermaid entity codes survive SSR props without HTML unescaping', async ({ page, url }) => {
  await page.goto(url + '?example=entities');
  const svg = page.locator('.lumen-diagram-content svg');
  await expect(svg).toBeVisible();
  await expect(svg).toContainText('Infrastructure (Docker / bare-metal)');
  await expect(svg).toContainText('A "quoted" contract');
  await expect(svg).toContainText('x < y & y > 0');
  const light = await svg.innerHTML();
  await page.getByRole('button', { name: 'Change theme' }).click();
  await expect.poll(() => svg.innerHTML()).not.toBe(light);
  await expect(svg).toContainText('A "quoted" contract');
  await expect(svg).toContainText('x < y & y > 0');
  const source = await page.locator('[data-component="MermaidDiagram"]').evaluate(element => JSON.parse(element.getAttribute('data-props')).code);
  expect(source).toContain('#quot;');
  expect(source).toContain('#60;');
  await expect(page.locator('details pre code')).toHaveText(source);
  expect(await svg.locator('script,img,image,a').count()).toBe(0);
  expect(await svg.locator('foreignObject').count()).toBeGreaterThan(0);
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
  expect(await svg.locator('script,img,image,iframe,object,embed,input,form,foreignObject a').count()).toBe(0);
  // Mermaid can retain an inert SVG anchor around a rejected click directive.
  expect(await svg.locator('a').evaluateAll(elements => elements.map(element => [
    element.getAttribute('href'), element.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
  ]))).toEqual([[null, null]]);
  const labels = await svg.locator('foreignObject').evaluateAll(elements => elements.map(element => ({
    tags: Array.from(element.querySelectorAll('*'), child => child.localName),
    eventAttributes: Array.from(element.querySelectorAll('*')).flatMap(child => child.getAttributeNames().filter(name => name.startsWith('on'))),
  })));
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(label.tags.every(tag => ['div', 'span', 'p', 'br', 'b', 'i', 'em', 'strong', 'code', 'del', 's', 'sub', 'sup'].includes(tag))).toBe(true);
    expect(label.eventAttributes).toEqual([]);
  }
  expect(await page.locator('body').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
});

test('document directives cannot raise the edge budget and failure releases the renderer', async ({ page, url }) => {
  await page.goto(url + '?example=edges');
  await expect(page.getByRole('alert')).toContainText(/edge|limit/i);
  await expect(page.locator('.lumen-diagram-content svg')).toHaveCount(0);
  await page.getByRole('button', { name: 'Valid diagram' }).click();
  await expect(page.locator('.lumen-diagram-content svg')).toBeVisible();
});
