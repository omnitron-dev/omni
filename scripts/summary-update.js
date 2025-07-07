#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read the update report
const reportPath = path.join(__dirname, 'update-report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

console.log('=== Dependency Update Summary ===\n');
console.log(`Update completed at: ${report.timestamp}`);
console.log(`Total updates made: ${report.totalUpdates}\n`);

console.log('Major version updates:');
const majorUpdates = [
  '@types/node: ^22.15.2 → ^24.0.10',
  'jest: ^29.7.0 → ^30.0.4',
  '@jest/globals: ^29.7.0 → ^30.0.4',
  '@types/jest: ^29.5.14 → ^30.0.0',
  'commander: ^13.1.0 → ^14.0.0',
  'globals: ^15.14.0 → ^16.3.0'
];

majorUpdates.forEach(update => console.log(`  - ${update}`));

console.log('\nNext steps:');
console.log('1. Run "yarn install" to install all dependencies');
console.log('2. Run "yarn build" to verify the build');
console.log('3. Run "yarn test" to verify tests (some tests may need fixes)');
console.log('4. Review and fix any failing tests');
console.log('\nNote: p-limit was kept at v3 for CommonJS compatibility');