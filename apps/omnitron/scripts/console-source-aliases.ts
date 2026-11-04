import fs from 'node:fs';
import path from 'node:path';

const prism = path.resolve(import.meta.dirname, '../../../packages/prism');
const manifest = JSON.parse(fs.readFileSync(path.join(prism, 'package.json'), 'utf8')) as {
  name: string; exports: Record<string, string | { types?: string }>;
};
const exact = (specifier: string) => new RegExp('^' + specifier.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&') + '$');

/** Production and tests consume the same declared Prism surface. Exact matches
 * keep a root entry from swallowing a subpath or an exported stylesheet. */
export function withPrismSourceAliases(other: Record<string, string>) {
  const aliases: Array<{ find: RegExp | string; replacement: string }> = [];
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    if (typeof entry === 'string' || !entry.types) continue; // Assets use the packaged CSS.
    if (!entry.types.startsWith('./dist/') || !entry.types.endsWith('.d.ts'))
      throw Error('Unsupported Prism declaration entry: ' + subpath);
    const stem = path.resolve(prism, entry.types.replace('./dist/', './src/').replace(/\.d\.ts$/, ''));
    const replacement = [stem + '.ts', stem + '.tsx'].find(file => fs.existsSync(file));
    if (!replacement) throw Error('Missing Prism source entry: ' + subpath);
    aliases.push({ find: exact(subpath === '.' ? manifest.name : manifest.name + subpath.slice(1)), replacement });
  }
  return [...aliases, ...Object.entries(other).map(([find, replacement]) => ({ find, replacement }))];
}
