/**
 * Transforms Docusaurus callout syntax into Lumen directive syntax.
 * Docusaurus: :::tip Title or :::tip[Title]
 * Lumen pdx:  :::tip{title="Title"}
 */
export function transformCallouts(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  // Match: :::note Title, :::tip[Title], :::danger "Title"
  const calloutWithTitleRegex = /^([:]{3,})\s*([a-zA-Z0-9_-]+)\s*(?:\[([^\]]+)\]|["']([^"']+)["']|([^{\r\n]+))\s*$/;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if line matches an admonition start with a title
    const match = trimmed.match(calloutWithTitleRegex);
    if (match && match[1] && match[2]) {
      const colons = match[1];
      const type = match[2].toLowerCase();
      const rawTitle = (match[3] || match[4] || match[5] || '').trim();

      // Only transform standard admonition types or if it looks like a directive
      const standardTypes = new Set(['note', 'tip', 'warning', 'danger', 'info', 'caution', 'important']);
      if (standardTypes.has(type) && rawTitle.length > 0 && !rawTitle.startsWith('{')) {
        // Escape quotes inside title
        const escapedTitle = rawTitle.replace(/"/g, '\\"');
        result.push(`${colons}${type}{title="${escapedTitle}"}`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join('\n');
}
