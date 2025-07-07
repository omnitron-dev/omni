#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

// Common TypeScript-related dependencies that should be aligned
const TS_RELATED_DEPS = [
  'typescript',
  '@types/node',
  '@types/jest',
  'ts-jest',
  'ts-node',
  '@typescript-eslint/parser',
  '@typescript-eslint/eslint-plugin',
  'eslint',
  'prettier',
  'jest',
  '@types/ws',
  '@types/express',
  'tsx',
  'tsup'
];

/**
 * Align TypeScript and related dependencies across all packages
 */
function alignTypeScriptDeps() {
  const rootDir = path.join(__dirname, '..');
  const packageJsonFiles = globSync('**/package.json', {
    cwd: rootDir,
    ignore: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    absolute: true
  });

  // First, find the most common or latest versions
  const versionMap = new Map();
  
  packageJsonFiles.forEach(file => {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    const allDeps = { ...content.dependencies, ...content.devDependencies };
    
    TS_RELATED_DEPS.forEach(dep => {
      if (allDeps[dep]) {
        if (!versionMap.has(dep)) {
          versionMap.set(dep, []);
        }
        versionMap.get(dep).push(allDeps[dep]);
      }
    });
  });

  // Determine the target version for each dependency
  const targetVersions = new Map();
  versionMap.forEach((versions, dep) => {
    // Get the most recent version (assumes semver format)
    const sorted = versions.sort().reverse();
    targetVersions.set(dep, sorted[0]);
  });

  console.log('=== Target TypeScript-related Dependency Versions ===\n');
  targetVersions.forEach((version, dep) => {
    console.log(`${dep}: ${version}`);
  });
  console.log();

  // Update all packages
  let totalUpdates = 0;
  
  packageJsonFiles.forEach(file => {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    const relativePath = path.relative(rootDir, file);
    let updated = false;
    
    // Update dependencies
    if (content.dependencies) {
      TS_RELATED_DEPS.forEach(dep => {
        if (content.dependencies[dep] && targetVersions.has(dep)) {
          const target = targetVersions.get(dep);
          if (content.dependencies[dep] !== target) {
            console.log(`${relativePath}: ${dep} ${content.dependencies[dep]} → ${target}`);
            content.dependencies[dep] = target;
            updated = true;
            totalUpdates++;
          }
        }
      });
    }
    
    // Update devDependencies
    if (content.devDependencies) {
      TS_RELATED_DEPS.forEach(dep => {
        if (content.devDependencies[dep] && targetVersions.has(dep)) {
          const target = targetVersions.get(dep);
          if (content.devDependencies[dep] !== target) {
            console.log(`${relativePath}: ${dep} ${content.devDependencies[dep]} → ${target}`);
            content.devDependencies[dep] = target;
            updated = true;
            totalUpdates++;
          }
        }
      });
    }
    
    if (updated) {
      fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n');
    }
  });

  console.log(`\n✅ Made ${totalUpdates} updates across the monorepo`);
  
  // Save alignment report
  const report = {
    timestamp: new Date().toISOString(),
    totalUpdates,
    targetVersions: Object.fromEntries(targetVersions.entries())
  };
  
  fs.writeFileSync(
    path.join(__dirname, 'typescript-alignment-report.json'),
    JSON.stringify(report, null, 2)
  );
  
  console.log('Report saved to: scripts/typescript-alignment-report.json');
}

// Run if called directly
if (require.main === module) {
  alignTypeScriptDeps();
}

module.exports = { alignTypeScriptDeps };