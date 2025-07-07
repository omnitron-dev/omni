#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get all test files that need updating
const testFiles = [
  // Service Discovery Tests
  'test/service-discovery/concurrent-updates.spec.ts',
  'test/service-discovery/find-nodes-by-service.spec.ts',
  'test/service-discovery/get-active-nodes.spec.ts',
  'test/service-discovery/graceful-shutdown.spec.ts',
  'test/service-discovery/node-active-status.spec.ts',
  'test/service-discovery/node-reregistration.spec.ts',
  'test/service-discovery/pubsub-event-propagation.spec.ts',
  'test/service-discovery/redis-failure-handling.spec.ts',
  'test/service-discovery/retry-deregistration.spec.ts',
  'test/service-discovery/retry-heartbeat.spec.ts',
  'test/service-discovery/update-address.spec.ts',
  'test/service-discovery/update-services-and-address.spec.ts',
  'test/service-discovery/update-services.spec.ts',
  'test/service-discovery/heartbeat.spec.ts',
  'test/service-discovery/init.spec.ts',
  
  // Integration Tests
  'test/integration-sd-concurrent-service-updates.spec.ts',
  'test/integration-sd-graceful-shutdown.spec.ts',
  'test/integration-sd-heartbeat-retry.spec.ts',
  'test/integration-sd-initialization-heartbeat.spec.ts',
  'test/integration-sd-node-events.spec.ts',
  'test/integration-sd-node-registration-events.spec.ts',
  'test/integration-sd-service-exposure.spec.ts',
];

function updateFile(filePath) {
  const fullPath = path.join(__dirname, filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return;
  }
  
  let content = fs.readFileSync(fullPath, 'utf8');
  let updated = false;
  
  // Pattern 1: new Redis('redis://localhost:6379/X')
  const redisPattern = /new Redis\(['"]redis:\/\/localhost:6379\/(\d+)['"]\)/g;
  if (redisPattern.test(content)) {
    content = content.replace(redisPattern, 'createTestRedisClient($1)');
    updated = true;
  }
  
  // Pattern 2: process.env['REDIS_URL'] || 'redis://localhost:6379/X'
  const envPattern = /process\.env\[['"]REDIS_URL['"]\]\s*\|\|\s*['"]redis:\/\/localhost:6379(?:\/(\d+))?['"]/g;
  if (envPattern.test(content)) {
    // Check if we need to add import
    if (!content.includes('getTestRedisUrl')) {
      // Find the last import from ../helpers/test-utils
      if (content.includes('../helpers/test-utils')) {
        // Add getTestRedisUrl to existing import
        content = content.replace(
          /import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/helpers\/test-utils['"]/,
          (match, imports) => {
            if (!imports.includes('getTestRedisUrl')) {
              return match.replace(imports, `${imports}, getTestRedisUrl`);
            }
            return match;
          }
        );
      } else {
        // Add new import after other imports
        const lastImportMatch = content.match(/import[^;]+from[^;]+;/g);
        if (lastImportMatch) {
          const lastImport = lastImportMatch[lastImportMatch.length - 1];
          const insertPos = content.lastIndexOf(lastImport) + lastImport.length;
          content = content.slice(0, insertPos) + 
            "\nimport { getTestRedisUrl } from '../helpers/test-utils';" +
            content.slice(insertPos);
        }
      }
    }
    
    // Replace the pattern
    content = content.replace(envPattern, (match, dbNum) => {
      return dbNum ? `getTestRedisUrl(${dbNum})` : 'getTestRedisUrl()';
    });
    updated = true;
  }
  
  // Pattern 3: discoveryRedisUrl: 'redis://localhost:6379/X'
  const discoveryPattern = /discoveryRedisUrl:\s*['"]redis:\/\/localhost:6379(?:\/(\d+))?['"]/g;
  if (discoveryPattern.test(content)) {
    // Check if we need to add import
    if (!content.includes('getTestRedisUrl')) {
      if (content.includes('../helpers/test-utils')) {
        content = content.replace(
          /import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/helpers\/test-utils['"]/,
          (match, imports) => {
            if (!imports.includes('getTestRedisUrl')) {
              return match.replace(imports, `${imports}, getTestRedisUrl`);
            }
            return match;
          }
        );
      }
    }
    
    content = content.replace(discoveryPattern, (match, dbNum) => {
      return dbNum ? `discoveryRedisUrl: getTestRedisUrl(${dbNum})` : 'discoveryRedisUrl: getTestRedisUrl()';
    });
    updated = true;
  }
  
  if (updated) {
    fs.writeFileSync(fullPath, content);
    console.log(`✅ Updated: ${filePath}`);
  } else {
    console.log(`⏭️  No changes needed: ${filePath}`);
  }
}

console.log('Starting Redis test URL migration...\n');

testFiles.forEach(updateFile);

console.log('\n✅ Migration complete!');
console.log('\nNote: The test helpers will automatically:');
console.log('- Use a dynamic port (6400+) to avoid conflicts');
console.log('- Start a Redis server or use Docker if available');
console.log('- Use mock Redis in CI environments');
console.log('- Clean up properly after tests');