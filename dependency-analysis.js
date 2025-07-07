const fs = require('fs');
const path = require('path');

// All package.json files
const packageFiles = [
  '/Users/taaliman/projects/devgrid/dg-monorepo/package.json',
  '/Users/taaliman/projects/devgrid/dg-monorepo/apps/orbit/package.json',
  '/Users/taaliman/projects/devgrid/dg-monorepo/packages/async-emitter/package.json',
  '/Users/taaliman/projects/devgrid/dg-monorepo/packages/bitcoin-core/package.json',
  '/Users/taaliman/projects/devgrid/dg-monorepo/packages/common/package.json',
  '/Users/taaliman/projects/devgrid/dg-monorepo/packages/messagepack/package.json',
  '/Users/taaliman/projects/devgrid/dg-monorepo/packages/netron-nest/package.json',
  '/Users/taaliman/projects/devgrid/dg-monorepo/packages/netron/package.json',
  '/Users/taaliman/projects/devgrid/dg-monorepo/packages/rotif-nest/package.json',
  '/Users/taaliman/projects/devgrid/dg-monorepo/packages/rotif/package.json',
  '/Users/taaliman/projects/devgrid/dg-monorepo/packages/smartbuffer/package.json'
];

// Track all dependencies
const allDependencies = new Map();
const allDevDependencies = new Map();

// Read and parse all package.json files
packageFiles.forEach(filePath => {
  const content = fs.readFileSync(filePath, 'utf8');
  const pkg = JSON.parse(content);
  const packageName = path.relative('/Users/taaliman/projects/devgrid/dg-monorepo', filePath);
  
  // Process dependencies
  if (pkg.dependencies) {
    Object.entries(pkg.dependencies).forEach(([dep, version]) => {
      if (!dep.startsWith('@devgrid/') && version !== 'workspace:*') {
        if (!allDependencies.has(dep)) {
          allDependencies.set(dep, new Map());
        }
        allDependencies.get(dep).set(packageName, version);
      }
    });
  }
  
  // Process devDependencies
  if (pkg.devDependencies) {
    Object.entries(pkg.devDependencies).forEach(([dep, version]) => {
      if (!dep.startsWith('@devgrid/') && version !== 'workspace:*' && version !== 'workspace:^') {
        if (!allDevDependencies.has(dep)) {
          allDevDependencies.set(dep, new Map());
        }
        allDevDependencies.get(dep).set(packageName, version);
      }
    });
  }
});

// Analyze and report
console.log('# Dependency Analysis Report\n');

// 1. Dependencies with version conflicts
console.log('## 1. Dependencies with Different Versions\n');
console.log('### Production Dependencies:\n');
let hasConflicts = false;
allDependencies.forEach((versions, dep) => {
  const uniqueVersions = new Set(versions.values());
  if (uniqueVersions.size > 1) {
    hasConflicts = true;
    console.log(`**${dep}**:`);
    versions.forEach((version, pkg) => {
      console.log(`  - ${pkg}: ${version}`);
    });
    console.log();
  }
});
if (!hasConflicts) {
  console.log('No version conflicts found in production dependencies.\n');
}

console.log('### DevDependencies:\n');
hasConflicts = false;
allDevDependencies.forEach((versions, dep) => {
  const uniqueVersions = new Set(versions.values());
  if (uniqueVersions.size > 1) {
    hasConflicts = true;
    console.log(`**${dep}**:`);
    versions.forEach((version, pkg) => {
      console.log(`  - ${pkg}: ${version}`);
    });
    console.log();
  }
});
if (!hasConflicts) {
  console.log('No version conflicts found in devDependencies.\n');
}

// 2. All unique dependencies
console.log('\n## 2. All Unique Dependencies\n');
console.log('### Production Dependencies:\n');
const allProdDeps = new Set();
allDependencies.forEach((versions, dep) => {
  allProdDeps.add(dep);
});
Array.from(allProdDeps).sort().forEach(dep => {
  const versions = Array.from(new Set(allDependencies.get(dep).values()));
  console.log(`- ${dep}: ${versions.join(', ')}`);
});

console.log('\n### DevDependencies:\n');
const allDevDeps = new Set();
allDevDependencies.forEach((versions, dep) => {
  allDevDeps.add(dep);
});
Array.from(allDevDeps).sort().forEach(dep => {
  const versions = Array.from(new Set(allDevDependencies.get(dep).values()));
  console.log(`- ${dep}: ${versions.join(', ')}`);
});

// 3. Recommendations for updates
console.log('\n## 3. Recommendations for Updates\n');
console.log('### Dependencies that should be aligned:');
console.log('\n**High Priority (TypeScript & Core Build Tools):**');
console.log('- typescript: Should be aligned to ^5.8.3 across all packages');
console.log('- @types/node: Should be aligned to ^22.13.14 (latest version used)');
console.log('- jest: Should be aligned to ^29.7.0');
console.log('- ts-jest: Should be aligned to ^29.3.2');
console.log('- @types/jest: Should be aligned to ^29.5.14');

console.log('\n**NestJS Dependencies:**');
console.log('- @nestjs/common: Should be aligned to ^11.1.3');
console.log('- @nestjs/core: Should be aligned to ^11.1.3');
console.log('- @nestjs/testing: Should be aligned to ^11.1.3');

console.log('\n### Dependencies to check for updates:');
console.log('Run `npm outdated` or `yarn outdated` in each package to check for available updates.');