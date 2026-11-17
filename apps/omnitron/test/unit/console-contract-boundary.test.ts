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
  const implementation = program.getSourceFiles().map(file => path.relative(source, file.fileName))
    .filter(file => implementationDirectories.some(dir => file.startsWith(dir + path.sep)));
  expect(implementation).toEqual([]);
});
