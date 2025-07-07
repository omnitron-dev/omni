#!/usr/bin/env node

const { execSync } = require('child_process');

/**
 * Clean up any leftover Redis test containers
 */
function cleanupTestRedisContainers() {
  console.log('Cleaning up Redis test containers...');
  
  try {
    // Get all containers with name matching redis-test-*
    const containers = execSync('docker ps -a --format "{{.Names}}" | grep "redis-test-" || true', {
      encoding: 'utf8'
    }).trim().split('\n').filter(Boolean);
    
    if (containers.length === 0) {
      console.log('No test Redis containers found.');
      return;
    }
    
    console.log(`Found ${containers.length} test Redis containers to clean up.`);
    
    // Stop and remove each container
    for (const container of containers) {
      try {
        console.log(`Stopping container: ${container}`);
        execSync(`docker stop ${container}`, { stdio: 'pipe' });
        execSync(`docker rm ${container}`, { stdio: 'pipe' });
        console.log(`Removed container: ${container}`);
      } catch (error) {
        console.warn(`Failed to remove container ${container}:`, error.message);
      }
    }
    
    console.log('Cleanup completed.');
  } catch (error) {
    console.error('Error during cleanup:', error.message);
  }
}

// Run if called directly
if (require.main === module) {
  cleanupTestRedisContainers();
}

module.exports = { cleanupTestRedisContainers };