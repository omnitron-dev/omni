const fs = require('fs');

const content = fs.readFileSync('test-results-final.log', 'utf8');
const lines = content.split('\n');

const errorPatterns = {
  'Database Config Missing': 0,
  'Redis Connection': 0,
  'Timeout': 0,
  'Health Check': 0,
  'NOGROUP': 0,
};

const testFiles = new Set();
const errors = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Track test files
  const testMatch = line.match(/test\/.*\.spec\.ts/);
  if (testMatch) {
    testFiles.add(testMatch[0]);
  }
  
  // Track error patterns
  if (line.includes('Connection configuration is required for undefined')) {
    errorPatterns['Database Config Missing']++;
  }
  if (line.includes('Redis connection error')) {
    errorPatterns['Redis Connection']++;
  }
  if (line.includes('timed out') || line.includes('timeout')) {
    errorPatterns['Timeout']++;
  }
  if (line.includes('health check')) {
    errorPatterns['Health Check']++;
  }
  if (line.includes('NOGROUP')) {
    errorPatterns['NOGROUP']++;
  }
}

console.log('Error Pattern Analysis:');
console.log('======================');
Object.entries(errorPatterns).forEach(([key, count]) => {
  if (count > 0) {
    console.log(`${key}: ${count} occurrences`);
  }
});

console.log('\nTest Files Involved:');
console.log('===================');
testFiles.forEach(file => console.log(file));

console.log(`\nTotal unique test files: ${testFiles.size}`);
