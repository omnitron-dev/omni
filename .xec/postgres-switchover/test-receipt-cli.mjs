#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipelineShellReceipt } from '../../apps/omnitron/data/operations/pipeline-shell-receipt.js';

const [, , ...args] = process.argv;
const [, , , id] = args;
assert.deepEqual(args, ['--json', 'pipeline', 'status', id, '--shell-receipt']);
const runs = JSON.parse(await readFile(join(dirname(process.argv[1]), 'registered'), 'utf8'));
const run = Object.values(runs).find(record => record.id === id);
process.stdout.write(JSON.stringify({ ok: true, data: pipelineShellReceipt(run) }) + '\n');
