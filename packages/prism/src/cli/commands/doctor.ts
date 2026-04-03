/**
 * Prism CLI - Doctor Command
 *
 * Diagnose project configuration and environment.
 *
 * @module @omnitron/prism/cli/commands/doctor
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log, COLORS } from '../constants.js';
import { findConfigFile, loadConfig, resolveAlias, type PrismConfig } from '../config.js';

interface DoctorOptions {
  cwd?: string;
}

interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

/**
 * Create the doctor command.
 */
export function doctorCommand(): Command {
  const command = new Command('doctor');

  command
    .description('Diagnose project configuration and environment')
    .option('-c, --cwd <path>', 'Working directory', process.cwd())
    .action(async (options: DoctorOptions) => {
      await runDoctor(options);
    });

  return command;
}

/**
 * Run the doctor command.
 */
async function runDoctor(options: DoctorOptions): Promise<void> {
  const cwd = options.cwd || process.cwd();

  console.log('');
  log.info('Prism Doctor - Checking project health...');
  console.log('');

  const checks: CheckResult[] = [];

  // 1. Config file
  checks.push(await checkConfigFile(cwd));

  // 2. Package.json
  checks.push(...(await checkPackageJson(cwd)));

  // 3. Config directories
  const config = await loadConfig(cwd);
  if (config) {
    checks.push(...checkDirectories(config));
  }

  // 4. TypeScript config
  checks.push(await checkTsConfig(cwd));

  // 5. Lockfile integrity
  checks.push(await checkLockfile(cwd));

  // Display results
  console.log('');
  const passCount = checks.filter((c) => c.status === 'pass').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;

  for (const check of checks) {
    const icon =
      check.status === 'pass'
        ? `${COLORS.success}✓${COLORS.reset}`
        : check.status === 'warn'
          ? `${COLORS.warning}⚠${COLORS.reset}`
          : `${COLORS.error}✖${COLORS.reset}`;
    console.log(`  ${icon} ${check.name}: ${check.message}`);
  }

  console.log('');
  console.log(
    `  ${COLORS.success}${passCount} passed${COLORS.reset}` +
      (warnCount > 0 ? `, ${COLORS.warning}${warnCount} warnings${COLORS.reset}` : '') +
      (failCount > 0 ? `, ${COLORS.error}${failCount} failed${COLORS.reset}` : '')
  );
  console.log('');

  if (failCount > 0) {
    process.exit(1);
  }
}

async function checkConfigFile(cwd: string): Promise<CheckResult> {
  const configPath = findConfigFile(cwd);
  if (!configPath) {
    return {
      name: 'Config file',
      status: 'fail',
      message: 'prism.config.json not found. Run `prism init` to create one.',
    };
  }
  return {
    name: 'Config file',
    status: 'pass',
    message: `Found at ${path.relative(cwd, configPath)}`,
  };
}

async function checkPackageJson(cwd: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const pkgPath = path.join(cwd, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    results.push({
      name: 'package.json',
      status: 'fail',
      message: 'Not found in project root.',
    });
    return results;
  }

  try {
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };

    const requiredPeers = ['react', 'react-dom', '@mui/material'];
    for (const dep of requiredPeers) {
      if (allDeps[dep]) {
        results.push({
          name: dep,
          status: 'pass',
          message: `${allDeps[dep]}`,
        });
      } else {
        results.push({
          name: dep,
          status: 'fail',
          message: 'Not installed. Required peer dependency.',
        });
      }
    }

    const optionalDeps = ['@emotion/react', '@emotion/styled', 'zustand'];
    for (const dep of optionalDeps) {
      if (allDeps[dep]) {
        results.push({
          name: dep,
          status: 'pass',
          message: `${allDeps[dep]}`,
        });
      } else {
        results.push({
          name: dep,
          status: 'warn',
          message: 'Not installed. Recommended dependency.',
        });
      }
    }
  } catch {
    results.push({
      name: 'package.json',
      status: 'fail',
      message: 'Failed to parse.',
    });
  }

  return results;
}

function checkDirectories(config: PrismConfig): CheckResult[] {
  const results: CheckResult[] = [];

  const dirs = {
    components: config.aliases.components,
    blocks: config.aliases.blocks,
    hooks: config.aliases.hooks,
    utils: config.aliases.utils,
  };

  for (const [name, alias] of Object.entries(dirs)) {
    const resolved = resolveAlias(alias, config);
    if (fs.existsSync(resolved)) {
      results.push({
        name: `${name} directory`,
        status: 'pass',
        message: `Exists at ${path.relative(config.rootDir, resolved)}`,
      });
    } else {
      results.push({
        name: `${name} directory`,
        status: 'warn',
        message: `Not found at ${path.relative(config.rootDir, resolved)}. Will be created on first add.`,
      });
    }
  }

  return results;
}

async function checkTsConfig(cwd: string): Promise<CheckResult> {
  const tsConfigPath = path.join(cwd, 'tsconfig.json');

  if (!fs.existsSync(tsConfigPath)) {
    return {
      name: 'TypeScript',
      status: 'warn',
      message: 'tsconfig.json not found. Path aliases may not work.',
    };
  }

  try {
    const content = await fs.promises.readFile(tsConfigPath, 'utf-8');
    // Strip comments for JSON parse (basic approach)
    const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const tsConfig = JSON.parse(stripped);
    const paths = tsConfig.compilerOptions?.paths || tsConfig.compilerOptions?.baseUrl;

    if (paths) {
      return {
        name: 'TypeScript',
        status: 'pass',
        message: 'Path aliases configured.',
      };
    }

    return {
      name: 'TypeScript',
      status: 'warn',
      message: 'No path aliases found. Ensure @ alias is configured for Prism imports.',
    };
  } catch {
    return {
      name: 'TypeScript',
      status: 'warn',
      message: 'Could not parse tsconfig.json.',
    };
  }
}

async function checkLockfile(cwd: string): Promise<CheckResult> {
  const lockfilePath = path.join(cwd, 'prism.lock.json');

  if (!fs.existsSync(lockfilePath)) {
    return {
      name: 'Lockfile',
      status: 'pass',
      message: 'No lockfile yet (no components installed).',
    };
  }

  try {
    const lockfile = JSON.parse(await fs.promises.readFile(lockfilePath, 'utf-8'));
    const componentCount = Object.keys(lockfile.components || {}).length;
    const blockCount = Object.keys(lockfile.blocks || {}).length;

    return {
      name: 'Lockfile',
      status: 'pass',
      message: `${componentCount} component(s), ${blockCount} block(s) installed.`,
    };
  } catch {
    return {
      name: 'Lockfile',
      status: 'warn',
      message: 'Lockfile exists but could not be parsed.',
    };
  }
}
