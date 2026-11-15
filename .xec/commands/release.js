import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCancel, password, text } from '@xec-sh/kit';
import {
  acquireReleaseLock, assertCleanReleaseTree, assertReleaseHead, commitReleaseVersion,
  createGithubRelease, discoverReleasePackages, ensureReleaseTag, loadPreparedRelease,
  planRelease, prepareReleaseArtifacts, publishPreparedRelease, registryAddress,
  pushReleaseRefs, registryArtifactMatches, releaseCommand, ReleaseCommandError, releaseNotes, verifyRemoteReleaseTag,
} from '@xec-sh/ops/release';
import semver from 'semver';
import policy, { assertBuildDependencies } from '../release-policy.mjs';
import { supersedeDraft } from '../supersede-draft.mjs';
import { qualifyRelease, verifyReleaseQualification, verifyQualifiedRevision } from '../qualification.mjs';
import { assertReleaseVersionAvailable } from '../release-registry.js';
import { prepareVersionQualification } from '../version-qualification.js';
import { releaseBuildContext, finalizePreparationBuild, assertReleaseProducerApi } from '../release/build.js';
import { releasePreparation } from '../release/recipe.js';

const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));
const repository = policy.repository;

function publicationError(error) {
  if (!(error?.cause instanceof ReleaseCommandError)) return error;
  let detail;
  try { detail = JSON.parse(error.cause.stdout).error; } catch { return error; }
  if (typeof detail?.code !== 'string' || !/^E[A-Z0-9_]+$/.test(detail.code)) return error;
  return new Error(`${error.message}\nnpm ${detail.code}`, { cause: error });
}

async function runRelease(version, operation, values, root = defaultRoot) {
  if (values.pushSource && !['prepare', 'qualify'].includes(operation)) throw Error('--push-source requires --prepare or --qualify');
  if (values.previous && !['prepare', 'qualify'].includes(operation)) throw Error('--previous requires --prepare or --qualify');
  if (values.fromQualified && (!['prepare', 'qualify'].includes(operation) || values.previous || values.pushSource))
    throw Error('--from-qualified requires --prepare or --qualify, without --previous or --push-source');
  if (values.fromQualified && !/^[a-f0-9]{40}$/.test(values.fromQualified))
    throw Error('--from-qualified requires the exact original qualified commit');
  if (values.pushSource && !values.previous) throw Error('--push-source requires --previous');
  if (operation === 'list') {
    const packages = await discoverReleasePackages(root);
    for (const pkg of packages) console.log(`${pkg.name}@${pkg.version}  ${pkg.path}`);
    console.log(`${packages.length} public packages`);
    return;
  }

  if (!version) {
    const cli = JSON.parse(await readFile(path.join(root, 'apps/omnitron/package.json'), 'utf8'));
    if (operation === 'plan') version = semver.inc(cli.version, 'patch');
    else if (process.stdin.isTTY) {
      const answer = await text({ message: 'Release version', placeholder: semver.inc(cli.version, 'patch') });
      if (isCancel(answer)) return;
      version = answer;
    }
  }
  if (!version || semver.valid(version) !== version) throw new Error('Supply an exact semantic version; see xec release --help');
  if (operation === 'supersede') {
    console.log(JSON.stringify(await supersedeDraft(root, version, values.supersede), null, 2));
    return;
  }
  // Refuse unsupported installed build dependencies before changing versions or
  // starting costly qualification. Sealed resume/publication does not rebuild.
  if (operation === 'prepare') { await assertBuildDependencies(root); assertReleaseProducerApi(); }
  const plan = await planRelease(root, version);
  console.log(`${plan.tag} · ${plan.npmTag} · ${plan.packages.length} packages · ${plan.commit}`);
  if (plan.blockers.length) throw new Error(plan.blockers.join('\n'));
  if (operation === 'plan') return;

  const unlock = await acquireReleaseLock(root);
  try {
    await assertCleanReleaseTree(root);
    const qualify = async () => {
      if (values.fromQualified) return prepareVersionQualification(root, version, {
        baseCommit: values.fromQualified, prepared: await loadPreparedRelease(root, version),
        verifyBase: base => verifyQualifiedRevision(root, base),
      });
      if (values.pushSource) {
        if (await releaseCommand(root, 'git', ['branch', '--show-current']) !== policy.branch) throw Error('Push the reviewed release branch: ' + policy.branch);
        const commit = await releaseCommand(root, 'git', ['rev-parse', 'HEAD']);
        await releaseCommand(root, 'git', ['-c', 'push.followTags=false', 'push', 'origin', commit + ':refs/heads/' + policy.branch]);
      }
      return qualifyRelease(root, version, { previous: values.previous });
    };
    if (operation === 'qualify') {
      console.log(JSON.stringify(await qualify(), null, 2));
      return;
    }
    if (operation === 'prepare') {
      if (await releaseCommand(root, 'git', ['branch', '--show-current']) !== policy.branch) {
        throw new Error('Prepare from a clean ' + policy.branch + ' branch');
      }
      // An occupied historical version must fail before a build, version commit
      // or local release tag. Existing sealed archives use the resume path.
      const existing = path.join(root, '.release-artifacts', version, plan.commit, 'release.json');
      const sealed = await readFile(existing, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      if (!sealed) await assertReleaseVersionAvailable(root, plan.packages, version, { registry: values.registry });
      await commitReleaseVersion(root, version);
      const commit = await releaseCommand(root, 'git', ['rev-parse', 'HEAD']);
      const buildContext = await releaseBuildContext(root, commit);
      const prepared = await prepareReleaseArtifacts(root, version, await releasePreparation(root, commit, buildContext));
      await finalizePreparationBuild(root, version, buildContext);
      const notes = await releaseNotes(root, version, repository);
      await writeFile(path.join(root, '.release-artifacts', version, prepared.commit, 'NOTES.md'), notes);
      await ensureReleaseTag(root, version);
      if (values.previous || values.fromQualified) await qualify();
      console.log(`Prepared ${prepared.artifacts.length} archives. ${values.previous || values.fromQualified ? "Qualification verified; publish with xec release " + version + " --finish." : "Complete qualification with xec release " + version + " --qualify --previous <commit>."}`);
      return;
    }

    const prepared = await loadPreparedRelease(root, version);
    if (!await assertReleaseHead(root, version)) throw new Error('Missing local release tag; finish --prepare first');
    const qualification = await verifyReleaseQualification(root, version);
    if (operation === 'status') { console.log(JSON.stringify({ prepared, qualification }, null, 2)); return; }
    if (operation === 'push') { await pushReleaseRefs(root, version); return; }

    const registry = registryAddress(typeof values.registry === 'string' ? values.registry : undefined);
    if (operation !== 'finish') await verifyRemoteReleaseTag(root, version, true);
    const finishGithub = async () => {
      console.log(await createGithubRelease(root, version, repository, await releaseNotes(root, version, repository)));
    };
    if (operation === 'github') {
      for (const artifact of prepared.artifacts) {
        if (!await registryArtifactMatches(root, artifact, { registry })) throw new Error(`npm has not confirmed ${artifact.name}`);
      }
      await finishGithub();
      return;
    }
    await publishPreparedRelease(root, version, {
      registry, progress: console.log,
      beforeUpload: operation === 'finish' ? async () => {
        await pushReleaseRefs(root, version);
        await verifyRemoteReleaseTag(root, version, true);
      } : undefined,
      otp: async () => {
        if (!process.stdin.isTTY) throw new Error('An npm one-time password requires an interactive terminal');
        const answer = await password({ message: 'npm one-time password' });
        if (isCancel(answer)) throw new Error('Publication interrupted. Preserve the archives and use --resume');
        return answer;
      },
    }).catch(error => { throw publicationError(error); });
    if (operation === 'finish') await finishGithub();
    else console.log(`Verified ${prepared.artifacts.length} npm packages. Use --github to publish the release notes.`);
  } finally { await unlock(); }
}


/** Native project command; Xec owns parsing, conflicts, generated help and errors. */
export function command(program, options = {}) {
  const release = program.command('release [version]')
    .description('Qualify immutable Omnitron packages and publish the accepted archives')
    .allowExcessArguments(false);
  const operations = [
    ['--list', 'List public workspaces in dependency order', 'list'],
    ['--dry-run', 'Print the release plan without preparation or publication (default)', 'plan'],
    ['--prepare', 'Commit versions, build and verify archives, then create a local tag', 'prepare'],
    ['--qualify', 'Verify independent builds, CI and native transition/rollback', 'qualify'],
    ['--status', 'Recheck selected qualification and prepared archives without changing them', 'status'],
    ['--finish', 'Verify qualification and npm access, push the tag and publish sealed archives', 'finish'],
    ['--push', 'Push the prepared commit and its single annotated tag atomically', 'push'],
    ['--publish', 'Publish sealed archives from the exact remotely tagged commit', 'publish'],
    ['--resume', 'Resume interrupted publication with the same sealed archives', 'publish'],
    ['--github', 'Create the GitHub release after verifying every npm archive', 'github'],
    ['--supersede <directory>', 'Archive an unsubmitted local draft from its preserved checkout', 'supersede'],
  ];
  const choices = operations.map(([flags, description, operation]) => ({
    option: program.createOption(flags, description), operation,
  }));
  for (const choice of choices) {
    release.addOption(choice.option.conflicts(choices
      .filter(other => other !== choice).map(other => other.option.attributeName())));
  }
  release.option('--previous <commit>', 'Exact previous backend for transition/rollback qualification')
    .option('--from-qualified <commit>', 'Reuse qualified code after an exact metadata-only version change')
    .option('--push-source', 'Push the exact source branch for CI before qualification, without tags')
    .option('--registry <url>', 'HTTPS npm registry or a loopback test registry')
    .addHelpText('after', `
Prepare and qualify: xec release VERSION --prepare --previous COMMIT --push-source
Publish accepted bytes: xec release VERSION --finish
Publication never repeats the build or tests. Archives and receipts are retained
under .release-artifacts/. An interrupted publication resumes from the same commit.
`)
    .action((version, values) => runRelease(version,
      choices.find(choice => values[choice.option.attributeName()])?.operation ?? 'plan',
      values, options.root ?? defaultRoot));
}
