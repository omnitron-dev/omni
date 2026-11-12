import { expect } from '@playwright/test';
import { createBrowserTest } from './browser-fixture.js';

const test = createBrowserTest('diagrams.html');

async function imageSvg(image) {
  return image.evaluate(element => {
    const source = decodeURIComponent(element.src.slice(element.src.indexOf(',') + 1));
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
    return {
      source, text: svg.documentElement.textContent,
      activeElements: svg.querySelectorAll('script,iframe,img,image,a,object,embed,input,form').length,
      eventAttributes: [...svg.querySelectorAll('*')].flatMap(node => node.getAttributeNames().filter(name => /^on/i.test(name))),
      labels: [...svg.querySelectorAll('foreignObject')].map(label => ({
        width: Number.parseFloat(label.getAttribute('width')), height: Number.parseFloat(label.getAttribute('height')),
        text: label.textContent, namespaces: [...label.querySelectorAll('*')].map(child => child.namespaceURI),
        whiteSpace: label.querySelector('div')?.style.getPropertyValue('white-space'),
      })),
    };
  });
}

test('Prism SVG images draw measured entity labels and text formatting in both themes', async ({ page, url }) => {
  await page.goto(url + '?consumer=prism&example=entities');
  const image = page.locator('.prism-research__diagram-image');
  for (const mode of ['light', 'dark']) {
    await expect(image).toBeVisible();
    await image.evaluate(element => element.decode());
    await expect(image).toHaveAttribute('alt', /A "quoted" contract.*x < y & y > 0/);
    const svg = await imageSvg(image);
    expect(svg.labels.length).toBeGreaterThanOrEqual(2);
    for (const label of svg.labels) {
      expect(label.width).toBeGreaterThan(20); expect(label.height).toBeGreaterThan(10);
      expect(label.namespaces.every(namespace => namespace === 'http://www.w3.org/1999/xhtml')).toBe(true);
      expect(['nowrap', 'break-spaces']).toContain(label.whiteSpace);
    }
    expect(await image.evaluate(element => element.naturalWidth)).toBeGreaterThan(100);
    const visible = await image.screenshot({ path: test.info().outputPath(`prism-labels-${mode}.png`), animations: 'disabled' });
    // A real image-rendering oracle: remove text only, retaining every measured
    // viewport, wrapper and node. A blank foreignObject implementation would
    // produce identical screenshots despite correct source/alt attributes.
    const original = await image.getAttribute('src');
    await image.evaluate(element => {
      const svg = new DOMParser().parseFromString(decodeURIComponent(element.src.slice(element.src.indexOf(',') + 1)), 'image/svg+xml');
      for (const label of svg.querySelectorAll('foreignObject')) {
        const walker = svg.createTreeWalker(label, NodeFilter.SHOW_TEXT);
        const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) node.textContent = '';
      }
      element.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      return element.decode();
    });
    const blank = await image.screenshot({ animations: 'disabled' });
    const changedPixels = await page.evaluate(async pictures => {
      const pixels = [];
      for (const base64 of pictures) {
        const picture = new Image(); picture.src = 'data:image/png;base64,' + base64; await picture.decode();
        const canvas = document.createElement('canvas'); canvas.width = picture.width; canvas.height = picture.height;
        const context = canvas.getContext('2d'); context.drawImage(picture, 0, 0);
        pixels.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
      }
      if (pixels[0].length !== pixels[1].length) throw new Error('Image geometry changed');
      let count = 0;
      for (let i = 0; i < pixels[0].length; i += 4) if (pixels[0].slice(i, i + 4).some((value, j) => value !== pixels[1][i + j])) count++;
      return count;
    }, [visible.toString('base64'), blank.toString('base64')]);
    expect(changedPixels).toBeGreaterThan(100);
    await image.evaluate((element, source) => { element.src = source; }, original);
    await page.getByRole('button', { name: 'Change theme' }).click();
    await expect(image).not.toHaveAttribute('src', original);
  }
  await page.goto(url + '?consumer=prism&example=formatting');
  await expect(image).toBeVisible();
  const formatted = await imageSvg(image);
  expect(formatted.source).toContain('<strong>bold</strong>');
  expect(formatted.source).toContain('<em>Formatted</em>');
  expect(formatted.labels.some(label => label.height >= 40)).toBe(true);
  await image.screenshot({ path: test.info().outputPath('prism-formatting.png'), animations: 'disabled' });
});

test('Prism image labels cannot request resources, act on clicks or style the host', async ({ page, url }) => {
  let dialogs = 0; let canary = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
  await page.route('**/canary', route => { canary++; return route.fulfill({ body: 'private' }); });
  await page.goto(url + '?consumer=prism&example=labelAttack');
  const image = page.locator('.prism-research__diagram-image');
  await expect(image).toBeVisible(); await image.evaluate(element => element.decode()); await image.click();
  const svg = await imageSvg(image);
  expect(svg.activeElements).toBe(0);
  expect(svg.eventAttributes).toEqual([]);
  expect(svg.source).not.toMatch(/position:\s*fixed|url\(\/canary/);
  expect(svg.labels.map(label => label.text).join(' ')).toContain('Safe text');
  expect(svg.labels.map(label => label.text).join(' ')).toContain('<img src=/canary onerror=alert(2)>Encoded');
  expect(await page.locator('.prism-research').locator('svg,foreignObject').count()).toBe(0);
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  expect(dialogs).toBe(0); expect(canary).toBe(0); expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Change theme' }).click();
  await expect(image).not.toHaveAttribute('src', 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.source));
  await image.evaluate(element => element.decode());
  expect(canary).toBe(0); expect(dialogs).toBe(0);
});

test('Prism preserves sequence, class and state labels in isolated images in both themes', async ({ page, url }) => {
  const image = page.locator('.prism-research__diagram-image');
  for (const [example, labels] of Object.entries({
    sequence: ['authenticated', 'denied', 'retry', 'Complete contract'],
    classes: ['Document', 'Revision', 'title', 'save()', 'history'],
    states: ['Pending', 'Running', 'Finished', 'Failed', 'accepted', 'complete'],
  })) {
    await page.goto(url + '?consumer=prism&example=' + example);
    for (const mode of ['light', 'dark']) {
      await expect(image).toBeVisible(); await image.evaluate(element => element.decode());
      const svg = await imageSvg(image);
      for (const label of labels) expect(svg.text).toContain(label);
      if (example === 'classes') {
        for (const name of ['Document', 'Revision']) {
          const title = svg.labels.find(label => label.text === name);
          const width = await page.evaluate(text => {
            const context = document.createElement('canvas').getContext('2d');
            context.font = '700 16px system-ui';
            return context.measureText(text).width;
          }, name);
          expect(title.width).toBeGreaterThanOrEqual(width - 0.5);
        }
      }
      expect(svg.activeElements).toBe(0); expect(svg.eventAttributes).toEqual([]);
      await image.screenshot({ path: test.info().outputPath(`prism-${example}-${mode}.png`), animations: 'disabled' });
      const current = await image.getAttribute('src');
      await page.getByRole('button', { name: 'Change theme' }).click();
      await expect(image).not.toHaveAttribute('src', current);
    }
  }
});

test('document typography cannot change already-measured inline diagram labels', async ({ page, url }) => {
  await page.goto(url + '?example=formatting&documentTypography=1');
  const svg = page.locator('.lumen-diagram-content svg');
  await expect(svg).toBeVisible();
  const code = svg.locator('foreignObject code');
  await expect(code).toHaveText('value');
  const geometry = await code.evaluate(element => {
    const label = element.closest('foreignObject').getBoundingClientRect();
    const text = element.getBoundingClientRect();
    return { label: { left: label.left, right: label.right }, text: { left: text.left, right: text.right }, fontSize: getComputedStyle(element).fontSize };
  });
  expect(geometry.text.left).toBeGreaterThanOrEqual(geometry.label.left - 0.5);
  expect(geometry.text.right).toBeLessThanOrEqual(geometry.label.right + 0.5);
  expect(geometry.fontSize).toBe('16px');
});

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
