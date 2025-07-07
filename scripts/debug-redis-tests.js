#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('=== Redis Test Setup Debug ===\n');

// Check environment variables
console.log('Environment Variables:');
console.log(`REDIS_URL: ${process.env.REDIS_URL || 'NOT SET'}`);
console.log(`USE_MOCK_REDIS: ${process.env.USE_MOCK_REDIS || 'NOT SET'}`);
console.log(`USE_TEST_REDIS_HELPER: ${process.env.USE_TEST_REDIS_HELPER || 'NOT SET'}`);
console.log(`CI: ${process.env.CI || 'NOT SET'}`);
console.log();

// Check jest configuration
const netronJestConfig = path.join(__dirname, '../packages/netron/jest.config.ts');
const rotifJestConfig = path.join(__dirname, '../packages/rotif/jest.config.ts');

console.log('Jest Configuration Files:');
console.log(`Netron jest.config.ts exists: ${fs.existsSync(netronJestConfig)}`);
console.log(`Rotif jest.config.ts exists: ${fs.existsSync(rotifJestConfig)}`);
console.log();

// Check for jest setup files
const netronJestSetup = path.join(__dirname, '../packages/netron/jest.setup.ts');
const rotifJestSetup = path.join(__dirname, '../packages/rotif/jest.setup.ts');

console.log('Jest Setup Files:');
console.log(`Netron jest.setup.ts exists: ${fs.existsSync(netronJestSetup)}`);
console.log(`Rotif jest.setup.ts exists: ${fs.existsSync(rotifJestSetup)}`);
console.log();

// Check Netron jest.config.ts for setupFilesAfterEnv
if (fs.existsSync(netronJestConfig)) {
  const content = fs.readFileSync(netronJestConfig, 'utf8');
  const hasSetupFiles = content.includes('setupFilesAfterEnv');
  console.log(`Netron jest.config.ts has setupFilesAfterEnv: ${hasSetupFiles}`);
  
  if (!hasSetupFiles) {
    console.log('\n⚠️  WARNING: Netron jest.config.ts does not have setupFilesAfterEnv configured!');
    console.log('This means jest.setup.ts will not be loaded before tests.');
  }
}

// Provide recommendations
console.log('\n=== Recommendations ===\n');

if (!process.env.REDIS_URL) {
  console.log('1. Set REDIS_URL environment variable:');
  console.log('   export REDIS_URL=redis://localhost:6379');
  console.log();
}

console.log('2. Make sure Redis is running:');
console.log('   docker run -d -p 6379:6379 redis:alpine');
console.log('   # or');
console.log('   redis-server');
console.log();

console.log('3. Run tests with proper setup:');
console.log('   cd packages/netron && yarn test');
console.log('   # or for a specific test:');
console.log('   cd packages/netron && yarn test integration-sd-graceful-shutdown.spec.ts');
console.log();

console.log('4. If using CI, set CI=true to use mock Redis:');
console.log('   CI=true yarn test');