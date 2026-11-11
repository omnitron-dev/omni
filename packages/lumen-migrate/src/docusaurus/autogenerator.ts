import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
import type { SidebarDocItem } from '../types.js';

export function autogenerateSidebarForDir(dirPath: string): SidebarDocItem[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries: Array<{ id: string; position: number; title: string }> = [];

  const crawl = (currentDir: string) => {
    const items = readdirSync(currentDir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = join(currentDir, item.name);
      if (item.isDirectory()) {
        crawl(fullPath);
      } else if (
        item.isFile() &&
        (item.name.endsWith('.md') || item.name.endsWith('.mdx') || item.name.endsWith('.pdx'))
      ) {
        try {
          const content = readFileSync(fullPath, 'utf8');
          const parsed = matter(content);
          const rel = relative(dirPath, fullPath)
            .replace(/\\/g, '/')
            .replace(/\.(md|mdx|pdx)$/, '');
          const position = typeof parsed.data['sidebar_position'] === 'number' ? parsed.data['sidebar_position'] : 999;
          const title = parsed.data['title'] ?? item.name;

          entries.push({
            id: rel,
            position,
            title,
          });
        } catch {
          // ignore error
        }
      }
    }
  };

  crawl(dirPath);

  // Sort by sidebar_position then by title
  entries.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.title.localeCompare(b.title);
  });

  return entries.map((e) => ({
    type: 'doc',
    id: e.id,
    label: e.title,
  }));
}
