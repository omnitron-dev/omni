import type { SidebarDocItem } from '../types.js';

import { join, relative } from 'node:path';
import { statSync, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';

import { parseSafeFrontmatter, inspectPathContainment } from '../utils/safe-matter.js';

export function autogenerateSidebarForDir(dirPath: string): SidebarDocItem[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  let rootRealPath: string;
  try {
    rootRealPath = realpathSync(dirPath);
  } catch {
    return [];
  }

  const visitedDirs = new Set<string>();
  const entries: Array<{ id: string; position: number; title: string }> = [];

  const crawl = (currentDir: string): void => {
    const dirCheck = inspectPathContainment(rootRealPath, currentDir);
    if (dirCheck.escaped || visitedDirs.has(dirCheck.realPath)) {
      return;
    }
    visitedDirs.add(dirCheck.realPath);

    const items = readdirSync(currentDir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = join(currentDir, item.name);
      const check = inspectPathContainment(rootRealPath, fullPath);
      if (check.escaped) {
        continue;
      }

      let isDir = item.isDirectory();
      let isFile = item.isFile();
      if (check.isSymlink) {
        try {
          const targetStat = statSync(check.realPath);
          isDir = targetStat.isDirectory();
          isFile = targetStat.isFile();
        } catch {
          continue;
        }
      }

      if (isDir) {
        crawl(fullPath);
      } else if (isFile && (item.name.endsWith('.md') || item.name.endsWith('.mdx') || item.name.endsWith('.pdx'))) {
        try {
          const content = readFileSync(fullPath, 'utf8');
          const parsed = parseSafeFrontmatter(content);
          const rel = relative(dirPath, fullPath)
            .replace(/\\/g, '/')
            .replace(/\.(md|mdx|pdx)$/, '');
          const position = typeof parsed.data['sidebar_position'] === 'number' ? parsed.data['sidebar_position'] : 999;
          const title =
            typeof parsed.data['title'] === 'string' && parsed.data['title'] ? parsed.data['title'] : item.name;

          entries.push({
            id: rel,
            position,
            title,
          });
        } catch {
          // Ignore corrupted or disabled-engine markdown files during sidebar autogeneration
        }
      }
    }
  };

  crawl(dirPath);

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
