/**
 * Test Helper Utilities
 *
 * Common utilities for testing Aether components
 */

/**
 * Extract text content from a component result
 *
 * Components return DOM nodes, but tests often want to check the text content.
 * This utility extracts the text from various node types.
 *
 * @param result - Component result (can be Node, string, number, null, etc.)
 * @returns Text content or the original value
 */
export function getTextContent(result: any): string | number | null {
  if (result === null || result === undefined) {
    return null;
  }

  // If it's already a primitive, return it
  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
    return result;
  }

  // If it's a Text node, return its data
  if (result.nodeType === Node.TEXT_NODE) {
    const text = result.textContent;
    // Try to parse as number if possible
    if (text && !isNaN(Number(text))) {
      return Number(text);
    }
    return text;
  }

  // If it's an Element node, return its textContent
  if (result.nodeType === Node.ELEMENT_NODE) {
    const text = result.textContent;
    // Try to parse as number if possible
    if (text && !isNaN(Number(text))) {
      return Number(text);
    }
    return text;
  }

  // If it's a Node but not Text or Element, try textContent
  if (result instanceof Node) {
    const text = result.textContent;
    if (text && !isNaN(Number(text))) {
      return Number(text);
    }
    return text;
  }

  // Otherwise, return as string
  return String(result);
}

/**
 * Assert that a component result matches expected text
 *
 * @param result - Component result
 * @param expected - Expected text content
 */
export function expectText(result: any, expected: string | number): void {
  const actual = getTextContent(result);
  if (actual !== expected) {
    throw new Error(`Expected "${expected}" but got "${actual}"`);
  }
}
