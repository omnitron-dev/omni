import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import matter from 'gray-matter';

export interface CrawledProjectUrls {
  routeUrls: string[];
  anchorUrls: string[];
  allUrls: string[];
}

export function crawlDocumentationDirectory(dirPath: string): CrawledProjectUrls {
  const routeUrls: string[] = [];
  const anchorUrls: string[] = [];

  const docsDir = existsSync(resolve(dirPath, 'docs')) ? resolve(dirPath, 'docs') : dirPath;

  if (!existsSync(docsDir)) {
    return { routeUrls, anchorUrls, allUrls: [] };
  }

  const crawl = (currentDir: string) => {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        crawl(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.md') || entry.name.endsWith('.mdx') || entry.name.endsWith('.pdx'))
      ) {
        try {
          const content = readFileSync(fullPath, 'utf8');
          matter(content);

          let routeId = relative(docsDir, fullPath)
            .replace(/\\/g, '/')
            .replace(/\.(md|mdx|pdx)$/, '');
          if (routeId.endsWith('/index')) {
            routeId = routeId.slice(0, -'/index'.length);
          } else if (routeId === 'index') {
            routeId = '';
          }

          const routeUrl = `/docs/${routeId}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
          routeUrls.push(routeUrl);

          // Extract anchors: {#custom-id}
          const customAnchorRegex = /\{#([a-zA-Z0-9_\u0400-\u04FF-]+)\}/g;
          let m;
          while ((m = customAnchorRegex.exec(content)) !== null) {
            if (m[1]) {
              anchorUrls.push(`${routeUrl}#${m[1]}`);
            }
          }

          // Extract HTML anchors: <a id="...">
          const htmlAnchorRegex = /<a\s+[^>]*id=["']([^"']+)["'][^>]*>/g;
          while ((m = htmlAnchorRegex.exec(content)) !== null) {
            if (m[1]) {
              anchorUrls.push(`${routeUrl}#${m[1]}`);
            }
          }
        } catch {
          // ignore error
        }
      }
    }
  };

  crawl(docsDir);

  return {
    routeUrls,
    anchorUrls,
    allUrls: [...routeUrls, ...anchorUrls],
  };
}
