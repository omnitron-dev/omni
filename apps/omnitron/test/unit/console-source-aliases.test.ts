import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { withPrismSourceAliases } from '../../scripts/console-source-aliases.js';

it('bundles the public UI entry and keeps the root alias off undeclared subpaths and CSS', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'console-aliases-'));
  try {
    const entry = path.join(directory, 'entry.ts');
    await fs.writeFile(entry, "export { Chip, Stack } from '@omnitron-dev/prism/ui';");
    const aliases = withPrismSourceAliases({});
    const { build } = await import(createRequire(new URL('../../webapp/package.json', import.meta.url)).resolve('vite'));
    const result = await build({ configFile: false, logLevel: 'silent', resolve: { alias: aliases },
      build: { write: false, lib: { entry, formats: ['es'] }, rolldownOptions: { external: [/^@mui\//] } } });
    const builds = Array.isArray(result) ? result : [result];
    expect(builds.every(build => 'output' in build)).toBe(true);
    const chunks = builds.flatMap(build => 'output' in build ? build.output : []);
    expect(chunks.some((chunk: { type: string; code?: string }) => chunk.type === 'chunk' && chunk.code?.includes('@mui/material'))).toBe(true);
    for (const specifier of ['@omnitron-dev/prism/ui/private', '@omnitron-dev/prism/components/map/styles.css'])
      expect(aliases.some(alias => alias.find instanceof RegExp && alias.find.test(specifier))).toBe(false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
