import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** tsup's Rollup pass drops module directives, including esbuild banners. */
export function reactClientEntries(isClient) {
  return {
    name: 'react-client-entries',
    async buildEnd({ writtenFiles }) {
      const output = new Set(writtenFiles.map(file => file.name));
      for (const file of output) {
        const extension = path.extname(file);
        if (!['.js', '.cjs', '.mjs'].includes(extension)) continue;
        const relative = path.relative(this.options.outDir, file).split(path.sep).join('/');
        const entry = relative.slice(0, -extension.length);
        if (!Object.hasOwn(this.options.entry, entry) || !isClient(entry)) continue;
        const source = await readFile(file, 'utf8');
        await writeFile(file, '"use client";\n' + source);
        if (output.has(file + '.map')) {
          const map = JSON.parse(await readFile(file + '.map', 'utf8'));
          // The directive adds one unmapped line before the existing code.
          map.mappings = ';' + map.mappings;
          await writeFile(file + '.map', JSON.stringify(map));
        }
      }
    },
  };
}
