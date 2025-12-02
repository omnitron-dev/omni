#!/usr/bin/env node

/**
 * Script to update all Rotif test files to use the new createTestNotificationManager helper
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

// Update a test file
function updateTestFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;

  // Check if file uses NotificationManager
  if (!content.includes('new NotificationManager(')) {
    return false;
  }

  console.log(`Updating: ${path.relative(process.cwd(), filePath)}`);

  // Add import if not present
  if (!content.includes('createTestNotificationManager')) {
    // Find the test-utils import line
    const testUtilsImportMatch = content.match(/import\s+{([^}]+)}\s+from\s+['"]\.\/helpers\/test-utils\.js['"]/);

    if (testUtilsImportMatch) {
      const imports = testUtilsImportMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      if (!imports.includes('createTestNotificationManager')) {
        imports.push('createTestNotificationManager');
        const newImport = `import { ${imports.join(', ')} } from './helpers/test-utils.js'`;
        content = content.replace(testUtilsImportMatch[0], newImport);
        modified = true;
      }
    } else {
      // Check for relative path adjustment (for unit/ subdirectory)
      const testUtilsImportMatch2 = content.match(/import\s+{([^}]+)}\s+from\s+['"]\.\.\/helpers\/test-utils\.js['"]/);
      if (testUtilsImportMatch2) {
        const imports = testUtilsImportMatch2[1].split(',').map(s => s.trim()).filter(Boolean);
        if (!imports.includes('createTestNotificationManager')) {
          imports.push('createTestNotificationManager');
          const newImport = `import { ${imports.join(', ')} } from '../helpers/test-utils.js'`;
          content = content.replace(testUtilsImportMatch2[0], newImport);
          modified = true;
        }
      }
    }
  }

  // Replace synchronous instantiation with async
  // Pattern: manager = new NotificationManager(createTestConfig(...))
  const syncPattern = /(\s+)(manager\d*)\s*=\s*new NotificationManager\(createTestConfig\(([^)]*)\)\s*\)/g;
  if (syncPattern.test(content)) {
    content = content.replace(syncPattern, '$1$2 = await createTestNotificationManager($3)');
    modified = true;
  }

  // Pattern: const manager = new NotificationManager(createTestConfig(...))
  const constSyncPattern = /(const\s+manager\d*)\s*=\s*new NotificationManager\(createTestConfig\(([^)]*)\)\s*\)/g;
  if (constSyncPattern.test(content)) {
    content = content.replace(constSyncPattern, '$1 = await createTestNotificationManager($2)');
    modified = true;
  }

  // Pattern: manager = new NotificationManager({...})
  const directConfigPattern = /(\s+)(manager\d*)\s*=\s*new NotificationManager\(\s*{\s*redis:\s*getTestRedisUrl\(([^)]*)\)([^}]*)\}\s*\)/g;
  if (directConfigPattern.test(content)) {
    content = content.replace(directConfigPattern, (match, indent, varName, db, rest) => {
      const dbArg = db.trim() || '1';
      const additionalConfig = rest.trim() ? `, {${rest}}` : '';
      return `${indent}${varName} = await createTestNotificationManager(${dbArg}${additionalConfig})`;
    });
    modified = true;
  }

  if (modified) {
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

console.log(`\nUpdated ${updated} files`);
