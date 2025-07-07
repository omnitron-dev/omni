#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

console.log('Running tests with --detectOpenHandles to find unclosed resources...\n');

const packages = [
  'async-emitter',
  'common', 
  'messagepack',
  'netron',
  'netron-nest',
  'rotif',
  'smartbuffer'
];

for (const pkg of packages) {
  console.log(`\n=== Testing @devgrid/${pkg} ===`);
  try {
    execSync(`yarn workspace @devgrid/${pkg} test --detectOpenHandles --forceExit`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
  } catch (error) {
    console.error(`Failed to test ${pkg}`);
  }
}