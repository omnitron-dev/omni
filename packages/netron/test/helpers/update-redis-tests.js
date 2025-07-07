#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Function to update Redis initialization in test files
function updateTestFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let updated = false;

  // Pattern 1: new Redis("redis://localhost:6379/X")
  const pattern1 = /new Redis\(["']redis:\/\/localhost:6379\/(\d+)["']\)/g;
  if (pattern1.test(content)) {
    // Add import if not present
    if (!content.includes('createTestRedisClient')) {
      const importPattern = /import.*from.*['"]\.\.\/\.\.\/src['"]/;
      const match = content.match(importPattern);
      if (match) {
        const lastImportIndex = content.lastIndexOf(match[0]) + match[0].length;
        content = content.slice(0, lastImportIndex) + 
          "\nimport { createTestRedisClient, cleanupRedis } from '../helpers/test-utils';" +
          content.slice(lastImportIndex);
      }
    }
    
    // Replace Redis initialization
    content = content.replace(pattern1, 'createTestRedisClient($1)');
    updated = true;
  }

  // Pattern 2: new Redis({ host: "localhost", port: 6379, db: X })
  const pattern2 = /new Redis\(\s*\{\s*host:\s*["']localhost["'],\s*port:\s*6379,\s*db:\s*(\d+)\s*\}\s*\)/g;
  if (pattern2.test(content)) {
    content = content.replace(pattern2, 'createTestRedisClient($1)');
    updated = true;
  }

  // Pattern 3: Replace flushall with cleanupRedis
  if (content.includes('redis.flushall()')) {
    content = content.replace(/await redis\.flushall\(\)/g, 'await cleanupRedis(redis)');
    updated = true;
  }

  // Pattern 4: Replace flushdb with cleanupRedis
  if (content.includes('redis.flushdb()')) {
    content = content.replace(/await redis\.flushdb\(\)/g, 'await cleanupRedis(redis)');
    updated = true;
  }

  // Pattern 5: Replace process.env['REDIS_URL'] || 'redis://localhost:6379' patterns
  const envPattern = /process\.env\[['"]REDIS_URL['"]\]\s*\|\|\s*['"]redis:\/\/localhost:6379(?:\/(\d+))?['"]/g;
  if (envPattern.test(content)) {
    // Add import if not present
    if (!content.includes('getTestRedisUrl')) {
      const importPattern = /import.*from.*['"]\.\.\/\.\.\/src['"]/;
      const match = content.match(importPattern);
      if (match) {
        const lastImportIndex = content.lastIndexOf(match[0]) + match[0].length;
        if (!content.includes('test-utils')) {
          content = content.slice(0, lastImportIndex) + 
            "\nimport { getTestRedisUrl } from '../helpers/test-utils';" +
            content.slice(lastImportIndex);
        }
      }
    }
    
    // Replace with getTestRedisUrl
    content = content.replace(envPattern, (match, dbNum) => {
      return dbNum ? `getTestRedisUrl(${dbNum})` : 'getTestRedisUrl()';
    });
    updated = true;
  }

  // Pattern 6: Replace discoveryRedisUrl: 'redis://localhost:6379/X' in Netron.create
  const discoveryPattern = /discoveryRedisUrl:\s*['"]redis:\/\/localhost:6379(?:\/(\d+))?['"]/g;
  if (discoveryPattern.test(content)) {
    content = content.replace(discoveryPattern, (match, dbNum) => {
      return dbNum ? `discoveryRedisUrl: getTestRedisUrl(${dbNum})` : 'discoveryRedisUrl: getTestRedisUrl()';
    });
    updated = true;
  }

  if (updated) {
    fs.writeFileSync(filePath, content);
    console.log(`✅ Updated: ${path.basename(filePath)}`);
  } else {
    console.log(`⏭️  Skipped: ${path.basename(filePath)} (no changes needed)`);
  }
}

// Find all test files in service-discovery directory
const testFiles = glob.sync(path.join(__dirname, '../service-discovery/*.spec.ts'));

console.log(`Found ${testFiles.length} test files to update\n`);

testFiles.forEach(updateTestFile);

// Also update integration tests
const integrationTests = glob.sync(path.join(__dirname, '../integration-sd-*.spec.ts'));
console.log(`\nFound ${integrationTests.length} integration test files to update\n`);

integrationTests.forEach(updateTestFile);

console.log('\n✅ All test files updated!');