/**
 * Code Component
 *
 * Represents inline code or code blocks.
 *
 * @example
 * ```tsx
 * // Inline code
 * <p>
 *   Use the <Code>useState</Code> hook for state management.
 * </p>
 *
 * // Code block
 * <Code block language="typescript">
 *   {`const greeting = "Hello, World!";
 * console.log(greeting);`}
 * </Code>
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';

export interface CodeProps {
  /**
   * Whether to render as a block (using <pre><code>) or inline (<code>)
   */
  block?: boolean;

  /**
   * Programming language (for syntax highlighting hints)
   */
  language?: string;

  /**
   * Children content (code text)
   */
  children?: any;

  /**
   * Additional HTML attributes
   */
  [key: string]: any;
}

/**
 * Code
 *
 * Represents computer code with semantic HTML.
 *
 * Features:
 * - Inline code with <code> element
 * - Block code with <pre><code> elements
 * - Language attribute for syntax highlighting
 * - Preserves whitespace and formatting in block mode
 * - Accessible to screen readers
 * - Customizable via CSS
 *
 * Use cases:
 * - Inline code snippets in documentation
 * - Code blocks with syntax highlighting
 * - API documentation
 * - Technical articles
 */
export const Code = defineComponent<CodeProps>((props) => () => {
    const { block, language, children, ...restProps } = props;

    if (block) {
      // Block code: <pre><code>
      return jsx('pre', {
        ...restProps,
        'data-code-block': '',
        'data-language': language,
        children: jsx('code', {
          'data-language': language,
          children,
        }),
      });
    }

    // Inline code: <code>
    return jsx('code', {
      ...restProps,
      'data-code': '',
      'data-language': language,
      children,
    });
  });

// Attach display name
Code.displayName = 'Code';
