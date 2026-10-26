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
  [1076, 1072, 1086, 1089], [111, 122, 97, 114], [115, 121, 110, 97, 114, 99],
].map(chars => new RegExp(chars.map(c => String.fromCodePoint(c)).join('[\\s._/\\\\-]*'), 'iu'));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const lookalikes = new Map([[1076,100],[1281,100],[1072,97],[1086,111],[1109,115],[1089,115]].map(([from,to]) => [String.fromCodePoint(from), String.fromCodePoint(to)]));
const normalize = value => [...value.normalize('NFKC').toLowerCase()].map(c => lookalikes.get(c) ?? c).join('').replace(/[\u200b-\u200d\ufeff]/g, '');
const containsPrivateName = value => patterns.some(pattern => pattern.test(normalize(value)));
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
  if (containsPrivateName(file)) {
    console.error(`${file}: private project identifier in path`);
    failures++;
  }
  if (bytes.includes(0)) continue;
  checked++;
  const text = bytes.toString('utf8').normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '');
  if (containsPrivateName(text)) {
    console.error(`${file}: private project identifier in public source`);
    failures++;
  }
}
if (!checked) throw new Error('No tracked text files scanned');
const history = execFileSync('git', ['log', 'HEAD', '--tags', '--format=%H%x00%B%x00'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0');
let commits = 0;
for (let i = 0; i + 1 < history.length; i += 2) {
  commits++;
  if (containsPrivateName(history[i + 1])) {
    console.error(`${history[i].trim()}: private project identifier in commit message`);
    failures++;
  }
}
const tags = execFileSync('git', ['for-each-ref', '--format=%(refname)%00%(contents)%00', 'refs/tags'], { cwd: root, encoding: 'utf8' }).split('\0');
for (let i = 0; i + 1 < tags.length; i += 2) {
  if (containsPrivateName(tags[i]) || containsPrivateName(tags[i + 1])) {
    console.error(`${tags[i].trim()}: private project identifier in tag`);
    failures++;
  }
}
console.log(`${checked} public text files; ${commits} commit messages; ${failures} private project references`);
process.exitCode = failures ? 1 : 0;
