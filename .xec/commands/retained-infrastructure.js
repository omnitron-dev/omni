import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { runRetainedReview } from '../retained-infrastructure/review.mjs';
import { runSourceOperation } from '../retained-infrastructure/operation.mjs';

const root = new URL('../retained-infrastructure/', import.meta.url);

export async function buildRetainedBundle(destination) {
  const sources = ['legacy.mjs', 'physical.mjs', 'stage.mjs', 'review.mjs', 'operation.mjs', 'source.mjs'];
  // The old node runs these public files with its own sealed Node, without installing a daemon or shipping a checkout.
  const modules = new Map(await Promise.all(sources.map(async f => [f, await fs.readFile(new URL(f, root), 'utf8')])));
  for (const [output, source] of [['runtime-artifact', 'shared/runtime-artifact'], ['config-payload', 'infrastructure/config-payload']]) {
    const file = '../../apps/omnitron/src/' + source + '.ts';
    modules.set(output + '.mjs', stripTypeScriptTypes(await fs.readFile(new URL(file, root), 'utf8')));
    for (const [name, body] of modules) modules.set(name, body.replaceAll("'" + file + "'", "'./" + output + ".mjs'"));
  }
  await fs.mkdir(destination, { mode: 0o700 });
  const files = {};
  for (const [name, body] of modules) {
    await fs.writeFile(path.join(destination, name), body, { flag: 'wx', mode: 0o444 });
    files[name] = createHash('sha256').update(body).digest('hex');
  }
  const manifest = JSON.stringify({ protocol: 1, files }, null, 2) + '\n';
  await fs.writeFile(path.join(destination, 'FILES.json'), manifest, { flag: 'wx', mode: 0o444 });
  return { manifestSha256: createHash('sha256').update(manifest).digest('hex'), files: Object.keys(files).length };
}

export function command(program) {
  const retained = program.command('retained-infrastructure').description('Review and passively recover a released legacy container allocation');
  retained.command('bundle <new-directory>').description('Produce the independent public source-host Node helper')
    .allowExcessArguments(false).action(async folder => process.stdout.write(JSON.stringify(await buildRetainedBundle(folder)) + '\n'));
  for (const mode of ['review', 'seal', 'create-stopped']) {
    const sub = retained.command(mode + ' <declaration>')
      .requiredOption('--expect <sha>', 'Independent SHA-256 of the complete declared release')
      .requiredOption('--runtime <directory>', 'Installed legacy runtime selected by its complete digest')
      .requiredOption('--runtime-manifest <sha>', 'Accepted SHA-256 of its immutable RUNTIME.json')
      .option('--bindings-fd <number>', 'Inherited private pipe from the authorized binding provider')
      .allowExcessArguments(false);
    if (mode !== 'review') sub.requiredOption('--directory <path>', 'Existing private persistent directory on the original node')
      .option('--public-supplement <file>', 'Bound archive with the separately qualified public startup files');
    if (mode === 'seal') sub.requiredOption('--volume-root <path>', 'Original local Docker volume directory');
    if (mode === 'create-stopped') sub.requiredOption('--seal <sha>', 'Accepted digest of the source-local pre-stop seal')
      .requiredOption('--node-stop <id>', 'Node operation ID from the completed full stop');
    sub.action(async (file, options) => {
      const input = { ...options, declaration: await fs.readFile(file), expected: options.expect,
        runtimeRoot: options.runtime, runtimeManifestSha256: options.runtimeManifest,
        ...(options.bindingsFd === undefined ? {} : { credentialsFd: Number(options.bindingsFd) }) };
      process.stdout.write(JSON.stringify(mode === 'review' ? await runRetainedReview(input) : await runSourceOperation(mode, input)) + '\n');
    });
  }
}
