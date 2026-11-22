import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('checks Console contracts without loading CLI, daemon, database or service implementations', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const file = path.join(root, 'webapp/tsconfig.json');
  const config = ts.readConfigFile(file, ts.sys.readFile);
  expect(config.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(file));
  expect(parsed.errors).toEqual([]);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const source = path.join(root, 'src');
  const implementationDirectories = ['commands', 'daemon', 'database', 'services'];
  const infrastructureContracts = new Set([
    'infrastructure/types.ts', 'infrastructure/presets/types.ts',
    'infrastructure/config-payload.ts', 'infrastructure/host-ingress-types.ts',
  ]);
  const implementation = program.getSourceFiles()
    .map(file => path.relative(source, file.fileName).split(path.sep).join('/'))
    .filter(file => implementationDirectories.some(dir => file.startsWith(dir + '/')) ||
      (file.startsWith('infrastructure/') && !infrastructureContracts.has(file)) ||
      file === 'project/remote-placement.ts');
  expect(implementation).toEqual([]);
});
