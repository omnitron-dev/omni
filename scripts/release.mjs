#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isCancel, password, text } from '@xec-sh/kit';
import {
  acquireReleaseLock, assertCleanReleaseTree, assertReleaseHead, commitReleaseVersion,
  createGithubRelease, discoverReleasePackages, ensureReleaseTag, loadPreparedRelease,
  planRelease, prepareReleaseArtifacts, publishPreparedRelease, registryAddress,
  pushReleaseRefs, registryArtifactMatches, releaseCommand, releaseNotes, verifyRemoteReleaseTag,
} from '@xec-sh/ops/release';
import semver from 'semver';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = 'omnitron-dev/omni';
const usage = `node scripts/release.mjs [VERSION] [OPERATION]

  --list      Show all public workspaces in dependency order
  --dry-run   Print the release plan (default)
  --prepare   Commit public versions, build and verify archives, create local tag
  --push      Push the prepared commit and its single annotated tag atomically
  --publish   Publish sealed archives from the exact remotely tagged commit
  --resume    Resume --publish using the same archives
  --github    Create the GitHub release after confirming every package in npm

  --registry URL  Select an HTTPS registry or a loopback test registry

Every operation is separate. Archives and receipts live under .release-artifacts/.`;

async function main() {
  const { values, positionals } = parseArgs({
    options: { registry: { type: 'string' }, ...Object.fromEntries(['help', 'list', 'list-packages', 'dry-run', 'prepare', 'skip-publish',
      'push', 'publish', 'resume', 'github'].map(key => [key, { type: 'boolean' }])) },
    allowPositionals: true,
  });
  if (values.help) { console.log(usage); return; }
  const selected = [
    [values.list || values['list-packages'], 'list'], [values['dry-run'], 'plan'],
    [values.prepare || values['skip-publish'], 'prepare'], [values.push, 'push'],
    [values.publish || values.resume, 'publish'], [values.github, 'github'],
  ].filter(([enabled]) => enabled).map(([, command]) => command);
  if (selected.length > 1 || positionals.length > 1) throw new Error(usage);
  const operation = selected[0] ?? 'plan';
  if (operation === 'list') {
    const packages = await discoverReleasePackages(root);
    for (const pkg of packages) console.log(`${pkg.name}@${pkg.version}  ${pkg.path}`);
    console.log(`${packages.length} public packages`);
    return;
  }

  let version = positionals[0];
  if (!version) {
    const cli = JSON.parse(await readFile(path.join(root, 'apps/omnitron/package.json'), 'utf8'));
    if (operation === 'plan') version = semver.inc(cli.version, 'patch');
    else if (process.stdin.isTTY) {
      const answer = await text({ message: 'Release version', placeholder: semver.inc(cli.version, 'patch') });
      if (isCancel(answer)) return;
      version = answer;
    }
  }
  if (!version || semver.valid(version) !== version) throw new Error('Supply an exact semantic version.\n' + usage);
  const plan = await planRelease(root, version);
  console.log(`${plan.tag} · ${plan.npmTag} · ${plan.packages.length} packages · ${plan.commit}`);
  if (plan.blockers.length) throw new Error(plan.blockers.join('\n'));
  if (operation === 'plan') return;

  const unlock = await acquireReleaseLock(root);
  try {
    await assertCleanReleaseTree(root);
    if (operation === 'prepare') {
      if (await releaseCommand(root, 'git', ['branch', '--show-current']) !== 'main') {
        throw new Error('Prepare from a clean main branch');
      }
      await commitReleaseVersion(root, version);
      const commit = await releaseCommand(root, 'git', ['rev-parse', 'HEAD']);
      const prepared = await prepareReleaseArtifacts(root, version, {
        build: { executable: process.execPath, args: ['scripts/build-release.mjs', root, commit] },
        progress: console.log,
      });
      const notes = await releaseNotes(root, version, repository);
      await writeFile(path.join(root, '.release-artifacts', version, prepared.commit, 'NOTES.md'), notes);
      await ensureReleaseTag(root, version);
      console.log(`Prepared ${prepared.artifacts.length} archives. Review the notes and hashes, then run node scripts/release.mjs ${version} --push.`);
      return;
    }

    const prepared = await loadPreparedRelease(root, version);
    if (!await assertReleaseHead(root, version)) throw new Error('Missing local release tag; finish --prepare first');
    if (operation === 'push') { await pushReleaseRefs(root, version); return; }

    await verifyRemoteReleaseTag(root, version, true);
    const registry = registryAddress(typeof values.registry === 'string' ? values.registry : undefined);
    const scopes = [...new Set(prepared.artifacts.map(pkg => pkg.name.split('/')[0]).filter(name => name?.startsWith('@')))];
    const run = (cwd, executable, args, options) => {
      if (executable !== 'npm') return releaseCommand(cwd, executable, args, options);
      const destination = scopes.map(scope => `--${scope}:registry=${registry}`);
      return releaseCommand(cwd, executable, [...args, ...destination, ...(args[0] === 'view' ? ['--prefer-online'] : [])], options);
    };
    if (operation === 'github') {
      for (const artifact of prepared.artifacts) {
        if (!await registryArtifactMatches(root, artifact, { registry, run })) throw new Error(`npm has not confirmed ${artifact.name}`);
      }
      console.log(await createGithubRelease(root, version, repository, await releaseNotes(root, version, repository)));
      return;
    }
    await publishPreparedRelease(root, version, {
      registry, run, progress: console.log,
      otp: async () => {
        if (!process.stdin.isTTY) throw new Error('An npm one-time password requires an interactive terminal');
        const answer = await password({ message: 'npm one-time password' });
        if (isCancel(answer)) throw new Error('Publication interrupted. Preserve the archives and use --resume');
        return answer;
      },
    });
    console.log(`Verified ${prepared.artifacts.length} npm packages. Use --github to publish the release notes.`);
  } finally { await unlock(); }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
