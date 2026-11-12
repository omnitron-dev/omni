import type { SidebarDocItem } from '../types.js';
import { basename } from 'node:path';
import { parseSafeFrontmatter } from '../utils/safe-matter.js';
import { documentationText, inventoryDocumentation, isDocumentationFile } from '../utils/documentation-files.js';

export function autogenerateSidebarForDir(dirPath: string): SidebarDocItem[] {
  const entries = inventoryDocumentation(dirPath)
    .files.filter((file) => isDocumentationFile(file.relativePath))
    .map((file) => {
      const parsed = parseSafeFrontmatter(documentationText(file));
      return {
        id: file.relativePath
          .split('\\')
          .join('/')
          .replace(/\.(md|mdx|pdx)$/i, ''),
        position: typeof parsed.data['sidebar_position'] === 'number' ? parsed.data['sidebar_position'] : 999,
        title:
          typeof parsed.data['title'] === 'string' && parsed.data['title'] ? parsed.data['title'] : basename(file.path),
      };
    });
  entries.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  return entries.map((entry) => ({ type: 'doc', id: entry.id, label: entry.title }));
}
