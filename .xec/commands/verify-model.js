import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReleaseCommandError, releaseCommand } from '@xec-sh/ops/release';

const root = fileURLToPath(new URL('../../', import.meta.url));

function integer(value) {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) throw Error('Expected a nonnegative integer');
  return parsed;
}

async function runProfile(profile, directory, test, values) {
  let stdout, failure;
  try {
    stdout = await releaseCommand(path.join(root, directory), process.execPath,
      [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--disableConsoleIntercept', test], {
        env: { OMNITRON_MODEL_OPTIONS: JSON.stringify(values) }, timeoutMs: 150_000,
      });
  } catch (error) {
    if (!(error instanceof ReleaseCommandError)) throw error;
    stdout = error.stdout;
    failure = error;
  }
  const receipts = [];
  for (const line of stdout.split('\n')) {
    if (!line.trimStart().startsWith('{')) continue;
    try {
      const report = JSON.parse(line);
      if (report.profile === profile && ['matched', 'mismatch', 'inconclusive'].includes(report.verdict)) receipts.push(report);
    } catch { /* Vitest and test dependencies can also write ordinary diagnostic lines. */ }
  }
  if (receipts.length !== 1) throw failure ?? Error('Expected one verification receipt for ' + profile);
  console.log(JSON.stringify(receipts[0]));
  if (failure) throw failure;
  if (receipts[0].verdict !== 'matched') throw Error(profile + ' verification was ' + receipts[0].verdict);
}

export function command(program) {
  const group = program.command('verify-model').description('Compare legitimate operation traces against an independent model');
  for (const [profile, directory, test] of [
    ['pipeline', 'apps/omnitron', 'test/integration/pipeline-admission-model.test.ts'],
    ['msgpack', 'packages/msgpack', 'test/stream-model.test.ts'],
  ]) {
    group.command(profile)
      .description('Verify the ' + profile + ' model or replay one trace')
      .option('--depth <count>', 'Maximum actions per trace', integer)
      .option('--max-traces <count>', 'Maximum complete traces before reporting inconclusive', integer)
      .option('--replay <json>', 'One ordered JSON array of action names', JSON.parse)
      .allowExcessArguments(false)
      .action(values => runProfile(profile, directory, test, values));
  }
}
