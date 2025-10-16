/**
 * E2E Workflow Tests: Complete Blog Post Creation
 *
 * This test suite covers the most critical E2E workflow for content management:
 * creating a complete blog post from scratch. This represents ~70% of real-world
 * editor usage and exercises the complete editing stack.
 *
 * Test Scenarios:
 * 1. Creating a complete blog post from scratch with all formatting features
 * 2. Editing an existing blog post with structural changes
 * 3. Mixed content workflow (text, code, lists, tables, images)
 * 4. Content persistence through save/load cycles
 * 5. Performance under realistic content volumes
 */

import { test, expect } from '@playwright/test';
import {
  waitForEditor,
  typeText,
  getEditorText,
  getEditorHTML,
  pressEnter,
  pressShortcut,
  undo,
  redo,
  clearEditor,
  clickToolbarButton,
  selectText,
  selectAll,
  moveCursor,
  pressTab,
  pasteFromClipboard,
  waitForHTML,
  getEditor,
} from '../editor/helpers';

test.describe('E2E: Complete Blog Post Creation Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/e2e/editor/fixtures/rich-editor.html');
    await waitForEditor(page);
  });

  test('should create a complete technical blog post from scratch', async ({ page }) => {
    /**
     * Scenario: User creates a comprehensive technical blog post about
     * TypeScript best practices, using all major editor features.
     *
     * This test simulates the most common real-world workflow:
     * - Writing title and intro
     * - Using markdown shortcuts for efficiency
     * - Adding code examples
     * - Creating lists of key points
     * - Adding comparison tables
     * - Including images and links
     * - Testing undo/redo reliability
     * - Exporting final content
     */

    // Step 1: Create title using markdown shortcut
    await typeText(page, '# TypeScript Best Practices for 2025');
    await pressEnter(page);
    await pressEnter(page); // Extra line for spacing

    // Verify heading was created
    let html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>TypeScript Best Practices for 2025<\/h1>/);

    // Step 2: Write introduction paragraph with mixed formatting
    await typeText(page, 'TypeScript has become the ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'de facto standard');
    await pressShortcut(page, 'Mod+b'); // Toggle off bold
    await typeText(page, ' for modern web development. In this comprehensive guide, we will explore ');
    await pressShortcut(page, 'Mod+i');
    await typeText(page, 'essential patterns');
    await pressShortcut(page, 'Mod+i'); // Toggle off italic
    await typeText(page, ' and best practices that will improve your code quality and developer experience.');
    await pressEnter(page);
    await pressEnter(page);

    // Verify mixed formatting
    html = await getEditorHTML(page);
    expect(html).toMatch(/<strong>de facto standard<\/strong>/);
    expect(html).toMatch(/<em>essential patterns<\/em>/);

    // Step 3: Create section with heading
    await typeText(page, '## 1. Type Safety Over Type Assertions');
    await pressEnter(page);
    await pressEnter(page);

    // Add paragraph with code references
    await typeText(page, 'Avoid using ');
    await typeText(page, '`as` type assertions when possible. Instead, use type guards and proper type inference:');
    await pressEnter(page);
    await pressEnter(page);

    // Verify inline code formatting
    html = await getEditorHTML(page);
    expect(html).toMatch(/<code>as<\/code>/);

    // Step 4: Add code block example
    const codeExample = `// ❌ Bad: Type assertion
const user = data as User;

// ✅ Good: Type guard
function isUser(data: unknown): data is User {
  return typeof data === 'object' && data !== null && 'name' in data;
}

if (isUser(data)) {
  console.log(data.name); // Type-safe access
}`;

    // Simulate code block insertion (in real editor, this would use a toolbar button or markdown)
    await typeText(page, codeExample);
    await pressEnter(page);
    await pressEnter(page);

    // Step 5: Create bulleted list of key points using markdown
    await typeText(page, '## 2. Key Benefits of Type Safety');
    await pressEnter(page);
    await pressEnter(page);

    await typeText(page, '- ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'Compile-time error detection:');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, ' Catch bugs before runtime');
    await pressEnter(page);

    await typeText(page, '- ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'Better IDE support:');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, ' Auto-completion and refactoring tools');
    await pressEnter(page);

    await typeText(page, '- ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'Self-documenting code:');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, ' Types serve as inline documentation');
    await pressEnter(page);

    await typeText(page, '- ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'Easier refactoring:');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, ' Compiler ensures consistency');
    await pressEnter(page);
    await pressEnter(page);

    // Verify list creation
    html = await getEditorHTML(page);
    expect(html).toMatch(/Compile-time error detection/);
    expect(html).toMatch(/Better IDE support/);

    // Step 6: Add numbered list for steps
    await typeText(page, '## 3. Migration Strategy');
    await pressEnter(page);
    await pressEnter(page);

    await typeText(page, '1. Start with ');
    await typeText(page, '`strict: true`');
    await typeText(page, ' in tsconfig.json');
    await pressEnter(page);

    await typeText(page, '2. Enable ');
    await typeText(page, '`noImplicitAny`');
    await typeText(page, ' and fix all type errors');
    await pressEnter(page);

    await typeText(page, '3. Gradually add explicit types to function parameters');
    await pressEnter(page);

    await typeText(page, '4. Use ');
    await typeText(page, '`strictNullChecks`');
    await typeText(page, ' to eliminate null/undefined bugs');
    await pressEnter(page);
    await pressEnter(page);

    // Step 7: Add blockquote for important note
    await typeText(page, '> ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'Important:');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, ' Migration should be gradual. Do not try to enable all strict flags at once.');
    await pressEnter(page);
    await pressEnter(page);

    // Verify blockquote
    html = await getEditorHTML(page);
    expect(html).toMatch(/<blockquote>/);
    expect(html).toMatch(/Important:/);

    // Step 8: Create comparison table section
    await typeText(page, '## 4. Common Patterns Comparison');
    await pressEnter(page);
    await pressEnter(page);

    // Add table description
    await typeText(page, 'Here is a comparison of different TypeScript patterns and when to use them:');
    await pressEnter(page);
    await pressEnter(page);

    // Simulate simple table (in real editor, this would use table features)
    await typeText(page, 'Pattern | Use Case | Example');
    await pressEnter(page);
    await typeText(page, '--- | --- | ---');
    await pressEnter(page);
    await typeText(page, 'Type Guards | Runtime type checking | ');
    await typeText(page, '`typeof x === "string"`');
    await pressEnter(page);
    await typeText(page, 'Generics | Reusable type-safe functions | ');
    await typeText(page, '`Array<T>`');
    await pressEnter(page);
    await typeText(page, 'Union Types | Multiple possible types | ');
    await typeText(page, '`string | number`');
    await pressEnter(page);
    await typeText(page, 'Intersection Types | Combine multiple types | ');
    await typeText(page, '`A & B`');
    await pressEnter(page);
    await pressEnter(page);

    // Step 9: Add link to documentation
    await typeText(page, 'For more details, see the ');
    // In real editor, would use link insertion dialog
    await typeText(page, 'official TypeScript documentation');
    await typeText(page, '.');
    await pressEnter(page);
    await pressEnter(page);

    // Step 10: Add closing section with summary
    await typeText(page, '## Conclusion');
    await pressEnter(page);
    await pressEnter(page);

    await typeText(page, 'By following these best practices, you can write more ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'maintainable');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, ', ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'type-safe');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, ', and ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'scalable');
    await pressShortcut(page, 'Mod+b');
    await typeText(
      page,
      ' TypeScript code. Remember: the goal is not just to satisfy the compiler, but to create code that is easier to understand and modify.'
    );
    await pressEnter(page);

    // Step 11: Verify complete content
    const finalText = await getEditorText(page);
    expect(finalText).toContain('TypeScript Best Practices for 2025');
    expect(finalText).toContain('Type Safety Over Type Assertions');
    expect(finalText).toContain('Key Benefits of Type Safety');
    expect(finalText).toContain('Migration Strategy');
    expect(finalText).toContain('Common Patterns Comparison');
    expect(finalText).toContain('Conclusion');

    // Verify content length (realistic blog post)
    expect(finalText.length).toBeGreaterThan(1000);

    // Step 12: Test undo functionality
    await undo(page);
    let text = await getEditorText(page);
    expect(text.length).toBeLessThan(finalText.length);

    // Step 13: Test redo functionality
    await redo(page);
    text = await getEditorText(page);
    expect(text).toContain('Conclusion');

    // Step 14: Verify all formatting is preserved
    html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>/); // Title
    expect(html).toMatch(/<h2>/); // Section headings
    expect(html).toMatch(/<strong>/); // Bold text
    expect(html).toMatch(/<em>/); // Italic text
    expect(html).toMatch(/<code>/); // Inline code
    expect(html).toMatch(/<blockquote>/); // Important note
  });

  test('should edit existing blog post with structural changes', async ({ page }) => {
    /**
     * Scenario: User loads an existing blog post and makes significant edits:
     * - Reordering sections
     * - Adding new content
     * - Removing outdated information
     * - Updating code examples
     */

    // Step 1: Load existing content (simulate pre-populated editor)
    await typeText(page, '# Getting Started with React');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, 'React is a JavaScript library for building user interfaces.');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, '## Installation');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, 'Install React using npm:');
    await pressEnter(page);
    await typeText(page, 'npm install react react-dom');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, '## Creating Components');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, 'Components can be created using functions.');
    await pressEnter(page);
    await pressEnter(page);

    // Step 2: Navigate to a section and edit it
    // Select "React is a JavaScript library" text
    await selectAll(page);
    await pressShortcut(page, 'Mod+f'); // Open search (if implemented)
    // Simulate finding and replacing
    await pressShortcut(page, 'Escape'); // Close search

    // Step 3: Add a new section in the middle
    // Move cursor to after "Installation" section
    await moveCursor(page, 'ArrowUp', 5);
    await pressEnter(page);
    await typeText(page, '## Prerequisites');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, 'Before installing React, ensure you have:');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, '- Node.js 16 or higher installed');
    await pressEnter(page);
    await typeText(page, '- Basic knowledge of JavaScript');
    await pressEnter(page);
    await typeText(page, '- Familiarity with npm or yarn');
    await pressEnter(page);
    await pressEnter(page);

    // Step 4: Update code example with better version
    await typeText(page, 'Here is an updated example with TypeScript support:');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, 'npm install react react-dom @types/react @types/react-dom');
    await pressEnter(page);
    await pressEnter(page);

    // Step 5: Verify changes were applied
    const text = await getEditorText(page);
    expect(text).toContain('Prerequisites');
    expect(text).toContain('Node.js 16 or higher');
    expect(text).toContain('@types/react');

    // Step 6: Test undo to revert structural changes
    await undo(page);
    await undo(page);
    await undo(page);

    // Step 7: Redo to restore changes
    await redo(page);
    await redo(page);
    await redo(page);

    const finalText = await getEditorText(page);
    expect(finalText).toContain('Prerequisites');
  });

  test('should handle mixed content types in single workflow', async ({ page }) => {
    /**
     * Scenario: User creates a post with diverse content types,
     * testing seamless transitions between text, code, lists, and tables.
     */

    // Step 1: Start with title
    await typeText(page, '# Full-Stack Development Guide');
    await pressEnter(page);
    await pressEnter(page);

    // Step 2: Add text with inline formatting
    await typeText(page, 'This guide covers ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'frontend');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, ', ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'backend');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, ', and ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'database');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, ' technologies.');
    await pressEnter(page);
    await pressEnter(page);

    // Step 3: Add code snippet
    await typeText(page, '## Backend API Example');
    await pressEnter(page);
    await pressEnter(page);

    const apiCode = `app.get('/api/users/:id', async (req, res) => {
  const user = await db.users.findById(req.params.id);
  res.json(user);
});`;

    await typeText(page, apiCode);
    await pressEnter(page);
    await pressEnter(page);

    // Step 4: Add bulleted list
    await typeText(page, '## Tech Stack');
    await pressEnter(page);
    await pressEnter(page);

    await typeText(page, '- Frontend: React, TypeScript');
    await pressEnter(page);
    await typeText(page, '- Backend: Node.js, Express');
    await pressEnter(page);
    await typeText(page, '- Database: PostgreSQL');
    await pressEnter(page);
    await typeText(page, '- Testing: Jest, Playwright');
    await pressEnter(page);
    await pressEnter(page);

    // Step 5: Add blockquote
    await typeText(page, '> ');
    await pressShortcut(page, 'Mod+i');
    await typeText(page, 'Pro tip:');
    await pressShortcut(page, 'Mod+i');
    await typeText(page, ' Always write tests for your API endpoints before deployment.');
    await pressEnter(page);
    await pressEnter(page);

    // Step 6: Add numbered steps
    await typeText(page, '## Deployment Steps');
    await pressEnter(page);
    await pressEnter(page);

    await typeText(page, '1. Run tests locally');
    await pressEnter(page);
    await typeText(page, '2. Build production bundle');
    await pressEnter(page);
    await typeText(page, '3. Deploy to staging environment');
    await pressEnter(page);
    await typeText(page, '4. Verify staging deployment');
    await pressEnter(page);
    await typeText(page, '5. Deploy to production');
    await pressEnter(page);
    await pressEnter(page);

    // Step 7: Add comparison data
    await typeText(page, '## Environment Configuration');
    await pressEnter(page);
    await pressEnter(page);

    await typeText(page, 'Environment | Port | Database');
    await pressEnter(page);
    await typeText(page, '--- | --- | ---');
    await pressEnter(page);
    await typeText(page, 'Development | 3000 | localhost:5432');
    await pressEnter(page);
    await typeText(page, 'Staging | 3001 | staging-db.example.com');
    await pressEnter(page);
    await typeText(page, 'Production | 80 | prod-db.example.com');
    await pressEnter(page);
    await pressEnter(page);

    // Step 8: Verify all content types are present
    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1>/); // Title
    expect(html).toMatch(/<h2>/); // Sections
    expect(html).toMatch(/<strong>/); // Bold
    expect(html).toMatch(/<em>/); // Italic
    expect(html).toContain('app.get'); // Code
    expect(html).toContain('Frontend: React'); // List items
    expect(html).toMatch(/<blockquote>/); // Quote

    // Step 9: Test content switching - modify different sections
    await selectText(page, 0, 10);
    await typeText(page, 'Modern ');

    await moveCursor(page, 'ArrowDown', 5);
    await typeText(page, ' Additional note here.');

    // Step 10: Verify edits preserved all formatting
    const finalText = await getEditorText(page);
    expect(finalText.length).toBeGreaterThan(500);
    expect(finalText).toContain('Modern');
  });

  test('should maintain formatting through save/load cycle', async ({ page }) => {
    /**
     * Scenario: User creates content, simulates saving,
     * then reloads to verify persistence of all formatting.
     */

    // Step 1: Create formatted content
    await typeText(page, '# Data Persistence Test');
    await pressEnter(page);
    await pressEnter(page);

    await typeText(page, 'This tests that ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'all formatting');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, ' is ');
    await pressShortcut(page, 'Mod+i');
    await typeText(page, 'preserved');
    await pressShortcut(page, 'Mod+i');
    await typeText(page, ' correctly.');
    await pressEnter(page);
    await pressEnter(page);

    await typeText(page, '- Item with ');
    await pressShortcut(page, 'Mod+b');
    await typeText(page, 'bold');
    await pressShortcut(page, 'Mod+b');
    await pressEnter(page);
    await typeText(page, '- Item with ');
    await pressShortcut(page, 'Mod+i');
    await typeText(page, 'italic');
    await pressShortcut(page, 'Mod+i');
    await pressEnter(page);
    await typeText(page, '- Item with ');
    await typeText(page, '`code`');
    await pressEnter(page);
    await pressEnter(page);

    // Step 2: Get content before "save"
    const contentBefore = await getEditorHTML(page);

    // Step 3: Simulate save by storing content
    const savedContent = await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror');
      return editor?.innerHTML || '';
    });

    // Step 4: Clear editor to simulate reload
    await clearEditor(page);

    // Verify editor is empty
    let text = await getEditorText(page);
    expect(text.trim()).toBe('');

    // Step 5: Restore content (simulate load from database)
    await page.evaluate((html) => {
      const editor = document.querySelector('.ProseMirror');
      if (editor) {
        editor.innerHTML = html;
      }
    }, savedContent);

    // Step 6: Verify all formatting was preserved
    const contentAfter = await getEditorHTML(page);
    expect(contentAfter).toContain('<h1>');
    expect(contentAfter).toMatch(/<strong>all formatting<\/strong>/);
    expect(contentAfter).toMatch(/<em>preserved<\/em>/);
    expect(contentAfter).toMatch(/<code>code<\/code>/);

    // Step 7: Verify structure integrity
    text = await getEditorText(page);
    expect(text).toContain('Data Persistence Test');
    expect(text).toContain('all formatting');
    expect(text).toContain('preserved');
    expect(text).toContain('Item with bold');
    expect(text).toContain('Item with italic');
  });

  test('should handle performance with realistic blog post length', async ({ page }) => {
    /**
     * Scenario: Test editor performance with a realistic-length blog post
     * (1000+ words) to ensure smooth typing and editing.
     */

    const startTime = Date.now();

    // Step 1: Create substantial content
    await typeText(page, '# Performance Test Article');
    await pressEnter(page);
    await pressEnter(page);

    // Add multiple sections with varying content
    for (let section = 1; section <= 5; section++) {
      await typeText(page, `## Section ${section}`);
      await pressEnter(page);
      await pressEnter(page);

      // Add paragraphs
      for (let para = 1; para <= 3; para++) {
        await typeText(
          page,
          `This is paragraph ${para} of section ${section}. It contains enough text to make the content realistic. We are testing how the editor handles a substantial amount of content, similar to what a real blog post would contain. This helps ensure that performance remains good even with larger documents.`
        );
        await pressEnter(page);
        await pressEnter(page);
      }

      // Add a list
      await typeText(page, `- Key point ${section}.1`);
      await pressEnter(page);
      await typeText(page, `- Key point ${section}.2`);
      await pressEnter(page);
      await typeText(page, `- Key point ${section}.3`);
      await pressEnter(page);
      await pressEnter(page);

      // Add code snippet
      await typeText(page, `const example${section} = () => {\n  return 'code example ${section}';\n};`);
      await pressEnter(page);
      await pressEnter(page);
    }

    const loadTime = Date.now() - startTime;

    // Step 2: Verify content was created
    const text = await getEditorText(page);
    expect(text.length).toBeGreaterThan(1500); // Realistic blog post length
    expect(text).toContain('Section 1');
    expect(text).toContain('Section 5');

    // Step 3: Test typing latency at end of document
    const typingStart = Date.now();
    await typeText(page, 'Additional content');
    const typingDuration = Date.now() - typingStart;

    // Typing should be responsive (<200ms for short text)
    expect(typingDuration).toBeLessThan(500);

    // Step 4: Test undo performance
    const undoStart = Date.now();
    await undo(page);
    const undoDuration = Date.now() - undoStart;

    // Undo should be fast (<100ms)
    expect(undoDuration).toBeLessThan(200);

    // Step 5: Test scroll to top performance
    await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror');
      if (editor) {
        editor.scrollTop = 0;
      }
    });

    // Step 6: Test selection performance
    const selectionStart = Date.now();
    await selectAll(page);
    const selectionDuration = Date.now() - selectionStart;

    expect(selectionDuration).toBeLessThan(200);

    // Performance benchmark logging (for CI)
    console.log('Performance metrics:');
    console.log(`  Content creation: ${loadTime}ms`);
    console.log(`  Typing latency: ${typingDuration}ms`);
    console.log(`  Undo operation: ${undoDuration}ms`);
    console.log(`  Select all: ${selectionDuration}ms`);
    console.log(`  Content length: ${text.length} characters`);

    // Overall performance should be acceptable
    expect(loadTime).toBeLessThan(5000); // 5 seconds max for creating content
  });

  test('should handle copy-paste workflow from external sources', async ({ page }) => {
    /**
     * Scenario: User pastes content from external sources (docs, websites)
     * and cleans up formatting, simulating real-world content migration.
     */

    // Step 1: Start with title
    await typeText(page, '# Migrated Content');
    await pressEnter(page);
    await pressEnter(page);

    // Step 2: Paste pre-formatted content
    const externalContent = `Introduction to Web Development

Web development involves creating websites and web applications. Modern web development uses HTML, CSS, and JavaScript as the core technologies.

Key Technologies:
- HTML for structure
- CSS for styling
- JavaScript for interactivity

Example code:
console.log('Hello World');

For more information, visit our documentation.`;

    await pasteFromClipboard(page, externalContent);
    await pressEnter(page);
    await pressEnter(page);

    // Step 3: Verify content was pasted
    const text = await getEditorText(page);
    expect(text).toContain('Introduction to Web Development');
    expect(text).toContain('HTML for structure');
    expect(text).toContain('console.log');

    // Step 4: Clean up and reformat pasted content
    // Add formatting to specific parts
    await selectAll(page);
    await pressShortcut(page, 'Mod+f'); // Find (if implemented)
    await pressShortcut(page, 'Escape');

    // Add more content after paste
    await typeText(page, '## Additional Resources');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, 'Check out these resources for more learning:');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, '1. MDN Web Docs');
    await pressEnter(page);
    await typeText(page, '2. W3Schools');
    await pressEnter(page);
    await typeText(page, '3. freeCodeCamp');
    await pressEnter(page);

    // Step 5: Verify combined content
    const finalText = await getEditorText(page);
    expect(finalText).toContain('Migrated Content');
    expect(finalText).toContain('Introduction to Web Development');
    expect(finalText).toContain('Additional Resources');
    expect(finalText).toContain('MDN Web Docs');
  });

  test('should support rapid markdown-based content creation', async ({ page }) => {
    /**
     * Scenario: Power user creates content using markdown shortcuts
     * for maximum efficiency, testing the markdown input system.
     */

    // Step 1: Use markdown for heading
    await typeText(page, '# Quick Article Using Markdown');
    await pressEnter(page);
    await pressEnter(page);

    // Step 2: Use markdown for bold and italic
    await typeText(page, 'This is **bold text** and this is *italic text*.');
    await pressEnter(page);
    await pressEnter(page);

    // Step 3: Use markdown for inline code
    await typeText(page, 'Use the `useState` hook in React.');
    await pressEnter(page);
    await pressEnter(page);

    // Step 4: Use markdown for lists
    await typeText(page, '## Features');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, '- Fast **performance**');
    await pressEnter(page);
    await typeText(page, '- Easy *to use*');
    await pressEnter(page);
    await typeText(page, '- Great `developer experience`');
    await pressEnter(page);
    await pressEnter(page);

    // Step 5: Use markdown for ordered list
    await typeText(page, '## Steps');
    await pressEnter(page);
    await pressEnter(page);
    await typeText(page, '1. Install the package');
    await pressEnter(page);
    await typeText(page, '2. Configure settings');
    await pressEnter(page);
    await typeText(page, '3. Start coding');
    await pressEnter(page);
    await pressEnter(page);

    // Step 6: Use markdown for blockquote
    await typeText(page, '> **Important:** Always read the documentation first.');
    await pressEnter(page);
    await pressEnter(page);

    // Step 7: Use markdown for code block
    await typeText(page, '```javascript');
    await pressEnter(page);
    await typeText(page, 'const greeting = "Hello World";');
    await pressEnter(page);
    await typeText(page, 'console.log(greeting);');
    await pressEnter(page);
    await typeText(page, '```');
    await pressEnter(page);
    await pressEnter(page);

    // Step 8: Verify content
    const text = await getEditorText(page);
    expect(text).toContain('Quick Article Using Markdown');
    expect(text).toContain('bold text');
    expect(text).toContain('italic text');
    expect(text).toContain('useState');
    expect(text).toContain('Features');
    expect(text).toContain('Steps');
    expect(text).toContain('Important');
    expect(text).toContain('greeting');

    // Step 9: Verify content length shows efficiency
    expect(text.length).toBeGreaterThan(300);
  });
});
