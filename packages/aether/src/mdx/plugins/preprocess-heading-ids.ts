/**
 * Preprocess MDX content to handle custom heading IDs
 *
 * This is a string-based preprocessor that runs BEFORE the markdown parser.
 * It converts the `{#custom-id}` syntax to a format that won't be parsed as MDX expressions.
 *
 * Transforms:
 *   ## My Heading {#custom-id}
 * Into:
 *   ## My Heading <!-- {#custom-id} -->
 *
 * This prevents acorn from trying to parse {#custom-id} as a JavaScript expression.
 * The remark plugin will then extract the ID from the comment.
 */

/**
 * Preprocess markdown to convert {#id} syntax to JSX comments
 */
export function preprocessHeadingIds(content: string): string {
  // Match heading lines with {#id} syntax
  // Pattern: heading markers + text + {#id}
  const headingPattern = /^(#{1,6}\s+.+?)\s+\{#([a-zA-Z0-9-_]+)\}\s*$/gm;

  return content.replace(
    headingPattern,
    (match, headingText, id) =>
      // Convert to JSX comment to avoid MDX expression parsing
      // Use {/* */} syntax which is valid in MDX
      `${headingText} {/* mdx-heading-id: ${id} */}`
  );
}
