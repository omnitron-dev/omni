#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

console.log('Updating Jest configurations to fix test exit issues...\n');

const rootDir = path.join(__dirname, '..');
const jestConfigs = globSync('**/jest.config.ts', {
  cwd: rootDir,
  ignore: ['**/node_modules/**', '**/dist/**'],
  absolute: true
});

const setupFilePath = path.join(rootDir, 'jest.setup.global.ts');

jestConfigs.forEach(configPath => {
  console.log(`Updating ${path.relative(rootDir, configPath)}...`);
  
  let content = fs.readFileSync(configPath, 'utf8');
  
  // Check if it already has forceExit or setupFilesAfterEnv
  const hasForceExit = content.includes('forceExit');
  const hasSetupFiles = content.includes('setupFilesAfterEnv');
  
  if (!hasForceExit || !hasSetupFiles) {
    // Find the export default { line
    const exportMatch = content.match(/export\s+default\s*{\s*$/m);
    if (exportMatch) {
      const insertPosition = exportMatch.index + exportMatch[0].length;
      const additions = [];
      
      if (!hasForceExit) {
        additions.push('  forceExit: true, // Force Jest to exit after tests complete');
      }
      
      if (!hasSetupFiles) {
        // Calculate relative path from package to root setup file
        const relativePath = path.relative(path.dirname(configPath), setupFilePath);
        additions.push(`  setupFilesAfterEnv: ['${relativePath}'], // Global test setup`);
      }
      
      if (additions.length > 0) {
        content = content.slice(0, insertPosition) + '\n' + additions.join('\n') + '\n' + content.slice(insertPosition);
        fs.writeFileSync(configPath, content);
        console.log('  ✓ Updated');
      } else {
        console.log('  - Already configured');
      }
    }
  } else {
    console.log('  - Already configured');
  }
});

// Also update package.json test scripts to include --forceExit
console.log('\nUpdating package.json test scripts...');

const packageJsonFiles = globSync('**/package.json', {
  cwd: rootDir,
  ignore: ['**/node_modules/**', '**/dist/**'],
  absolute: true
});

packageJsonFiles.forEach(packagePath => {
  const content = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  let updated = false;
  
  if (content.scripts && content.scripts.test) {
    const testScript = content.scripts.test;
    
    // Only update if it's a jest command and doesn't already have forceExit
    if (testScript.includes('jest') && !testScript.includes('--forceExit')) {
      content.scripts.test = testScript.replace('jest', 'jest --forceExit');
      updated = true;
    }
  }
  
  if (updated) {
    fs.writeFileSync(packagePath, JSON.stringify(content, null, 2) + '\n');
    console.log(`  ✓ Updated ${path.relative(rootDir, packagePath)}`);
  }
});

console.log('\nDone! Run "yarn test" to verify the fixes.');