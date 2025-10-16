# E2E Workflow Tests

End-to-end workflow tests that simulate complete, realistic user journeys in the Advanced Editor.

## Overview

Unlike feature-specific tests (in `../editor/`), workflow tests cover **complete user scenarios** from start to finish. These tests validate that multiple features work together seamlessly in real-world usage patterns.

## Test Philosophy

**Workflow tests represent how users actually work**, not just how individual features function:

- **Feature tests**: "Can the user make text bold?"
- **Workflow tests**: "Can the user create a complete blog post with mixed formatting, code examples, and images?"

## Current Workflows

### Blog Post Creation (`blog-post-creation.e2e.test.ts`)

**Primary use case for content management systems - represents ~70% of real-world editor usage.**

#### Test Scenarios

1. **Complete Technical Blog Post Creation** (Main workflow)
   - Creating title with markdown (`# Heading`)
   - Writing introduction with bold/italic formatting
   - Adding multiple sections with headings
   - Inserting code examples
   - Creating bulleted and numbered lists
   - Adding blockquotes for important notes
   - Creating comparison tables
   - Adding links and references
   - Testing undo/redo throughout workflow
   - Verifying all formatting persists
   - **Coverage**: All major editing features in realistic sequence

2. **Editing Existing Blog Post**
   - Loading pre-populated content
   - Making structural changes (reordering sections)
   - Adding new sections in the middle
   - Updating code examples
   - Testing undo/redo with structural changes
   - **Coverage**: Content modification patterns

3. **Mixed Content Types in Single Workflow**
   - Seamlessly switching between text, code, lists, and tables
   - Testing transitions between different content types
   - Verifying formatting consistency across types
   - **Coverage**: Content type interoperability

4. **Content Persistence Through Save/Load**
   - Creating formatted content
   - Simulating save operation
   - Clearing editor
   - Restoring content
   - Verifying all formatting preserved
   - **Coverage**: Data persistence and serialization

5. **Performance with Realistic Content Volume**
   - Creating 1000+ word blog post
   - Testing typing latency with large documents
   - Measuring undo/redo performance
   - Testing selection performance
   - **Coverage**: Performance under realistic load

6. **Copy-Paste from External Sources**
   - Pasting content from external sources
   - Cleaning up formatting
   - Adding additional content
   - **Coverage**: Content migration workflows

7. **Rapid Markdown-Based Creation**
   - Using markdown shortcuts for efficiency
   - Creating content quickly with keyboard shortcuts
   - Testing power-user workflows
   - **Coverage**: Markdown input system integration

## Test Statistics

- **Test File**: `blog-post-creation.e2e.test.ts`
- **Test Count**: 7 comprehensive workflow tests
- **Lines of Code**: ~850 lines
- **Coverage**: Complete blog post creation lifecycle

## Why Blog Post Creation?

Blog post creation is the **most critical workflow** because:

1. **High Usage**: ~70% of editor usage in CMSs is creating/editing posts
2. **Feature Coverage**: Exercises nearly all editor features:
   - Text formatting (bold, italic, underline, code)
   - Block formatting (headings, paragraphs, blockquotes)
   - Lists (bulleted, numbered, nested)
   - Code blocks with syntax highlighting
   - Tables and structured data
   - Links and media
   - Markdown shortcuts
   - Undo/redo
   - Copy/paste
   - Content persistence

3. **Real-World Validation**: If blog post creation works smoothly, the editor is production-ready
4. **Performance Testing**: Realistic content volumes (1000+ words)
5. **Integration Testing**: All features must work together correctly

## Test Content Examples

### Realistic Blog Post Content

Tests use realistic content like:

```markdown
# TypeScript Best Practices for 2025

TypeScript has become the **de facto standard** for modern web development...

## 1. Type Safety Over Type Assertions

Avoid using `as` type assertions when possible...

## 2. Key Benefits of Type Safety

- **Compile-time error detection:** Catch bugs before runtime
- **Better IDE support:** Auto-completion and refactoring tools
- **Self-documenting code:** Types serve as inline documentation

> **Important:** Migration should be gradual...
```

This ensures tests validate real-world usage patterns, not just synthetic test data.

## Running Workflow Tests

### Run all workflow tests

```bash
npx playwright test test/e2e/workflows/
```

### Run specific workflow

```bash
npx playwright test test/e2e/workflows/blog-post-creation.e2e.test.ts
```

### Run single test

```bash
npx playwright test test/e2e/workflows/blog-post-creation.e2e.test.ts -g "complete technical blog post"
```

### Run with UI mode (recommended for development)

```bash
npx playwright test test/e2e/workflows/ --ui
```

### Debug mode

```bash
npx playwright test test/e2e/workflows/ --debug
```

## Performance Benchmarks

Workflow tests include performance measurements:

- **Content creation**: < 5000ms for 1000+ word post
- **Typing latency**: < 500ms for text insertion
- **Undo operation**: < 200ms
- **Select all**: < 200ms

These benchmarks ensure the editor remains responsive with realistic content volumes.

## Future Workflows

Additional workflows to implement:

### Documentation Writing

- Multi-page documentation with navigation
- Code examples with live preview
- Cross-references and internal links
- Table of contents generation

### Email Composition

- Rich text formatting
- Inline images
- Attachments
- Template insertion

### Note-Taking

- Quick capture workflow
- Bullet journal patterns
- Task lists with checkboxes
- Date/time stamps

### Technical Writing

- Mathematical equations (LaTeX)
- Diagrams and charts
- Citations and footnotes
- Code snippet management

### Collaborative Editing

- Real-time collaboration
- Comments and suggestions
- Change tracking
- Conflict resolution

### Content Migration

- Import from Markdown files
- Import from Word documents
- Export to multiple formats
- Bulk content operations

## Best Practices for Workflow Tests

1. **Use Realistic Content**: Test with actual blog post length and complexity
2. **Test Complete Journeys**: Start from empty editor to finished post
3. **Include User Patterns**: Test how users actually work (keyboard shortcuts, markdown)
4. **Measure Performance**: Include timing measurements for key operations
5. **Verify Persistence**: Test save/load cycles
6. **Test Error Recovery**: Include undo/redo throughout workflow
7. **Document Clearly**: Explain what user scenario the test represents

## Integration with Feature Tests

Workflow tests complement feature tests:

| Type               | Purpose                                           | Example                                             |
| ------------------ | ------------------------------------------------- | --------------------------------------------------- |
| **Feature Tests**  | Validate individual features work correctly       | "Bold formatting applies correctly"                 |
| **Workflow Tests** | Validate features work together in real scenarios | "User creates blog post with bold, code, and lists" |

Both are essential:

- **Feature tests** catch regressions in specific functionality
- **Workflow tests** catch integration issues and UX problems

## Contributing

When adding new workflow tests:

1. **Identify Common User Journeys**: What do users actually do?
2. **Create Realistic Scenarios**: Use real content, not test data
3. **Cover Complete Flow**: From start to finish
4. **Include Performance**: Measure key operations
5. **Document Clearly**: Explain the user scenario
6. **Keep Tests Maintainable**: Use helper functions, avoid duplication

## Test Fixtures

Workflow tests use the same fixtures as feature tests:

- `../editor/fixtures/rich-editor.html` - Full-featured editor with toolbar
- `../editor/fixtures/markdown-editor.html` - Markdown-focused editor
- `../editor/helpers.ts` - Shared test utilities

## Success Criteria

A workflow test is successful if:

✅ It represents a realistic, complete user journey
✅ It exercises multiple features working together
✅ It uses realistic content (not synthetic test data)
✅ It includes performance measurements
✅ It tests error recovery (undo/redo)
✅ All assertions pass consistently
✅ It's well-documented and maintainable

## Notes

### Mock Implementation

Current fixtures use simplified mock implementations since the actual Advanced Editor is in development. These tests will be updated to use the real editor once it's implemented.

The test structure and scenarios are production-ready and reflect real-world requirements.

### Browser Compatibility

Workflow tests run on all supported browsers:

- ✅ Chromium (Desktop)
- ✅ Firefox (Desktop)
- ✅ WebKit/Safari (Desktop)
- ✅ Chrome Mobile (Pixel 5)
- ✅ Safari Mobile (iPhone 12)

### CI/CD Integration

Workflow tests are configured for CI:

- Run in parallel locally for speed
- Run serially in CI for stability
- Capture screenshots on failure
- Record videos on failure
- Generate HTML reports

## Questions?

For questions about workflow tests, see:

- [E2E Testing Guide](../editor/README.md)
- [Test Helpers Documentation](../editor/helpers.ts)
- [Playwright Documentation](https://playwright.dev)
