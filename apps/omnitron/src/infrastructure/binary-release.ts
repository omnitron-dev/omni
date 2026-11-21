import { readFileSync } from 'node:fs';
import { shellEscape } from '../shared/shell-escape.js';
import type { BareMetalBinaryRelease } from './types.js';

let receiver: string | undefined;

/** Both inventory and installation interpret the same archive declaration on the target. */
export function binaryReleaseCommand(action: 'stage' | 'check', release: BareMetalBinaryRelease): string {
  receiver ??= readFileSync(new URL('../../data/operations/stage-binaries.py', import.meta.url), 'utf8');
  return ['/usr/bin/python3', '-I', '-c', receiver, action, JSON.stringify(release)].map(shellEscape).join(' ');
}
