#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

/**
 * Fix process.env.PROPERTY to process.env['PROPERTY'] in TypeScript files
 */
function fixProcessEnvAccess() {
  const rootDir = path.join(__dirname, '..');
  
  // Find all TypeScript files
  const tsFiles = globSync('**/*.ts', {
    cwd: rootDir,
    ignore: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    absolute: true
  });

  let totalFixed = 0;
  const fixedFiles = [];

  // Regex to match process.env.PROPERTY
  const processEnvRegex = /process\.env\.([A-Z_][A-Z0-9_]*)/g;

  tsFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    let modified = false;
    
    const newContent = content.replace(processEnvRegex, (match, envVar) => {
      modified = true;
      totalFixed++;
      return `process.env['${envVar}']`;
    });

    if (modified) {
      fs.writeFileSync(file, newContent);
      fixedFiles.push(path.relative(rootDir, file));
    }
  });

  console.log(`Fixed ${totalFixed} process.env accesses in ${fixedFiles.length} files`);
  
  if (fixedFiles.length > 0) {
    console.log('\nFixed files:');
    fixedFiles.forEach(file => console.log(`  - ${file}`));
  }
}

// Run the fix
fixProcessEnvAccess();