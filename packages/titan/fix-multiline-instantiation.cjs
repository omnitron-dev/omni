#!/usr/bin/env node

/**
 * Script to fix multi-line NotificationManager instantiations
 */

const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, 'test/rotif');

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

function updateTestFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;

  // Pattern: manager = new NotificationManager(...)  (can span multiple lines)
  // Match: manager = new NotificationManager(\n      createTestConfig(...)
  const pattern = /(\s+)(manager\d*)\s*=\s*new\s+NotificationManager\s*\(\s*\n\s*createTestConfig\(([^)]*)\)/g;

  if (pattern.test(content)) {
    content = content.replace(
      /(\s+)(manager\d*)\s*=\s*new\s+NotificationManager\s*\(\s*\n\s*createTestConfig\(([^)]*)\)/g,
      '$1$2 = await createTestNotificationManager($3)'
    );
    modified = true;
  }

  // Pattern for inline with config object
  // manager = new NotificationManager(\n      createTestConfig(1, {\n        ...\n      })\n    )
  const pattern2 = /(\s+)(manager\d*)\s*=\s*new\s+NotificationManager\s*\(\s*createTestConfig\(/g;

  if (pattern2.test(content)) {
    content = content.replace(
      /(\s+)(manager\d*)\s*=\s*new\s+NotificationManager\s*\(\s*createTestConfig\(/g,
      '$1$2 = await createTestNotificationManager('
    );
    modified = true;
  }

  if (modified) {
    console.log(`Fixed: ${path.relative(process.cwd(), filePath)}`);
    fs.writeFileSync(filePath, content, 'utf-8');
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
