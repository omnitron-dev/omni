#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

/**
 * Analyze all dependencies across the monorepo
 */
function analyzeDependencies() {
  const rootDir = path.join(__dirname, '..');
  const packageJsonFiles = globSync('**/package.json', {
    cwd: rootDir,
    ignore: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    absolute: true
  });

  const dependencyMap = new Map();
  const devDependencyMap = new Map();
  const packageInfo = [];

  // Collect all dependencies
  packageJsonFiles.forEach(file => {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    const relativePath = path.relative(rootDir, file);
    
    if (!content.name) return;

    const info = {
      name: content.name,
      path: relativePath,
      dependencies: content.dependencies || {},
      devDependencies: content.devDependencies || {},
      peerDependencies: content.peerDependencies || {}
    };

    packageInfo.push(info);

    // Process dependencies
    Object.entries(info.dependencies).forEach(([dep, version]) => {
      if (!dependencyMap.has(dep)) {
        dependencyMap.set(dep, new Map());
      }
      dependencyMap.get(dep).set(content.name, version);
    });

    // Process devDependencies
    Object.entries(info.devDependencies).forEach(([dep, version]) => {
      if (!devDependencyMap.has(dep)) {
        devDependencyMap.set(dep, new Map());
      }
      devDependencyMap.get(dep).set(content.name, version);
    });
  });

  // Analyze version conflicts
  const conflicts = {
    dependencies: [],
    devDependencies: []
  };

  // Check dependencies
  dependencyMap.forEach((versions, dep) => {
    const uniqueVersions = new Set(versions.values());
    if (uniqueVersions.size > 1 && !dep.startsWith('@devgrid/')) {
      conflicts.dependencies.push({
        package: dep,
        versions: Array.from(versions.entries()).map(([pkg, ver]) => ({ package: pkg, version: ver }))
      });
    }
  });

  // Check devDependencies
  devDependencyMap.forEach((versions, dep) => {
    const uniqueVersions = new Set(versions.values());
    if (uniqueVersions.size > 1) {
      conflicts.devDependencies.push({
        package: dep,
        versions: Array.from(versions.entries()).map(([pkg, ver]) => ({ package: pkg, version: ver }))
      });
    }
  });

  // Generate report
  console.log('=== Dependency Analysis Report ===\n');
  
  console.log(`Total packages analyzed: ${packageInfo.length}`);
  console.log(`Total unique dependencies: ${dependencyMap.size}`);
  console.log(`Total unique devDependencies: ${devDependencyMap.size}\n`);

  if (conflicts.dependencies.length > 0) {
    console.log('=== Dependency Version Conflicts ===\n');
    conflicts.dependencies.forEach(conflict => {
      console.log(`${conflict.package}:`);
      conflict.versions.forEach(v => {
        console.log(`  ${v.package}: ${v.version}`);
      });
      console.log();
    });
  }

  if (conflicts.devDependencies.length > 0) {
    console.log('=== DevDependency Version Conflicts ===\n');
    conflicts.devDependencies.forEach(conflict => {
      console.log(`${conflict.package}:`);
      conflict.versions.forEach(v => {
        console.log(`  ${v.package}: ${v.version}`);
      });
      console.log();
    });
  }

  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalPackages: packageInfo.length,
      totalDependencies: dependencyMap.size,
      totalDevDependencies: devDependencyMap.size,
      conflictingDependencies: conflicts.dependencies.length,
      conflictingDevDependencies: conflicts.devDependencies.length
    },
    packages: packageInfo,
    conflicts,
    allDependencies: Object.fromEntries(
      Array.from(dependencyMap.entries()).map(([dep, versions]) => [
        dep,
        Object.fromEntries(versions.entries())
      ])
    ),
    allDevDependencies: Object.fromEntries(
      Array.from(devDependencyMap.entries()).map(([dep, versions]) => [
        dep,
        Object.fromEntries(versions.entries())
      ])
    )
  };

  fs.writeFileSync(
    path.join(__dirname, 'dependency-report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log('\nDetailed report saved to: scripts/dependency-report.json');

  return report;
}

// Run if called directly
if (require.main === module) {
  analyzeDependencies();
}

module.exports = { analyzeDependencies };