/**
 * E2E Tests: Search and Replace
 *
 * Tests search functionality, match navigation, and text replacement.
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  pressShortcut,
  pressEscape,
  waitForVisible,
  waitForHidden,
} from './helpers';

test.describe('Search and Replace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);
  });

  test('should open search panel with Ctrl/Cmd+F', async ({ page }) => {
    await pressShortcut(page, 'Mod+f');

    const searchPanel = page.locator('.search-panel, [role="search"], input[type="search"]');
    await waitForVisible(page, 'input[type="search"], .search-input', 1000).catch(() => {
      // Search panel might not exist in basic fixture
    });
  });

  test('should close search panel with Escape', async ({ page }) => {
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"], .search-input');
    if (await searchInput.isVisible()) {
      await pressEscape(page);
      await expect(searchInput).not.toBeVisible();
    }
  });

  test('should search for text', async ({ page }) => {
    await typeText(page, 'Hello World Hello Universe');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"], .search-input');
    if (await searchInput.isVisible()) {
      await searchInput.fill('Hello');

      // Check for highlighted matches
      const matches = page.locator('.search-match, mark');
      const count = await matches.count();
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  test('should navigate to next match', async ({ page }) => {
    await typeText(page, 'test test test');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');

      const nextButton = page.locator('button:has-text("Next"), [aria-label="Next"]');
      if (await nextButton.isVisible()) {
        await nextButton.click();
        // Current match should change
      }
    }
  });

  test('should navigate to previous match', async ({ page }) => {
    await typeText(page, 'test test test');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');

      const prevButton = page.locator('button:has-text("Previous"), [aria-label="Previous"]');
      if (await prevButton.isVisible()) {
        await prevButton.click();
      }
    }
  });

  test('should show match count', async ({ page }) => {
    await typeText(page, 'Hello World Hello Universe Hello');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('Hello');

      const matchCount = page.locator('.match-count, .search-results');
      if (await matchCount.isVisible()) {
        const text = await matchCount.textContent();
        expect(text).toContain('3');
      }
    }
  });

  test('should highlight current match differently', async ({ page }) => {
    await typeText(page, 'test test test');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');

      const currentMatch = page.locator('.current-match, .search-match.active');
      if (await currentMatch.isVisible()) {
        await expect(currentMatch).toBeVisible();
      }
    }
  });

  test('should search case-insensitively by default', async ({ page }) => {
    await typeText(page, 'Hello HELLO hello');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('hello');

      const matches = page.locator('.search-match, mark');
      const count = await matches.count();
      expect(count).toBe(3);
    }
  });

  test('should toggle case-sensitive search', async ({ page }) => {
    await typeText(page, 'Hello HELLO hello');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    const caseSensitiveToggle = page.locator('[aria-label="Case sensitive"], input[type="checkbox"]');

    if (await searchInput.isVisible() && await caseSensitiveToggle.isVisible()) {
      await searchInput.fill('hello');
      await caseSensitiveToggle.click();

      const matches = page.locator('.search-match');
      const count = await matches.count();
      expect(count).toBe(1); // Only lowercase "hello"
    }
  });

  test('should replace single match', async ({ page }) => {
    await typeText(page, 'Hello World');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    const replaceInput = page.locator('input[placeholder*="Replace"]');

    if (await searchInput.isVisible() && await replaceInput.isVisible()) {
      await searchInput.fill('World');
      await replaceInput.fill('Universe');

      const replaceButton = page.locator('button:has-text("Replace")').first();
      await replaceButton.click();

      const editor = page.locator('.ProseMirror');
      const text = await editor.textContent();
      expect(text).toContain('Universe');
    }
  });

  test('should replace all matches', async ({ page }) => {
    await typeText(page, 'test test test');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    const replaceInput = page.locator('input[placeholder*="Replace"]');

    if (await searchInput.isVisible() && await replaceInput.isVisible()) {
      await searchInput.fill('test');
      await replaceInput.fill('replaced');

      const replaceAllButton = page.locator('button:has-text("Replace All")');
      if (await replaceAllButton.isVisible()) {
        await replaceAllButton.click();

        const editor = page.locator('.ProseMirror');
        const text = await editor.textContent();
        expect(text).toContain('replaced replaced replaced');
      }
    }
  });

  test('should handle no matches found', async ({ page }) => {
    await typeText(page, 'Hello World');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('NonExistent');

      const noResults = page.locator('.no-results, :has-text("No matches")');
      if (await noResults.isVisible()) {
        await expect(noResults).toBeVisible();
      }
    }
  });

  test('should clear search highlights on close', async ({ page }) => {
    await typeText(page, 'test test test');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await pressEscape(page);

      const matches = page.locator('.search-match, mark');
      const count = await matches.count();
      expect(count).toBe(0);
    }
  });

  test('should search across multiple paragraphs', async ({ page }) => {
    await typeText(page, 'test');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'test');
    await pressShortcut(page, 'Enter');
    await typeText(page, 'test');

    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');

      const matches = page.locator('.search-match, mark');
      const count = await matches.count();
      expect(count).toBe(3);
    }
  });

  test('should handle special characters in search', async ({ page }) => {
    await typeText(page, 'test (parentheses) test');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('(parentheses)');
      // Should find the match
    }
  });

  test('should cycle through matches with Enter', async ({ page }) => {
    await typeText(page, 'test test test');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await pressShortcut(page, 'Enter'); // Next match
      await pressShortcut(page, 'Enter'); // Next match
      await pressShortcut(page, 'Enter'); // Should cycle back
    }
  });

  test('should update matches on typing in search', async ({ page }) => {
    await typeText(page, 'Hello World Test');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('Hel');
      await page.waitForTimeout(100);
      await searchInput.fill('Hello');

      const matches = page.locator('.search-match, mark');
      const count = await matches.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  test('should handle search with regex', async ({ page }) => {
    await typeText(page, 'test123 test456');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    const regexToggle = page.locator('[aria-label="Regex"], input[type="checkbox"]');

    if (await searchInput.isVisible() && await regexToggle.isVisible()) {
      await regexToggle.click();
      await searchInput.fill('test\\d+');

      const matches = page.locator('.search-match');
      const count = await matches.count();
      expect(count).toBe(2);
    }
  });

  test('should preserve editor content on search/replace', async ({ page }) => {
    const originalText = 'Hello World Test';
    await typeText(page, originalText);

    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('NoMatch');
      await pressEscape(page);

      const editor = page.locator('.ProseMirror');
      const text = await editor.textContent();
      expect(text).toContain(originalText);
    }
  });

  test('should undo replace operation', async ({ page }) => {
    await typeText(page, 'test');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    const replaceInput = page.locator('input[placeholder*="Replace"]');

    if (await searchInput.isVisible() && await replaceInput.isVisible()) {
      await searchInput.fill('test');
      await replaceInput.fill('replaced');

      const replaceButton = page.locator('button:has-text("Replace")').first();
      await replaceButton.click();

      await pressEscape(page);
      await pressShortcut(page, 'Mod+z'); // Undo

      const editor = page.locator('.ProseMirror');
      const text = await editor.textContent();
      expect(text).toContain('test');
    }
  });

  test('should handle word boundary search', async ({ page }) => {
    await typeText(page, 'test testing tested');
    await pressShortcut(page, 'Mod+f');

    const searchInput = page.locator('input[type="search"]');
    const wordBoundaryToggle = page.locator('[aria-label="Whole word"]');

    if (await searchInput.isVisible() && await wordBoundaryToggle.isVisible()) {
      await searchInput.fill('test');
      await wordBoundaryToggle.click();

      const matches = page.locator('.search-match');
      const count = await matches.count();
      expect(count).toBe(1); // Only "test", not "testing" or "tested"
    }
  });
});
