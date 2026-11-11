/**
 * Normalizes relative markdown links from Docusaurus format (.md/.mdx)
 * to clean route links, preserving custom heading anchors and HTML anchors.
 */
export function resolveLinks(content: string): string {
  // Replace links like [Text](./guide/installation.md#quick-start) -> [Text](./guide/installation#quick-start)
  // or [Text](guide/installation.md) -> [Text](guide/installation)
  const linkRegex = /\[([^\]]+)\]\(([^)]+?)\.(?:md|mdx)(#[^)]+)?\)/g;

  return content.replace(linkRegex, (_match, label, path, hash) => {
    const anchor = hash ?? '';
    return `[${label}](${path}${anchor})`;
  });
}
