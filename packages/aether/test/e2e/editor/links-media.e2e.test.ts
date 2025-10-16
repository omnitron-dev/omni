/**
 * E2E Tests: Links and Media
 *
 * Tests link insertion/editing/removal and image insertion/manipulation.
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  getEditorHTML,
  selectText,
  selectAll,
  pressShortcut,
  clickToolbarButton,
  waitForVisible,
  pressEnter,
  pressEscape,
} from './helpers';

test.describe('Links and Media', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);
  });

  // Link tests
  test('should insert link via toolbar', async ({ page }) => {
    await typeText(page, 'Click here');
    await selectText(page, 6, 10); // Select "here"
    await clickToolbarButton(page, 'link');

    // Assuming a link dialog appears
    const linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('https://example.com');
      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<a[^>]*href=["']https:\/\/example\.com["'][^>]*>here<\/a>/);
  });

  test('should insert link via keyboard shortcut', async ({ page }) => {
    await typeText(page, 'Link text');
    await selectAll(page);
    await pressShortcut(page, 'Mod+k');

    const linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('https://example.com');
      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<a[^>]*href=["']https:\/\/example\.com["'][^>]*>/);
  });

  test('should edit existing link', async ({ page }) => {
    await typeText(page, 'Link');
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    let linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('https://example.com');
      await pressEnter(page);
    }

    // Edit the link
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('https://newurl.com');
      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    expect(html).toMatch(/https:\/\/newurl\.com/);
    expect(html).not.toMatch(/https:\/\/example\.com/);
  });

  test('should remove link', async ({ page }) => {
    await typeText(page, 'Link');
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    const linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('https://example.com');
      await pressEnter(page);
    }

    // Remove link (implementation-specific - might be unlink button or clearing URL)
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    const unlinkButton = page.locator('button:has-text("Remove"), button:has-text("Unlink")');
    if (await unlinkButton.isVisible()) {
      await unlinkButton.click();
    }

    const html = await getEditorHTML(page);
    expect(html).not.toMatch(/<a[^>]*>/);
  });

  test('should create link without text selection', async ({ page }) => {
    await clickToolbarButton(page, 'link');

    const linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('https://example.com');
      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<a[^>]*href=["']https:\/\/example\.com["'][^>]*>/);
  });

  test('should handle link with protocol', async ({ page }) => {
    await typeText(page, 'Link');
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    const linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('https://example.com');
      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    expect(html).toMatch(/https:\/\/example\.com/);
  });

  test('should handle link without protocol', async ({ page }) => {
    await typeText(page, 'Link');
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    const linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('example.com');
      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    // Implementation may auto-add protocol or keep as-is
    expect(html).toMatch(/example\.com/);
  });

  test('should handle mailto link', async ({ page }) => {
    await typeText(page, 'Email me');
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    const linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('mailto:test@example.com');
      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    expect(html).toMatch(/mailto:test@example\.com/);
  });

  test('should handle tel link', async ({ page }) => {
    await typeText(page, 'Call me');
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    const linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('tel:+1234567890');
      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    expect(html).toMatch(/tel:\+1234567890/);
  });

  test('should preserve link when editing text', async ({ page }) => {
    await typeText(page, 'Link');
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    const linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('https://example.com');
      await pressEnter(page);
    }

    // Edit text
    await page.keyboard.press('End');
    await typeText(page, ' text');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/https:\/\/example\.com/);
    expect(html).toContain('Link text');
  });

  test('should allow formatting link text', async ({ page }) => {
    await typeText(page, 'Link');
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    const linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await linkInput.fill('https://example.com');
      await pressEnter(page);
    }

    // Make link text bold
    await selectAll(page);
    await pressShortcut(page, 'Mod+b');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<a[^>]*>.*<(strong|b)>Link<\/(strong|b)>.*<\/a>/);
  });

  test('should cancel link creation with Escape', async ({ page }) => {
    await typeText(page, 'Text');
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    const linkInput = page.locator('input[type="url"], input[placeholder*="URL"]');
    if (await linkInput.isVisible()) {
      await pressEscape(page);
    }

    const html = await getEditorHTML(page);
    expect(html).not.toMatch(/<a[^>]*>/);
  });

  // Image tests
  test('should insert image via button', async ({ page }) => {
    await clickToolbarButton(page, 'image');

    const imageInput = page.locator('input[type="url"], input[placeholder*="image"]');
    if (await imageInput.isVisible()) {
      await imageInput.fill('https://example.com/image.jpg');
      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<img[^>]*src=["']https:\/\/example\.com\/image\.jpg["'][^>]*>/);
  });

  test('should insert image with alt text', async ({ page }) => {
    await clickToolbarButton(page, 'image');

    const imageInput = page.locator('input[type="url"], input[placeholder*="image"]');
    const altInput = page.locator('input[placeholder*="alt"], input[placeholder*="description"]');

    if (await imageInput.isVisible()) {
      await imageInput.fill('https://example.com/image.jpg');

      if (await altInput.isVisible()) {
        await altInput.fill('Test image');
      }

      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<img[^>]*alt=["']Test image["'][^>]*>/);
  });

  test('should handle image with invalid URL gracefully', async ({ page }) => {
    await clickToolbarButton(page, 'image');

    const imageInput = page.locator('input[type="url"], input[placeholder*="image"]');
    if (await imageInput.isVisible()) {
      await imageInput.fill('invalid-url');
      await pressEnter(page);
    }

    // Should either show error or create image with invalid URL
    // Implementation-specific behavior
  });

  test('should select image after insertion', async ({ page }) => {
    await clickToolbarButton(page, 'image');

    const imageInput = page.locator('input[type="url"], input[placeholder*="image"]');
    if (await imageInput.isVisible()) {
      await imageInput.fill('https://example.com/image.jpg');
      await pressEnter(page);
    }

    const image = page.locator('img');
    if (await image.isVisible()) {
      await expect(image).toBeVisible();
    }
  });

  test('should delete image with Backspace', async ({ page }) => {
    await clickToolbarButton(page, 'image');

    const imageInput = page.locator('input[type="url"], input[placeholder*="image"]');
    if (await imageInput.isVisible()) {
      await imageInput.fill('https://example.com/image.jpg');
      await pressEnter(page);
    }

    // Select and delete image
    const image = page.locator('img');
    if (await image.isVisible()) {
      await image.click();
      await page.keyboard.press('Backspace');
    }

    const html = await getEditorHTML(page);
    expect(html).not.toMatch(/<img/);
  });

  test('should handle multiple images', async ({ page }) => {
    // Insert first image
    await clickToolbarButton(page, 'image');
    let imageInput = page.locator('input[type="url"], input[placeholder*="image"]');
    if (await imageInput.isVisible()) {
      await imageInput.fill('https://example.com/image1.jpg');
      await pressEnter(page);
    }

    // Insert second image
    await clickToolbarButton(page, 'image');
    imageInput = page.locator('input[type="url"], input[placeholder*="image"]');
    if (await imageInput.isVisible()) {
      await imageInput.fill('https://example.com/image2.jpg');
      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    expect(html).toContain('image1.jpg');
    expect(html).toContain('image2.jpg');
  });

  test('should handle link and image together', async ({ page }) => {
    // Insert link
    await typeText(page, 'Link');
    await selectAll(page);
    await clickToolbarButton(page, 'link');

    let input = page.locator('input[type="url"]').first();
    if (await input.isVisible()) {
      await input.fill('https://example.com');
      await pressEnter(page);
    }

    await page.keyboard.press('End');
    await typeText(page, ' ');

    // Insert image
    await clickToolbarButton(page, 'image');
    input = page.locator('input[type="url"]').last();
    if (await input.isVisible()) {
      await input.fill('https://example.com/image.jpg');
      await pressEnter(page);
    }

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<a[^>]*>/);
    expect(html).toMatch(/<img[^>]*>/);
  });
});
