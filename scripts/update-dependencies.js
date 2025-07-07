#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { globSync } = require('glob');

/**
 * Get the latest version of a package from npm
 */
async function getLatestVersion(packageName) {
  try {
    const result = execSync(`npm view ${packageName} version`, { encoding: 'utf8' });
    return result.trim();
  } catch (error) {
    console.warn(`Could not fetch latest version for ${packageName}`);
    return null;
  }
}

/**
 * Update all dependencies in a package.json file
 */
async function updatePackageJson(filePath, latestVersions) {
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const relativePath = path.relative(path.join(__dirname, '..'), filePath);
  
  console.log(`\nUpdating ${relativePath}...`);
  
  let updated = false;

  // Update dependencies
  if (content.dependencies) {
    for (const [dep, version] of Object.entries(content.dependencies)) {
      if (dep.startsWith('@devgrid/')) continue; // Skip workspace dependencies
      
      const latest = latestVersions.get(dep);
      if (latest && version !== `^${latest}`) {
        console.log(`  ${dep}: ${version} → ^${latest}`);
        content.dependencies[dep] = `^${latest}`;
        updated = true;
      }
    }
  }

  // Update devDependencies
  if (content.devDependencies) {
    for (const [dep, version] of Object.entries(content.devDependencies)) {
      const latest = latestVersions.get(dep);
      if (latest && version !== `^${latest}`) {
        console.log(`  ${dep}: ${version} → ^${latest}`);
        content.devDependencies[dep] = `^${latest}`;
        updated = true;
      }
    }
  }

  if (updated) {
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');
  }

  return updated;
}

/**
 * Main function to update all dependencies
 */
async function updateAllDependencies() {
  const rootDir = path.join(__dirname, '..');
  const packageJsonFiles = globSync('**/package.json', {
    cwd: rootDir,
    ignore: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    absolute: true
  });

  // First, collect all unique dependencies
  const allDependencies = new Set();
  
  packageJsonFiles.forEach(file => {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    
    if (content.dependencies) {
      Object.keys(content.dependencies).forEach(dep => {
        if (!dep.startsWith('@devgrid/')) {
          allDependencies.add(dep);
        }
      });
    }
    
    if (content.devDependencies) {
      Object.keys(content.devDependencies).forEach(dep => {
        allDependencies.add(dep);
      });
    }
  });

  console.log(`Found ${allDependencies.size} unique external dependencies`);
  console.log('Fetching latest versions...\n');

  // Fetch latest versions
  const latestVersions = new Map();
  const deps = Array.from(allDependencies);
  
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    process.stdout.write(`Progress: ${i + 1}/${deps.length} - ${dep}\r`);
    const latest = await getLatestVersion(dep);
    if (latest) {
      latestVersions.set(dep, latest);
    }
  }
  
  console.log('\n\nLatest versions fetched. Starting updates...');

  // Update all package.json files
  let updatedCount = 0;
  for (const file of packageJsonFiles) {
    const updated = await updatePackageJson(file, latestVersions);
    if (updated) updatedCount++;
  }

  console.log(`\n✅ Updated ${updatedCount} package.json files`);
  console.log('\nNext steps:');
  console.log('1. Run "yarn install" to install the updated dependencies');
  console.log('2. Run "yarn build" to ensure everything builds correctly');
  console.log('3. Run "yarn test" to verify all tests pass');
  
  // Save update report
  const report = {
    timestamp: new Date().toISOString(),
    updatedPackages: updatedCount,
    latestVersions: Object.fromEntries(latestVersions.entries())
  };
  
  fs.writeFileSync(
    path.join(__dirname, 'dependency-update-report.json'),
    JSON.stringify(report, null, 2)
  );
  
  console.log('\nUpdate report saved to: scripts/dependency-update-report.json');
}

// Run if called directly
if (require.main === module) {
  updateAllDependencies().catch(console.error);
}

module.exports = { updateAllDependencies };