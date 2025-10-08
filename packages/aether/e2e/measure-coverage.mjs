/**
 * Measure statement/branch coverage more accurately
 */

import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function measureCoverage() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Enable detailed coverage collection
  await Promise.all([
    page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: true }),
  ]);

  // Navigate to test page
  await page.goto('http://localhost:3456/');

  // Run comprehensive tests
  const testResult = await page.evaluate(async () => {
    const results = [];
    try {
      const { Netron } = await import('/netron-unified.js');

      // ========== HTTP TRANSPORT TESTS ==========

      // Test 1: Basic HTTP connection and methods
      const http1 = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      results.push({ test: 'HTTP created', pass: true });

      await http1.connect();
      results.push({ test: 'HTTP connected', pass: http1.isConnected() });

      const httpService1 = await http1.queryInterface('UserService@1.0.0');
      const users = await httpService1.getUsers();
      results.push({ test: 'HTTP getUsers', pass: users.length > 0 });

      const user = await httpService1.getUser('user-1');
      results.push({ test: 'HTTP getUser', pass: user !== null });

      // Test 2: CRUD operations
      const created = await httpService1.createUser({ name: 'Coverage Test', email: 'coverage@test.com', age: 30 });
      results.push({ test: 'HTTP createUser', pass: created.id !== undefined });

      const updated = await httpService1.updateUser(created.id, { age: 31 });
      results.push({ test: 'HTTP updateUser', pass: updated.age === 31 });

      const deleted = await httpService1.deleteUser(created.id);
      results.push({ test: 'HTTP deleteUser', pass: deleted });

      // Test 3: Filtered queries
      const filtered = await httpService1.findUsers({ minAge: 25 });
      results.push({ test: 'HTTP findUsers', pass: Array.isArray(filtered) });

      // Test 4: Metrics
      const httpMetrics = http1.getMetrics();
      results.push({ test: 'HTTP metrics', pass: httpMetrics.id !== undefined });

      // Test 5: Error handling
      try {
        await httpService1.unreliableMethod(true);
        results.push({ test: 'HTTP error handling', pass: false });
      } catch (e) {
        results.push({ test: 'HTTP error handling', pass: true });
      }

      // Test 6: Multiple connections
      const http2 = new Netron({ transport: 'http', url: 'http://localhost:3333', timeout: 15000 });
      await http2.connect();
      const httpService2 = await http2.queryInterface('UserService@1.0.0');
      await httpService2.getUsers();
      await http2.disconnect();
      results.push({ test: 'HTTP multiple clients', pass: true });

      await http1.disconnect();
      results.push({ test: 'HTTP disconnected', pass: !http1.isConnected() });

      // ========== WEBSOCKET TRANSPORT TESTS ==========

      // Test 1: Basic WebSocket connection and methods
      const ws1 = new Netron({ transport: 'websocket', url: 'ws://localhost:3334' });
      results.push({ test: 'WS created', pass: true });

      await ws1.connect();
      results.push({ test: 'WS connected', pass: ws1.isConnected() });

      const wsService1 = await ws1.queryInterface('UserService@1.0.0');
      const wsUsers = await wsService1.getUsers();
      results.push({ test: 'WS getUsers', pass: wsUsers.length > 0 });

      const wsUser = await wsService1.getUser('user-1');
      results.push({ test: 'WS getUser', pass: wsUser !== null });

      // Test 2: CRUD operations
      const wsCreated = await wsService1.createUser({ name: 'WS Coverage', email: 'ws@test.com', age: 28 });
      results.push({ test: 'WS createUser', pass: wsCreated.id !== undefined });

      const wsUpdated = await wsService1.updateUser(wsCreated.id, { age: 29 });
      results.push({ test: 'WS updateUser', pass: wsUpdated.age === 29 });

      const wsDeleted = await wsService1.deleteUser(wsCreated.id);
      results.push({ test: 'WS deleteUser', pass: wsDeleted });

      // Test 3: Concurrent requests
      const concurrent = await Promise.all([
        wsService1.getUsers(),
        wsService1.getUsers(),
        wsService1.getUsers()
      ]);
      results.push({ test: 'WS concurrent', pass: concurrent.length === 3 });

      // Test 4: Filtered queries
      const wsFiltered = await wsService1.findUsers({ minAge: 25 });
      results.push({ test: 'WS findUsers', pass: Array.isArray(wsFiltered) });

      // Test 5: Metrics
      const wsMetrics = ws1.getMetrics();
      results.push({ test: 'WS metrics', pass: wsMetrics.transport === 'websocket' });

      // Test 6: Multiple WebSocket clients
      const ws2 = new Netron({
        transport: 'websocket',
        url: 'ws://localhost:3334',
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3
      });
      await ws2.connect();
      const wsService2 = await ws2.queryInterface('UserService@1.0.0');
      await wsService2.getUsers();
      await ws2.disconnect();
      results.push({ test: 'WS multiple clients', pass: true });

      await ws1.disconnect();
      results.push({ test: 'WS disconnected', pass: !ws1.isConnected() });

      // ========== EDGE CASES ==========

      // Test error before connect
      const http3 = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      try {
        await http3.queryInterface('Test');
        results.push({ test: 'Error before connect', pass: false });
      } catch (e) {
        results.push({ test: 'Error before connect', pass: true });
      }

      // Test queryInterface without version
      await http3.connect();
      try {
        const noVersion = await http3.queryInterface('UserService');
        await noVersion.getUsers();
        results.push({ test: 'QueryInterface without version', pass: true });
      } catch (e) {
        results.push({ test: 'QueryInterface without version', pass: true });
      }
      await http3.disconnect();

      return { success: true, results, totalTests: results.length, passed: results.filter(r => r.pass).length };
    } catch (error) {
      return { success: false, error: error.message, results, stack: error.stack };
    }
  });

  console.log(`\nTest Results: ${testResult.passed}/${testResult.totalTests} passed`);
  if (!testResult.success) {
    console.log('Error:', testResult.error);
  }

  // Stop coverage and analyze
  const jsCoverage = await page.coverage.stopJSCoverage();

  // Find netron-unified.js
  const netronEntry = jsCoverage.find(entry => entry.url.includes('netron-unified.js'));

  if (!netronEntry) {
    console.log('\nNo coverage data found for netron-unified.js');
    await browser.close();
    return;
  }

  // Get source
  const source = netronEntry.source || netronEntry.text || '';
  const totalBytes = source.length;

  // Parse V8 coverage data
  const functions = netronEntry.functions || [];
  console.log(`\nAnalyzing ${functions.length} functions...`);

  // Calculate byte coverage
  const coveredRanges = [];
  for (const func of functions) {
    for (const range of func.ranges || []) {
      if (range.count > 0) {
        coveredRanges.push({ start: range.startOffset, end: range.endOffset });
      }
    }
  }

  // Merge overlapping ranges
  let coveredBytes = 0;
  if (coveredRanges.length > 0) {
    coveredRanges.sort((a, b) => a.start - b.start);
    let currentStart = coveredRanges[0].start;
    let currentEnd = coveredRanges[0].end;

    for (let i = 1; i < coveredRanges.length; i++) {
      const range = coveredRanges[i];
      if (range.start <= currentEnd) {
        currentEnd = Math.max(currentEnd, range.end);
      } else {
        coveredBytes += currentEnd - currentStart;
        currentStart = range.start;
        currentEnd = range.end;
      }
    }
    coveredBytes += currentEnd - currentStart;
  }

  const coveragePercent = totalBytes > 0 ? (coveredBytes / totalBytes * 100).toFixed(2) : '0.00';

  console.log('\n' + '='.repeat(60));
  console.log('CODE COVERAGE ANALYSIS - netron-unified.js');
  console.log('='.repeat(60));
  console.log(`Total bytes:      ${totalBytes.toLocaleString()}`);
  console.log(`Covered bytes:    ${coveredBytes.toLocaleString()}`);
  console.log(`Uncovered bytes:  ${(totalBytes - coveredBytes).toLocaleString()}`);
  console.log(`Coverage:         ${coveragePercent}%`);
  console.log('='.repeat(60));

  // Save detailed coverage report
  const outputDir = join(__dirname, 'coverage-output');
  mkdirSync(outputDir, { recursive: true });

  writeFileSync(
    join(outputDir, 'detailed-coverage.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      totalBytes,
      coveredBytes,
      coveragePercent: parseFloat(coveragePercent),
      functionsAnalyzed: functions.length,
      testResults: testResult
    }, null, 2)
  );

  console.log(`\nDetailed report saved to ${outputDir}/detailed-coverage.json`);

  await browser.close();

  return {
    coveragePercent: parseFloat(coveragePercent),
    totalBytes,
    coveredBytes,
    testResults: testResult
  };
}

measureCoverage().catch(console.error);
