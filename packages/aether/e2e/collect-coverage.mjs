/**
 * Collect code coverage from Playwright tests
 */

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function collectCoverage() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  
  // Start collecting coverage
  const page = await context.newPage();
  await page.coverage.startJSCoverage();
  
  // Navigate to the test page
  await page.goto('http://localhost:3456/');
  
  // Import and test Netron
  const testResult = await page.evaluate(async () => {
    try {
      const { Netron } = await import('/netron-unified.js');
      
      // Test HTTP
      const httpClient = new Netron({
        transport: 'http',
        url: 'http://localhost:3333'
      });
      
      await httpClient.connect();
      const httpService = await httpClient.queryInterface('UserService@1.0.0');
      await httpService.getUsers();
      await httpService.getUser('user-1');
      await httpService.createUser({ name: 'Test', email: 'test@test.com', age: 25 });
      httpClient.getMetrics();
      httpClient.isConnected();
      await httpClient.disconnect();
      
      // Test WebSocket
      const wsClient = new Netron({
        transport: 'websocket',
        url: 'ws://localhost:3334'
      });
      
      await wsClient.connect();
      const wsService = await wsClient.queryInterface('UserService@1.0.0');
      await wsService.getUsers();
      await wsService.getUser('user-1');
      wsClient.getMetrics();
      wsClient.isConnected();
      await wsClient.disconnect();
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  console.log('Test execution result:', testResult);
  
  // Collect coverage
  const coverage = await page.coverage.stopJSCoverage();
  
  // Filter for netron-unified.js
  const netronCoverage = coverage.filter(entry => 
    entry.url.includes('netron-unified.js')
  );
  
  if (netronCoverage.length === 0) {
    console.log('No coverage data collected for netron-unified.js');
    await browser.close();
    return;
  }
  
  // Calculate coverage from V8 format
  const entry = netronCoverage[0];

  // Get source text
  const sourceText = entry.text || entry.source || '';
  const totalBytes = sourceText.length;
  let coveredBytes = 0;

  // V8 coverage format has functions with ranges
  const functions = entry.functions || [];
  console.log(`Found ${functions.length} functions with coverage data`);

  // Collect all covered ranges
  const coveredRanges = [];
  for (const func of functions) {
    for (const range of func.ranges || []) {
      // Only count ranges that were executed (count > 0)
      if (range.count > 0) {
        coveredRanges.push({ start: range.startOffset, end: range.endOffset });
      }
    }
  }

  // Merge overlapping ranges and calculate covered bytes
  if (coveredRanges.length > 0) {
    coveredRanges.sort((a, b) => a.start - b.start);
    let currentStart = coveredRanges[0].start;
    let currentEnd = coveredRanges[0].end;

    for (let i = 1; i < coveredRanges.length; i++) {
      const range = coveredRanges[i];
      if (range.start <= currentEnd) {
        // Overlapping range, extend current
        currentEnd = Math.max(currentEnd, range.end);
      } else {
        // Non-overlapping, add current and start new
        coveredBytes += currentEnd - currentStart;
        currentStart = range.start;
        currentEnd = range.end;
      }
    }
    // Add the last range
    coveredBytes += currentEnd - currentStart;
  }

  const coveragePercent = totalBytes > 0 ? (coveredBytes / totalBytes * 100).toFixed(2) : '0.00';

  console.log('\nCode Coverage for netron-unified.js:');
  console.log(`Total bytes: ${totalBytes}`);
  console.log(`Covered bytes: ${coveredBytes}`);
  console.log(`Coverage: ${coveragePercent}%`);
  console.log(`Uncovered bytes: ${totalBytes - coveredBytes}`);
  
  // Save raw coverage data
  const outputDir = join(__dirname, 'coverage-output');
  mkdirSync(outputDir, { recursive: true });
  
  writeFileSync(
    join(outputDir, 'coverage.json'),
    JSON.stringify(coverage, null, 2)
  );
  
  console.log(`\nCoverage data saved to ${outputDir}/coverage.json`);
  
  await browser.close();
  
  return { coveragePercent: parseFloat(coveragePercent), totalBytes, coveredBytes };
}

collectCoverage().catch(console.error);
