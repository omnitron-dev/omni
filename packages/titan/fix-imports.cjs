#!/usr/bin/env node

/**
 * Script to fix NotificationManager imports in test files to be type-only
 */

const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, 'test/rotif');

// Find all .spec.ts files
function findTestFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(fullPath));
    } else if (entry.name.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

// Update import to be type-only
function updateTestFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;

  // Pattern 1: import { NotificationManager } from '...rotif.js'
  const pattern1 = /import\s+{\s*NotificationManager\s*}\s+from\s+['"]([^'"]+\/rotif\.js)['"]/g;
  if (pattern1.test(content)) {
    content = content.replace(
      /import\s+{\s*NotificationManager\s*}\s+from\s+['"]([^'"]+\/rotif\.js)['"]/g,
      "import type { NotificationManager } from '$1'"
    );
    modified = true;
  }

  // Pattern 2: import { Other, NotificationManager } from '...rotif.js'
  const pattern2 = /import\s+{\s*([^}]+),\s*NotificationManager\s*}\s+from\s+['"]([^'"]+\/rotif\.js)['"]/g;
  if (pattern2.test(content)) {
    content = content.replace(
      /import\s+{\s*([^}]+),\s*NotificationManager\s*}\s+from\s+['"]([^'"]+\/rotif\.js)['"]/g,
      (match, others, path) => {
        return `import { ${others} } from '${path}';\nimport type { NotificationManager } from '${path}'`;
      }
    );
    modified = true;
  }

  // Pattern 3: import { NotificationManager, Other } from '...rotif.js'
  const pattern3 = /import\s+{\s*NotificationManager\s*,\s*([^}]+)}\s+from\s+['"]([^'"]+\/rotif\.js)['"]/g;
  if (pattern3.test(content)) {
    content = content.replace(
      /import\s+{\s*NotificationManager\s*,\s*([^}]+)}\s+from\s+['"]([^'"]+\/rotif\.js)['"]/g,
      (match, others, path) => {
        return `import { ${others} } from '${path}';\nimport type { NotificationManager } from '${path}'`;
      }
    );
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Fixed: ${path.relative(process.cwd(), filePath)}`);
    return true;
  }

  return false;
}

// Main
const testFiles = findTestFiles(testDir);
console.log(`Found ${testFiles.length} test files`);

let updated = 0;
for (const file of testFiles) {
  if (updateTestFile(file)) {
    updated++;
  }
}

console.log(`\nFixed ${updated} files`);
