#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

// Find all jest.config.ts files
const configs = globSync('**/jest.config.ts', {
  ignore: ['**/node_modules/**', '**/dist/**'],
  cwd: path.join(__dirname, '..'),
  absolute: true
});

configs.forEach(configPath => {
  let content = fs.readFileSync(configPath, 'utf8');
  
  // Check if forceExit already exists
  if (content.includes('forceExit')) {
    console.log(`✓ ${path.basename(path.dirname(configPath))} - already has forceExit`);
    return;
  }
  
  // Add forceExit after preset line
  content = content.replace(
    /preset:\s*'ts-jest',/,
    "preset: 'ts-jest',\n  forceExit: true,"
  );
  
  fs.writeFileSync(configPath, content);
  console.log(`✓ ${path.basename(path.dirname(configPath))} - added forceExit`);
});

console.log('\nDone!');