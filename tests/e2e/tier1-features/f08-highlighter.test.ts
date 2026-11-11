import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';

describe('Feature 8: Build-Time Syntax Highlighting', () => {
  it('TC-F08-01: parses code block with language identifier and raw code', async () => {
    const doc = `---
title: Syntax Highlighting
---

\`\`\`typescript
const greeting: string = "hello lumen";
console.log(greeting);
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/code.pdx');
    expect(ast.rawContent).toContain('```typescript');
    expect(ast.rawContent).toContain('const greeting: string');
  });

  it('TC-F08-02: supports code blocks across multiple common programming languages', async () => {
    const doc = `---
title: Multi-Language
---

\`\`\`rust
fn main() { println!("Hello from Rust"); }
\`\`\`

\`\`\`python
def compute_energy(): return 42
\`\`\`

\`\`\`bash
pnpm test:e2e
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/multilang.pdx');
    expect(ast.rawContent).toContain('```rust');
    expect(ast.rawContent).toContain('```python');
    expect(ast.rawContent).toContain('```bash');
  });

  it('TC-F08-03: recognizes twoslash metadata annotation in code blocks', async () => {
    const doc = `---
title: Twoslash Demo
---

\`\`\`ts twoslash
// @noErrors
const matrix = [[1, 0], [0, 1]];
//    ^?
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/twoslash.pdx');
    expect(ast.rawContent).toContain('```ts twoslash');
    expect(ast.rawContent).toContain('//    ^?');
  });

  it('TC-F08-04: preserves twoslash build-time error annotations', async () => {
    const doc = `---
title: Twoslash Errors
---

\`\`\`ts twoslash
// @errors: 2322
const num: number = "not-a-number";
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/twoslash-error.pdx');
    expect(ast.rawContent).toContain('// @errors: 2322');
  });

  it('TC-F08-05: parses line highlight and diff comments in code blocks', async () => {
    const doc = `---
title: Code Diffs
---

\`\`\`typescript
const a = 1;
// [!code ++]
const b = 2;
// [!code --]
const c = 0;
\`\`\`
`;

    const ast = await parseDocument(doc, 'docs/diffs.pdx');
    const html = toHtmlSsr(ast);
    expect(html).toContain('lumen-doc');
    expect(ast.rawContent).toContain('[!code ++]');
    expect(ast.rawContent).toContain('[!code --]');
  });
});
