### Code

Semantic component for displaying inline code snippets and code blocks.

#### Features

- Inline code with `<code>` element
- Block code with `<pre><code>` elements
- Language attribute for syntax highlighting integration
- Preserves whitespace and formatting in block mode
- Accessible to screen readers
- Customizable via CSS
- Data attributes for styling hooks

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Code } from 'aether/primitives';

// Inline code
export const InlineCodeExample = defineComponent(() => {
  return () => (
    <p>
      Use the <Code>useState</Code> hook for state management in your components.
      The <Code>useEffect</Code> hook handles side effects.
    </p>
  );
});

// Code block
export const CodeBlockExample = defineComponent(() => {
  return () => (
    <Code block language="typescript">
      {`const greeting = "Hello, World!";
console.log(greeting);`}
    </Code>
  );
});
```

#### With Syntax Highlighting

```typescript
// Inline code with language hint
export const InlineWithLanguage = defineComponent(() => {
  return () => (
    <p>
      The function <Code language="javascript">Array.map()</Code> transforms
      each element in an array.
    </p>
  );
});

// Code block with language for highlighting
export const HighlightedBlock = defineComponent(() => {
  return () => (
    <Code block language="typescript">
      {`interface User {
  id: string;
  name: string;
  email: string;
}

const createUser = (data: Partial<User>): User => {
  return {
    id: generateId(),
    ...data
  } as User;
};`}
    </Code>
  );
});
```

#### Multiple Language Examples

```typescript
export const MultiLanguageExamples = defineComponent(() => {
  return () => (
    <div class="code-examples">
      <div class="example">
        <h3>JavaScript</h3>
        <Code block language="javascript">
          {`const sum = (a, b) => a + b;
console.log(sum(2, 3));`}
        </Code>
      </div>

      <div class="example">
        <h3>Python</h3>
        <Code block language="python">
          {`def sum(a, b):
    return a + b

print(sum(2, 3))`}
        </Code>
      </div>

      <div class="example">
        <h3>Rust</h3>
        <Code block language="rust">
          {`fn sum(a: i32, b: i32) -> i32 {
    a + b
}

fn main() {
    println!("{}", sum(2, 3));
}`}
        </Code>
      </div>
    </div>
  );
});
```

#### Documentation Use Case

```typescript
export const APIDocumentation = defineComponent(() => {
  return () => (
    <article class="api-doc">
      <h2>useState Hook</h2>
      <p>
        The <Code>useState</Code> hook returns a signal and a setter function.
      </p>

      <h3>Syntax</h3>
      <Code block language="typescript">
        {`const [count, setCount] = useState(0);`}
      </Code>

      <h3>Parameters</h3>
      <ul>
        <li>
          <Code>initialValue</Code> - The initial state value
        </li>
      </ul>

      <h3>Returns</h3>
      <p>
        An array with two elements: the current state value and a setter function.
      </p>

      <h3>Example</h3>
      <Code block language="typescript">
        {`const Counter = defineComponent(() => {
  const [count, setCount] = useState(0);

  return () => (
    <div>
      <p>Count: {count()}</p>
      <button on:click={() => setCount(count() + 1)}>
        Increment
      </button>
    </div>
  );
});`}
      </Code>
    </article>
  );
});
```

#### Styling Example

```css
/* Inline code */
code[data-code] {
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-background-secondary);
  color: var(--color-code-text);
  border: 1px solid var(--color-border-subtle);
}

/* Code block */
pre[data-code-block] {
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
  font-size: 14px;
  line-height: 1.6;
  padding: 16px;
  border-radius: 8px;
  background: var(--color-background-code);
  border: 1px solid var(--color-border);
  overflow-x: auto;
  margin: 16px 0;
}

pre[data-code-block] > code {
  display: block;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
}

/* Language-specific styling */
code[data-language="typescript"],
code[data-language="javascript"] {
  color: var(--color-js-primary);
}

code[data-language="python"] {
  color: var(--color-python-primary);
}

code[data-language="rust"] {
  color: var(--color-rust-primary);
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  code[data-code] {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.1);
  }

  pre[data-code-block] {
    background: #1e1e1e;
    border-color: rgba(255, 255, 255, 0.1);
  }
}

/* Scrollbar styling for code blocks */
pre[data-code-block]::-webkit-scrollbar {
  height: 8px;
}

pre[data-code-block]::-webkit-scrollbar-track {
  background: transparent;
}

pre[data-code-block]::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 4px;
}

pre[data-code-block]::-webkit-scrollbar-thumb:hover {
  background: var(--color-border-hover);
}
```

#### Integration with Syntax Highlighters

```typescript
// With Prism.js
import Prism from 'prismjs';

export const HighlightedCode = defineComponent<{ code: string; language: string }>((props) => {
  const highlighted = createMemo(() => {
    return Prism.highlight(
      props.code,
      Prism.languages[props.language] || Prism.languages.javascript,
      props.language
    );
  });

  return () => (
    <Code block language={props.language}>
      <span innerHTML={highlighted()} />
    </Code>
  );
});

// With highlight.js
import hljs from 'highlight.js';

export const HljsCode = defineComponent<{ code: string; language: string }>((props) => {
  const highlighted = createMemo(() => {
    return hljs.highlight(props.code, { language: props.language }).value;
  });

  return () => (
    <Code block language={props.language}>
      <span innerHTML={highlighted()} />
    </Code>
  );
});
```

#### Accessibility

The Code component follows semantic HTML standards:

- Uses native `<code>` element for inline code
- Uses `<pre><code>` structure for code blocks
- Preserves formatting for screen readers
- Language information available via data attributes
- Screen readers announce code as "code" or "code block"

Best practices:
- Always provide context around code snippets
- Use language attribute for syntax highlighting libraries
- Ensure sufficient color contrast in styling
- Consider adding copy button for code blocks
- Provide alternative text for complex code examples

#### API Reference

**`<Code>`** - Code component

Props:
- `block?: boolean` - Render as code block (default: false)
- `language?: string` - Programming language hint
- `children?: any` - Code content
- `...HTMLAttributes` - Standard HTML attributes

Data Attributes:
- `data-code` - Present on inline code elements
- `data-code-block` - Present on block code containers
- `data-language` - Language value (when specified)

HTML Output:
```html
<!-- Inline code -->
<code data-code data-language="typescript">useState</code>

<!-- Block code -->
<pre data-code-block data-language="typescript">
  <code data-language="typescript">const x = 1;</code>
</pre>
```

#### Best Practices

1. **Choose the Right Mode**
   - Use inline code for short snippets within text
   - Use block code for multi-line examples

2. **Language Hints**
   - Always specify language for block code
   - Helps syntax highlighters and screen readers
   - Improves code comprehension

3. **Content Formatting**
   - Use template literals for block code
   - Preserve proper indentation
   - Trim leading/trailing whitespace

4. **Accessibility**
   - Provide context before code blocks
   - Use descriptive headings
   - Ensure color contrast meets WCAG standards

5. **Integration**
   - Integrate with syntax highlighting libraries
   - Add copy-to-clipboard functionality
   - Consider line numbers for long blocks

---
