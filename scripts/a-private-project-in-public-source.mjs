#!/usr/bin/env node
/** Keep public source independent of private integration-project identities. */
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// Code points keep the excluded identifiers out of the public source itself.
const patterns = [
  [100, 97, 111, 115], [112, 114, 105, 99, 101, 118, 101, 114, 115, 101],
  [112, 97, 121, 115, 121, 115], [104, 111, 108, 111, 110], [118, 101, 114, 117, 109],
  [1076, 1072, 1086, 1089],
].map(chars => new RegExp(chars.map(c => String.fromCodePoint(c)).join('[\\s._/-]*'), 'iu'));
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
let checked = 0;
let failures = 0;
for (const file of files) {
  if (file.startsWith('internal/')) continue;
  const full = resolve(root, file);
  let bytes;
  try {
    if (!lstatSync(full).isFile()) continue;
    bytes = readFileSync(full);
  } catch (error) {
    if (error.code === 'ENOENT') continue; // A tracked deletion in the working tree.
    throw error;
  }
  if (bytes.includes(0)) continue;
  checked++;
  const text = bytes.toString('utf8').normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '');
  if (patterns.some(pattern => pattern.test(text))) {
    console.error(`${file}: private project identifier in public source`);
    failures++;
  }
}
if (!checked) throw new Error('No tracked text files scanned');
console.log(`${checked} tracked text files; ${failures} private project references`);
process.exitCode = failures ? 1 : 0;
