#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

console.log('Updating all Jest configurations to add forceExit...\n');

// Find all package.json files
const packageFiles = globSync('**/package.json', {
  ignore: ['**/node_modules/**', '**/dist/**', 'package.json'], // ignore root
  cwd: path.join(__dirname, '..'),
  absolute: true
});

let updated = 0;

packageFiles.forEach(packagePath => {
  const content = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  
  if (content.scripts && content.scripts.test) {
    const testScript = content.scripts.test;
    
    // Check if it uses jest and doesn't have forceExit
    if (testScript.includes('jest') && !testScript.includes('--forceExit')) {
      content.scripts.test = testScript + ' --forceExit';
      fs.writeFileSync(packagePath, JSON.stringify(content, null, 2) + '\n');
      
      const packageName = content.name || path.basename(path.dirname(packagePath));
      console.log(`✓ Updated ${packageName}`);
      updated++;
    }
  }
});

console.log(`\nUpdated ${updated} packages.`);

// Also update jest configs to add forceExit
console.log('\nUpdating Jest config files...\n');

const jestConfigs = globSync('**/jest.config.ts', {
  ignore: ['**/node_modules/**', '**/dist/**'],
  cwd: path.join(__dirname, '..'),
  absolute: true
});

jestConfigs.forEach(configPath => {
  let content = fs.readFileSync(configPath, 'utf8');
  
  if (!content.includes('forceExit')) {
    // Add forceExit after preset
    content = content.replace(
      /preset:\s*'ts-jest',/,
      "preset: 'ts-jest',\n  forceExit: true,"
    );
    
    fs.writeFileSync(configPath, content);
    console.log(`✓ Updated ${path.relative(path.join(__dirname, '..'), configPath)}`);
  }
});

console.log('\nDone! All Jest configurations updated.');