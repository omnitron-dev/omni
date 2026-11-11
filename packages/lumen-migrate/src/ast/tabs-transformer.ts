/**
 * Removes Docusaurus @theme React imports (Tabs, TabItem, etc.)
 * while preserving the JSX elements for Lumen UI hydration.
 */
export function stripThemeImports(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for imports from @theme or @docusaurus
    if (trimmed.startsWith('import ') && (trimmed.includes('@theme/') || trimmed.includes('@docusaurus/'))) {
      // Omit import line
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}
