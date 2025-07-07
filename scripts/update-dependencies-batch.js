#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { globSync } = require('glob');

/**
 * Batch fetch latest versions for multiple packages
 */
async function getLatestVersionsBatch(packageNames) {
  const versions = new Map();
  const batchSize = 10;
  
  for (let i = 0; i < packageNames.length; i += batchSize) {
    const batch = packageNames.slice(i, i + batchSize);
    const promises = batch.map(async (pkg) => {
      try {
        const result = execSync(`npm view ${pkg} version`, { encoding: 'utf8' });
        versions.set(pkg, result.trim());
      } catch (error) {
        console.warn(`Could not fetch version for ${pkg}`);
      }
    });
    
    await Promise.all(promises);
    console.log(`Fetched versions: ${i + batch.length}/${packageNames.length}`);
  }
  
  return versions;
}

/**
 * Update all dependencies to latest versions
 */
async function updateAllDependencies() {
  const rootDir = path.join(__dirname, '..');
  const packageJsonFiles = globSync('**/package.json', {
    cwd: rootDir,
    ignore: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    absolute: true
  });

  // Collect all unique external dependencies
  const allDependencies = new Set();
  
  packageJsonFiles.forEach(file => {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    
    ['dependencies', 'devDependencies'].forEach(depType => {
      if (content[depType]) {
        Object.keys(content[depType]).forEach(dep => {
          if (!dep.startsWith('@devgrid/')) {
            allDependencies.add(dep);
          }
        });
      }
    });
  });

  console.log(`Found ${allDependencies.size} unique external dependencies`);
  console.log('Fetching latest versions...\n');

  // Fetch latest versions in batches
  const latestVersions = await getLatestVersionsBatch(Array.from(allDependencies));
  
  console.log(`\nFetched ${latestVersions.size} latest versions`);
  console.log('\nUpdating package.json files...\n');

  // Update all packages
  let totalUpdates = 0;
  
  for (const file of packageJsonFiles) {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    const relativePath = path.relative(rootDir, file);
    let updated = false;
    
    console.log(`Checking ${relativePath}...`);
    
    ['dependencies', 'devDependencies'].forEach(depType => {
      if (content[depType]) {
        Object.entries(content[depType]).forEach(([dep, currentVersion]) => {
          if (dep.startsWith('@devgrid/')) return;
          
          const latest = latestVersions.get(dep);
          if (latest) {
            const targetVersion = `^${latest}`;
            if (currentVersion !== targetVersion) {
              console.log(`  ${dep}: ${currentVersion} → ${targetVersion}`);
              content[depType][dep] = targetVersion;
              updated = true;
              totalUpdates++;
            }
          }
        });
      }
    });
    
    if (updated) {
      fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n');
    }
  }

  console.log(`\n✅ Made ${totalUpdates} updates`);
  
  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    totalUpdates,
    latestVersions: Object.fromEntries(latestVersions.entries())
  };
  
  fs.writeFileSync(
    path.join(__dirname, 'update-report.json'),
    JSON.stringify(report, null, 2)
  );
  
  console.log('\nNext steps:');
  console.log('1. Run "yarn install" to install updated dependencies');
  console.log('2. Run "yarn build" to ensure everything builds');
  console.log('3. Run "yarn test" to verify all tests pass');
}

// Run
if (require.main === module) {
  updateAllDependencies().catch(console.error);
}

module.exports = { updateAllDependencies };