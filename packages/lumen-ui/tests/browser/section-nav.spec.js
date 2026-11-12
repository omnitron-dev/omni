import { expect } from '@playwright/test';
import { createBrowserTest, importConsumer } from './browser-fixture.js';

const headings = [
  { id: 'first', title: 'First long section', level: 2 },
  { id: 'short', title: 'Short section', level: 3 },
  { id: 'Раздел #2', title: 'Second long section', level: 2 },
  { id: 'penultimate', title: 'Near the end', level: 2 },
  { id: 'last', title: 'Last short section', level: 2 },
];
const test = createBrowserTest('section-nav.html', {
  plugins: [{ name: 'section-nav-ssr', async transformIndexHtml(html) {
    const { default: React } = await importConsumer('react');
    const { renderToStaticMarkup } = await importConsumer('react-dom/server');
    const { PortalIslandHost } = await importConsumer('@omnitron-dev/lumen-ui/runtime');
    const { DocSectionNav } = await importConsumer('@omnitron-dev/lumen-ui/layout');
    return html.replace('<!--ssr-toc-->', renderToStaticMarkup(React.createElement(PortalIslandHost, {
      islandId: 'document-sections', component: 'DocSectionNav', hydrate: 'load', props: { headings },
    }, React.createElement(DocSectionNav, { headings }))));
  } }],
});

test.use({ viewport: { width: 1440, height: 900 } });
const current = page => page.locator('#toc a[aria-current="location"]');
const expectCurrent = async (page, title) => {
  await expect(current(page)).toHaveCount(1);
  await expect(current(page)).toHaveText(title);
};
const scrollHeading = async (page, id, offset = 96) => {
  await page.evaluate(({ id, offset }) => {
    const heading = document.getElementById(id);
    window.scrollTo(0, window.scrollY + heading.getBoundingClientRect().top - offset);
  }, { id, offset });
};

test('tracks long and short sections in both directions and the final short section', async ({ page, url }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await expectCurrent(page, 'First long section');
  await page.evaluate(() => scrollTo(0, 700));
  await expectCurrent(page, 'First long section');
  expect(await page.locator('h3#short').evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThan(96);
  await scrollHeading(page, 'short');
  await expectCurrent(page, 'Short section');
  await scrollHeading(page, 'Раздел #2');
  await expectCurrent(page, 'Second long section');
  await page.evaluate(() => scrollBy(0, 500));
  await expectCurrent(page, 'Second long section');
  await scrollHeading(page, 'short');
  await expectCurrent(page, 'Short section');
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expectCurrent(page, 'Last short section');
  expect(await page.locator('#last').evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThan(96);
  expect(errors).toEqual([]);
});

test('native keyboard anchors preserve offsets, encoded fragments and history with reduced motion', async ({ page, url }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);
  await expectCurrent(page, 'First long section');
  const link = page.locator('#toc a').filter({ hasText: 'Second long section' });
  const previousHistory = await page.evaluate(() => history.length);
  await link.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url + '#' + encodeURIComponent('Раздел #2'));
  await expectCurrent(page, 'Second long section');
  expect(await page.evaluate(() => history.length)).toBe(previousHistory + 1);
  expect(await page.locator('[id="Раздел #2"]').evaluate(element => element.getBoundingClientRect().top)).toBe(96);
  await page.goBack(); await expectCurrent(page, 'First long section');
  await page.goForward(); await expectCurrent(page, 'Second long section');
  await page.locator('#toc a').filter({ hasText: 'First long section' }).click({ modifiers: ['ControlOrMeta'] });
  await expectCurrent(page, 'Second long section');
});

test('initial fragments and clamped anchor clicks select their destination until manual scrolling', async ({ page, url }) => {
  await page.goto(url + '#' + encodeURIComponent('Раздел #2'));
  await expectCurrent(page, 'Second long section');
  await page.locator('#toc a').filter({ hasText: 'Near the end' }).click();
  await expectCurrent(page, 'Near the end');
  await page.locator('#toc a').filter({ hasText: 'Last short section' }).click();
  await expectCurrent(page, 'Last short section');
  await page.locator('#toc a').filter({ hasText: 'Near the end' }).click();
  await expectCurrent(page, 'Near the end');
  await page.mouse.move(500, 500); await page.mouse.wheel(0, 200);
  await expectCurrent(page, 'Last short section');
  await page.reload(); await expectCurrent(page, 'Near the end');
});

test('recalculates after layout changes and DOM replacement without retaining removed headings', async ({ page, url }) => {
  await page.goto(url);
  await scrollHeading(page, 'Раздел #2');
  await expectCurrent(page, 'Second long section');
  await page.evaluate(() => { document.querySelector('section').style.height = '1800px'; });
  // Keep the same viewport position despite browser scroll anchoring.
  await page.evaluate(() => scrollTo(0, 1334));
  await expectCurrent(page, 'First long section');
  await page.evaluate(() => {
    const old = document.getElementById('Раздел #2');
    const replacement = document.createElement('h2'); replacement.id = old.id; replacement.textContent = old.textContent;
    old.replaceWith(replacement);
  });
  await scrollHeading(page, 'Раздел #2');
  await expectCurrent(page, 'Second long section');
  await page.locator('[id="Раздел #2"]').evaluate(element => element.remove());
  await expectCurrent(page, 'Short section');
  await page.evaluate(() => { for (const heading of document.querySelectorAll('main h2, main h3')) heading.remove(); });
  await expect(current(page)).toHaveCount(0);
});

test('Prism uses the same current-section contract in a nested scroll container', async ({ page, url }) => {
  await page.goto(url + '?nested');
  const active = page.locator('#nested-nav a[aria-current="location"]');
  await expect(active).toHaveText('Nested first');
  await page.locator('#nested-root').evaluate(element => { element.scrollTop = 500; });
  await expect(active).toHaveText('Nested first');
  const documentTop = await page.evaluate(() => scrollY);
  await page.locator('#nested-nav a').filter({ hasText: 'Nested last' }).focus();
  await page.keyboard.press('Enter');
  await expect(active).toHaveText('Nested last');
  expect(await page.evaluate(() => scrollY)).toBe(documentTop);
  await page.locator('#nested-root').evaluate(element => { element.scrollTop = 0; });
  await expect(active).toHaveText('Nested first');
});

test('server-rendered native anchors remain usable when JavaScript is disabled', async ({ browser, url }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage(); await page.goto(url);
    await expect(page.locator('#toc a')).toHaveCount(headings.length);
    await expect(current(page)).toHaveCount(0);
    await page.locator('#toc a').filter({ hasText: 'Second long section' }).click();
    await expect(page).toHaveURL(url + '#' + encodeURIComponent('Раздел #2'));
    expect(await page.locator('[id="Раздел #2"]').evaluate(element => element.getBoundingClientRect().top)).toBe(96);
  } finally { await context.close(); }
});
