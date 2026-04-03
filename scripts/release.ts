#!/usr/bin/env tsx

/**
 * Unified release script for Omnitron monorepo
 *
 * This script handles:
 * - Version synchronization across all packages
 * - Changelog generation
 * - Building packages
 * - Publishing to npm
 * - Git tagging and GitHub releases
 *
 * Options:
 * --list-packages, --list  List all packages with relative paths and exit
 * --skip-build             Skip building packages
 * --skip-publish           Skip publishing to npm
 * --dry-run                Simulate release without making changes
 * --force                  Force release even with uncommitted changes
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prism, select, text, confirm } from '@xec-sh/kit'
import semver from 'semver'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages')
const APPS_DIR = path.join(ROOT_DIR, 'apps')

interface Package {
  name: string
  version: string
  path: string
  private: boolean
}

interface ReleaseOptions {
  version?: string
  versionType?: 'major' | 'minor' | 'patch' | 'prerelease' | 'custom'
  prerelease?: string
  skipBuild?: boolean
  skipPublish?: boolean
  dryRun?: boolean
  force?: boolean
  listPackages?: boolean
}

/**
 * Execute command with proper error handling
 */
function exec(cmd: string, options: { cwd?: string; silent?: boolean } = {}): string {
  const { cwd = ROOT_DIR, silent = false } = options

  try {
    const result = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit'
    })
    return result?.trim() || ''
  } catch (error: any) {
    if (!silent) {
      console.error(prism.red(`❌ Command failed: ${cmd}`))
      console.error(error.message)
    }
    throw error
  }
}

/**
 * Publishable packages in dependency order.
 * Packages earlier in the list must be published before those that depend on them.
 */
const PUBLISHABLE_PACKAGES: readonly string[] = [
  // Foundation (no internal deps)
  'packages/common',
  'packages/cuid',
  'packages/eventemitter',
  'packages/msgpack',

  // Knowledge base
  'packages/kb',
  
  // Titan core (depends on common, eventemitter, msgpack)
  'packages/titan',

  // Titan modules — Phase 1: no inter-module deps
  'packages/titan-telemetry-relay',
  'packages/titan-scheduler',

  // Titan modules — Phase 2: depend only on titan core (logger/config)
  'packages/titan-redis',
  'packages/titan-auth',
  'packages/titan-cache',
  'packages/titan-database',
  'packages/titan-events',
  'packages/titan-health',
  'packages/titan-metrics',
  'packages/titan-pm',

  // Titan modules — Phase 3: depend on titan-redis
  'packages/titan-discovery',
  'packages/titan-lock',
  'packages/titan-ratelimit',

  // Titan modules — Phase 4: depend on titan-events + titan-redis
  'packages/titan-notifications',

  // Testing utilities (depends on titan + titan-*)
  'packages/testing',

  // Netron client packages
  'packages/netron-browser',
  'packages/netron-react',

  // UI design system
  'packages/prism',

  // CLI / daemon
  'apps/omnitron',
]

/**
 * Get all packages in the monorepo
 */
async function getAllPackages(): Promise<Package[]> {
  const packages: Package[] = []

  for (const relativePath of PUBLISHABLE_PACKAGES) {
    const packageDir = path.join(ROOT_DIR, relativePath)
    const pkgJsonPath = path.join(packageDir, 'package.json')

    try {
      const content = await fs.readFile(pkgJsonPath, 'utf-8')
      const pkg = JSON.parse(content)

      packages.push({
        name: pkg.name,
        version: pkg.version,
        path: packageDir,
        private: pkg.private || false
      })
    } catch {
      console.warn(prism.yellow(`⚠️  Skipping ${relativePath}: package.json not found`))
    }
  }

  return packages
}

/**
 * List all packages with their relative paths
 */
async function listPackages(): Promise<void> {
  const packages = await getAllPackages()

  console.log(prism.bold(prism.cyan('\n📦 Omnitron Monorepo Packages\n')))

  const publishable = packages.filter(pkg => !pkg.private)
  const private_pkgs = packages.filter(pkg => pkg.private)

  if (publishable.length > 0) {
    console.log(prism.bold(prism.green(`Publishable packages (${publishable.length}):\n`)))
    for (const pkg of publishable) {
      const relativePath = path.relative(ROOT_DIR, pkg.path)
      console.log(`  ${prism.cyan(pkg.name.padEnd(30))} ${prism.gray(relativePath)}`)
    }
  }

  if (private_pkgs.length > 0) {
    console.log(prism.bold(prism.yellow(`\nPrivate packages (${private_pkgs.length}):\n`)))
    for (const pkg of private_pkgs) {
      const relativePath = path.relative(ROOT_DIR, pkg.path)
      console.log(`  ${prism.yellow(pkg.name.padEnd(30))} ${prism.gray(relativePath)}`)
    }
  }

  console.log(prism.gray(`\nTotal: ${packages.length} packages\n`))
}

/**
 * Get current version from root package.json
 */
async function getCurrentVersion(): Promise<string> {
  const rootPkg = JSON.parse(await fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf-8'))
  return rootPkg.version
}

/**
 * Update version in package.json
 */
async function updatePackageVersion(packagePath: string, version: string): Promise<void> {
  const pkgJsonPath = path.join(packagePath, 'package.json')
  const content = await fs.readFile(pkgJsonPath, 'utf-8')
  const pkg = JSON.parse(content)

  pkg.version = version

  // Update workspace dependencies to use the new version
  const isOwnPackage = (name: string) =>
    name.startsWith('@omnitron-dev/') || name.startsWith('@kysera/')

  const depFields = ['dependencies', 'devDependencies', 'peerDependencies']
  for (const field of depFields) {
    if (pkg[field]) {
      for (const [depName, depVersion] of Object.entries(pkg[field])) {
        if (isOwnPackage(depName) && depVersion === 'workspace:*') {
          // Keep workspace protocol during development
          continue
        } else if (isOwnPackage(depName)) {
          pkg[field][depName] = `^${version}`
        }
      }
    }
  }

  await fs.writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n')
}

/**
 * Check git status
 */
function checkGitStatus(options: ReleaseOptions): void {
  const status = exec('git status --porcelain', { silent: true })

  if (status && !options.force) {
    console.error(prism.red('❌ Working directory is not clean:'))
    console.error(status)
    throw new Error('Please commit or stash your changes')
  }

  const branch = exec('git branch --show-current', { silent: true })
  if (branch !== 'main' && branch !== 'master' && !options.force) {
    throw new Error(`Must be on main branch (currently on ${branch})`)
  }
}

/**
 * Generate changelog
 */
async function generateChangelog(version: string): Promise<string> {
  const date = new Date().toISOString().split('T')[0]

  // Get commit messages since last tag
  let commits = ''
  try {
    const lastTag = exec('git describe --tags --abbrev=0', { silent: true })
    commits = exec(`git log ${lastTag}..HEAD --oneline`, { silent: true })
  } catch {
    // No previous tags
    commits = exec('git log --oneline', { silent: true })
  }

  // Parse commits by type
  const features: string[] = []
  const fixes: string[] = []
  const breaking: string[] = []
  const other: string[] = []

  for (const line of commits.split('\n')) {
    if (!line) continue

    const match = line.match(/^[a-f0-9]+ (.+)$/)
    if (!match) continue

    const message = match[1]!;

    if (message.startsWith('feat:') || message.startsWith('feat(')) {
      features.push(message)
    } else if (message.startsWith('fix:') || message.startsWith('fix(')) {
      fixes.push(message)
    } else if (message.includes('BREAKING')) {
      breaking.push(message)
    } else {
      other.push(message)
    }
  }

  let changelog = `## [${version}] - ${date}\n\n`

  if (breaking.length > 0) {
    changelog += '### ⚠️ BREAKING CHANGES\n\n'
    breaking.forEach(msg => (changelog += `- ${msg}\n`))
    changelog += '\n'
  }

  if (features.length > 0) {
    changelog += '### ✨ Features\n\n'
    features.forEach(msg => (changelog += `- ${msg}\n`))
    changelog += '\n'
  }

  if (fixes.length > 0) {
    changelog += '### 🐛 Bug Fixes\n\n'
    fixes.forEach(msg => (changelog += `- ${msg}\n`))
    changelog += '\n'
  }

  if (other.length > 0) {
    changelog += '### 📝 Other Changes\n\n'
    other.forEach(msg => (changelog += `- ${msg}\n`))
    changelog += '\n'
  }

  return changelog
}

/**
 * Update changelog file
 */
async function updateChangelog(version: string): Promise<void> {
  const changelogPath = path.join(ROOT_DIR, 'CHANGELOG.md')
  const newEntry = await generateChangelog(version)

  let existingContent = ''
  try {
    existingContent = await fs.readFile(changelogPath, 'utf-8')
  } catch {
    // Create new changelog
    existingContent = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`
  }

  // Insert new entry after header
  const lines = existingContent.split('\n')
  const insertIndex = lines.findIndex(line => line.startsWith('## ['))

  if (insertIndex > 0) {
    lines.splice(insertIndex, 0, newEntry)
  } else {
    lines.push(newEntry)
  }

  await fs.writeFile(changelogPath, lines.join('\n'))
}

/**
 * Prompt for version
 */
async function promptVersion(currentVersion: string): Promise<string> {
  const versionType = await select({
    message: `Current version is ${currentVersion}. Select version type:`,
    options: [
      { label: `Patch (${semver.inc(currentVersion, 'patch')})`, value: 'patch' },
      { label: `Minor (${semver.inc(currentVersion, 'minor')})`, value: 'minor' },
      { label: `Major (${semver.inc(currentVersion, 'major')})`, value: 'major' },
      { label: 'Prerelease', value: 'prerelease' },
      { label: 'Custom', value: 'custom' }
    ]
  })

  let newVersion: string

  if (versionType === 'custom') {
    const customVersion = await text({
      message: 'Enter custom version:',
      validate: value => {
        if (!semver.valid(value)) {
          return 'Invalid version format'
        }
        return undefined
      }
    })
    newVersion = customVersion as string
  } else if (versionType === 'prerelease') {
    const prereleaseId = await select({
      message: 'Select prerelease type:',
      options: [
        { label: 'Alpha', value: 'alpha' as semver.ReleaseType },
        { label: 'Beta', value: 'beta' as semver.ReleaseType },
        { label: 'RC', value: 'rc' as semver.ReleaseType }
      ]
    }) as semver.ReleaseType;
    newVersion = semver.inc(currentVersion, 'prerelease', prereleaseId) || currentVersion
  } else {
    newVersion = semver.inc(currentVersion, versionType as semver.ReleaseType) || currentVersion
  }

  return newVersion
}

/**
 * Build all packages
 */
async function buildPackages(): Promise<void> {
  console.log(prism.cyan('🔨 Building packages...'))
  exec('pnpm build')
  console.log(prism.green('✅ Build completed'))
}

/**
 * Publish packages to npm
 */
async function publishPackages(packages: Package[], options: ReleaseOptions): Promise<void> {
  const publishable = packages.filter(pkg => !pkg.private)

  console.log(prism.cyan(`\n📦 Publishing ${publishable.length} packages...`))

  for (const pkg of publishable) {
    console.log(prism.gray(`  Publishing ${pkg.name}...`))

    if (!options.dryRun) {
      try {
        exec('pnpm publish --access public --no-git-checks', {
          cwd: pkg.path
        })
        console.log(prism.green(`  ✅ ${pkg.name} published`))
      } catch (error) {
        console.error(prism.red(`  ❌ Failed to publish ${pkg.name}`))
        throw error
      }
    } else {
      console.log(prism.yellow(`  [DRY RUN] Would publish ${pkg.name}`))
    }
  }
}

/**
 * Create git tag and push
 */
async function createGitRelease(version: string, options: ReleaseOptions): Promise<void> {
  if (options.dryRun) {
    console.log(prism.yellow(`\n[DRY RUN] Would create tag v${version}`))
    return
  }

  console.log(prism.cyan(`\n🏷️  Creating git tag v${version}...`))

  // Commit changes
  exec('git add -A')
  exec(`git commit -m "chore(release): v${version}"`)

  // Create tag
  exec(`git tag -a v${version} -m "Release v${version}"`)

  // Push
  const shouldPush = await confirm({
    message: 'Push to remote?',
    initialValue: true
  })

  if (shouldPush) {
    exec('git push')
    exec('git push --tags')
    console.log(prism.green('✅ Pushed to remote'))
  }
}

/**
 * Main release flow
 */
async function main() {
  console.log(prism.bold(prism.cyan('\n🚀 Omnitron Monorepo Release\n')))

  // Parse CLI arguments
  const args = process.argv.slice(2)
  const options: ReleaseOptions = {
    skipBuild: args.includes('--skip-build'),
    skipPublish: args.includes('--skip-publish'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    listPackages: args.includes('--list-packages') || args.includes('--list')
  }

  // Handle --list-packages flag
  if (options.listPackages) {
    await listPackages()
    return
  }

  try {
    // 1. Check git status
    console.log(prism.cyan('📋 Checking environment...'))
    checkGitStatus(options)
    console.log(prism.green('✅ Git status clean'))

    // 2. Get current version and packages
    const currentVersion = await getCurrentVersion()
    const packages = await getAllPackages()

    console.log(prism.gray(`Current version: ${currentVersion}`))
    console.log(prism.gray(`Found ${packages.length} packages`))

    // 3. Prompt for new version
    const newVersion = await promptVersion(currentVersion)

    console.log(prism.bold(prism.green(`\n📦 Releasing version ${newVersion}\n`)))

    // 4. Update all package versions
    console.log(prism.cyan('📝 Updating package versions...'))

    // Update root package.json
    await updatePackageVersion(ROOT_DIR, newVersion)

    // Update all packages
    for (const pkg of packages) {
      await updatePackageVersion(pkg.path, newVersion)
      console.log(prism.gray(`  Updated ${pkg.name} to ${newVersion}`))
    }

    console.log(prism.green('✅ Versions updated'))

    // 5. Generate and update changelog
    console.log(prism.cyan('\n📄 Updating changelog...'))
    await updateChangelog(newVersion)
    console.log(prism.green('✅ Changelog updated'))

    // 6. Build packages
    if (!options.skipBuild) {
      await buildPackages()
    }

    // 7. Publish to npm
    if (!options.skipPublish) {
      await publishPackages(packages, options)
    }

    // 8. Create git tag and push
    await createGitRelease(newVersion, options)

    // 9. Success!
    console.log(prism.bold(prism.green('\n✨ Release completed successfully!\n')))
    console.log(prism.cyan('Next steps:'))
    console.log('  1. Create GitHub release: https://github.com/omnitron-dev/omni/releases/new')
    console.log(`  2. Use tag: v${newVersion}`)
    console.log('  3. Copy changelog entry for release notes')
    console.log('  4. Announce in Discord/Twitter')
  } catch (error: any) {
    console.error(prism.red('\n❌ Release failed:'))
    console.error(error.message)
    process.exit(1)
  }
}

// Run the script
main().catch(error => {
  console.error(prism.red('Fatal error:'), error)
  process.exit(1)
})
