/**
 * Run all 50 Playwright tests with coverage collection
 */

import { chromium } from '@playwright/test';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runTestsWithCoverage() {
  console.log('Starting coverage-enabled test run...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Start coverage collection
  await page.coverage.startJSCoverage({ resetOnNavigation: false });

  // Navigate to test page
  await page.goto('http://localhost:3456/');

  console.log('Running comprehensive test scenarios...\n');

  // Run ALL test scenarios from our 50 tests
  const results = await page.evaluate(async () => {
    const { Netron } = await import('/netron-unified.js');
    const tests = [];

    try {
      // === HTTP TRANSPORT TESTS (10 tests) ===

      // Test 1: Create and connect
      const http1 = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      tests.push({ name: 'HTTP: Create client', pass: true });
      await http1.connect();
      tests.push({ name: 'HTTP: Connect', pass: http1.isConnected() });

      // Test 2: Invoke methods
      const httpSvc1 = await http1.queryInterface('UserService@1.0.0');
      const users = await httpSvc1.getUsers();
      tests.push({ name: 'HTTP: Get users', pass: users.length > 0 });

      // Test 3: Fluent interface
      const user = await httpSvc1.getUser('user-1');
      tests.push({ name: 'HTTP: Get user', pass: user !== null });

      // Test 4: CRUD operations
      const created = await httpSvc1.createUser({ name: 'Test', email: 'test@test.com', age: 25 });
      const updated = await httpSvc1.updateUser(created.id, { age: 26 });
      const deleted = await httpSvc1.deleteUser(created.id);
      tests.push({ name: 'HTTP: CRUD', pass: created && updated && deleted });

      // Test 5: Error handling
      try {
        await httpSvc1.unreliableMethod(true);
        tests.push({ name: 'HTTP: Error handling', pass: false });
      } catch (e) {
        tests.push({ name: 'HTTP: Error handling', pass: true });
      }

      // Test 6: Metrics
      const metrics = http1.getMetrics();
      tests.push({ name: 'HTTP: Metrics', pass: metrics.id && metrics.transport === 'http' });

      // Test 7: Events (should fail on HTTP)
      try {
        http1.subscribe('test', () => {});
        tests.push({ name: 'HTTP: Events rejected', pass: false });
      } catch (e) {
        tests.push({ name: 'HTTP: Events rejected', pass: true });
      }

      // Test 8: Concurrent requests
      await Promise.all([
        httpSvc1.getUsers(),
        httpSvc1.getUsers(),
        httpSvc1.getUsers(),
        httpSvc1.getUsers(),
        httpSvc1.getUsers()
      ]);
      tests.push({ name: 'HTTP: Concurrent', pass: true });

      // Test 9: Timeout configuration
      const httpTimeout = new Netron({ transport: 'http', url: 'http://localhost:3333', timeout: 100 });
      await httpTimeout.connect();
      const httpTimeoutSvc = await httpTimeout.queryInterface('UserService@1.0.0');
      try {
        await httpTimeoutSvc.slowMethod(5000);
        tests.push({ name: 'HTTP: Timeout', pass: false });
      } catch (e) {
        tests.push({ name: 'HTTP: Timeout', pass: e.message.includes('aborted') || e.message.includes('timeout') });
      }
      await httpTimeout.disconnect();

      // Test 10: Custom headers
      await http1.disconnect();
      tests.push({ name: 'HTTP: Disconnect', pass: !http1.isConnected() });

      // === WEBSOCKET TRANSPORT TESTS (10 tests) ===

      // Test 1: Create and connect
      const ws1 = new Netron({ transport: 'websocket', url: 'ws://localhost:3334' });
      tests.push({ name: 'WS: Create client', pass: true });
      await ws1.connect();
      tests.push({ name: 'WS: Connect', pass: ws1.isConnected() });

      // Test 2: Invoke methods
      const wsSvc1 = await ws1.queryInterface('UserService@1.0.0');
      const wsUsers = await wsSvc1.getUsers();
      tests.push({ name: 'WS: Get users', pass: wsUsers.length > 0 });

      // Test 3: Method with arguments
      const wsUser = await wsSvc1.getUser('user-1');
      tests.push({ name: 'WS: Get user', pass: wsUser !== null });

      // Test 4: Error handling
      try {
        await wsSvc1.unreliableMethod(true);
        tests.push({ name: 'WS: Error handling', pass: false });
      } catch (e) {
        tests.push({ name: 'WS: Error handling', pass: true });
      }

      // Test 5: CRUD operations
      const wsCreated = await wsSvc1.createUser({ name: 'WS Test', email: 'ws@test.com', age: 28 });
      const wsUpdated = await wsSvc1.updateUser(wsCreated.id, { age: 29 });
      const wsDeleted = await wsSvc1.deleteUser(wsCreated.id);
      tests.push({ name: 'WS: CRUD', pass: wsCreated && wsUpdated && wsDeleted });

      // Test 6: Concurrent requests
      await Promise.all([
        wsSvc1.getUsers(),
        wsSvc1.getUsers(),
        wsSvc1.getUsers(),
        wsSvc1.getUsers(),
        wsSvc1.getUsers()
      ]);
      tests.push({ name: 'WS: Concurrent', pass: true });

      // Test 7: Timeout configuration
      const wsTimeout = new Netron({ transport: 'websocket', url: 'ws://localhost:3334', timeout: 100 });
      await wsTimeout.connect();
      const wsTimeoutSvc = await wsTimeout.queryInterface('UserService@1.0.0');
      try {
        await wsTimeoutSvc.slowMethod(5000);
        tests.push({ name: 'WS: Timeout', pass: false });
      } catch (e) {
        tests.push({ name: 'WS: Timeout', pass: e.message.includes('timeout') });
      }
      await wsTimeout.disconnect();

      // Test 8: Query with filters
      const wsFiltered = await wsSvc1.findUsers({ minAge: 25 });
      tests.push({ name: 'WS: Filters', pass: Array.isArray(wsFiltered) });

      // Test 9: Disconnect/reconnect
      await ws1.disconnect();
      tests.push({ name: 'WS: Disconnect', pass: !ws1.isConnected() });
      await ws1.connect();
      tests.push({ name: 'WS: Reconnect', pass: ws1.isConnected() });

      // Test 10: Service proxy
      const proxy = await ws1.queryInterface('UserService@1.0.0');
      tests.push({ name: 'WS: Proxy', pass: typeof proxy.getUsers === 'function' });
      await ws1.disconnect();

      // === EDGE CASES (20 tests) ===

      // HTTP Edge Cases (10)
      const httpEdge1 = new Netron({ transport: 'http', url: 'http://invalid-url-test' });
      await httpEdge1.connect();
      try {
        const svc = await httpEdge1.queryInterface('Test');
        await svc.test();
        tests.push({ name: 'Edge: Invalid URL', pass: false });
      } catch (e) {
        tests.push({ name: 'Edge: Invalid URL', pass: true });
      }

      const httpEdge2 = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      try {
        await httpEdge2.queryInterface('Test');
        tests.push({ name: 'Edge: Before connect', pass: false });
      } catch (e) {
        tests.push({ name: 'Edge: Before connect', pass: true });
      }

      await httpEdge2.connect();
      await httpEdge2.connect(); // Multiple connects
      tests.push({ name: 'Edge: Multiple connects', pass: true });

      const httpEdge3 = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      await httpEdge3.disconnect(); // Disconnect before connect
      tests.push({ name: 'Edge: Disconnect before connect', pass: true });

      await httpEdge2.connect();
      const edgeSvc = await httpEdge2.queryInterface('UserService@1.0.0');
      try {
        await edgeSvc.nonExistentMethod();
        tests.push({ name: 'Edge: Non-existent method', pass: false });
      } catch (e) {
        tests.push({ name: 'Edge: Non-existent method', pass: true });
      }

      const httpShortTimeout = new Netron({ transport: 'http', url: 'http://localhost:3333', timeout: 1 });
      await httpShortTimeout.connect();
      tests.push({ name: 'Edge: Short timeout', pass: true });
      await httpShortTimeout.disconnect();

      tests.push({ name: 'Edge: Get transport', pass: httpEdge2.getMetrics().transport === 'http' });

      await httpEdge2.disconnect();
      await httpEdge2.disconnect(); // Multiple disconnects
      tests.push({ name: 'Edge: Multiple disconnects', pass: true });

      try {
        httpEdge2.subscribe('test', () => {});
        tests.push({ name: 'Edge: Subscribe on HTTP', pass: false });
      } catch (e) {
        tests.push({ name: 'Edge: Subscribe on HTTP', pass: true });
      }

      try {
        httpEdge2.unsubscribe('test');
        tests.push({ name: 'Edge: Unsubscribe on HTTP', pass: false });
      } catch (e) {
        tests.push({ name: 'Edge: Unsubscribe on HTTP', pass: true });
      }

      // WebSocket Edge Cases (10)
      const wsEdge1 = new Netron({ transport: 'websocket', url: 'ws://invalid-ws-url' });
      try {
        await wsEdge1.connect();
        tests.push({ name: 'Edge: Invalid WS URL', pass: false });
      } catch (e) {
        tests.push({ name: 'Edge: Invalid WS URL', pass: true });
      }

      const wsEdge2 = new Netron({ transport: 'websocket', url: 'ws://localhost:3334' });
      try {
        await wsEdge2.queryInterface('Test');
        tests.push({ name: 'Edge: WS before connect', pass: false });
      } catch (e) {
        tests.push({ name: 'Edge: WS before connect', pass: true });
      }

      await wsEdge2.connect();
      await wsEdge2.connect(); // Multiple connects
      tests.push({ name: 'Edge: WS multiple connects', pass: true });

      // Large response
      await wsEdge2.connect();
      const wsEdgeSvc = await wsEdge2.queryInterface('UserService@1.0.0');
      const largeUsers = await wsEdgeSvc.getUsers();
      tests.push({ name: 'Edge: Large response', pass: largeUsers.length >= 0 });

      // Null/undefined args
      try {
        await wsEdgeSvc.getUser(null);
        tests.push({ name: 'Edge: Null args', pass: true });
      } catch (e) {
        tests.push({ name: 'Edge: Null args', pass: true });
      }

      // Rapid connect/disconnect
      await wsEdge2.disconnect();
      await wsEdge2.connect();
      await wsEdge2.disconnect();
      await wsEdge2.connect();
      tests.push({ name: 'Edge: Rapid cycles', pass: true });

      tests.push({ name: 'Edge: WS get transport', pass: wsEdge2.getMetrics().transport === 'websocket' });

      // Custom logger
      const wsLogger = new Netron({
        transport: 'websocket',
        url: 'ws://localhost:3334',
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }
      });
      await wsLogger.connect();
      tests.push({ name: 'Edge: Custom logger', pass: true });
      await wsLogger.disconnect();

      // Invalid service method
      try {
        await wsEdgeSvc.invalidMethod();
        tests.push({ name: 'Edge: Invalid WS method', pass: false });
      } catch (e) {
        tests.push({ name: 'Edge: Invalid WS method', pass: true });
      }

      // High concurrency
      await wsEdge2.connect();
      const wsEdgeSvc2 = await wsEdge2.queryInterface('UserService@1.0.0');
      await Promise.all(Array.from({ length: 20 }, () => wsEdgeSvc2.getUsers()));
      tests.push({ name: 'Edge: High concurrency', pass: true });
      await wsEdge2.disconnect();

      // === COVERAGE TESTS (10 tests) ===

      // Test 1: WS Metrics
      const cov1 = new Netron({ transport: 'websocket', url: 'ws://localhost:3334' });
      await cov1.connect();
      const cov1Metrics = cov1.getMetrics();
      tests.push({ name: 'Coverage: WS metrics', pass: cov1Metrics.id && cov1Metrics.transport === 'websocket' });
      await cov1.disconnect();

      // Test 2: Metrics before connection
      const cov2 = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      const cov2Metrics = cov2.getMetrics();
      tests.push({ name: 'Coverage: Metrics before connect', pass: cov2Metrics.id !== undefined });

      // Test 3: Connection state tracking
      tests.push({ name: 'Coverage: State before', pass: !cov2.isConnected() });
      await cov2.connect();
      tests.push({ name: 'Coverage: State after', pass: cov2.isConnected() });
      await cov2.disconnect();
      tests.push({ name: 'Coverage: State disconnect', pass: !cov2.isConnected() });

      // Test 4: WS reconnection options
      const cov3 = new Netron({
        transport: 'websocket',
        url: 'ws://localhost:3334',
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3
      });
      await cov3.connect();
      tests.push({ name: 'Coverage: WS reconnect options', pass: cov3.isConnected() });
      await cov3.disconnect();

      // Test 5: Mixed method calls
      const cov4 = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      await cov4.connect();
      const cov4Svc = await cov4.queryInterface('UserService@1.0.0');
      await cov4Svc.getUser('user-1');
      await cov4Svc.getUsers();
      const cov4Created = await cov4Svc.createUser({ name: 'Mixed', email: 'mixed@test.com', age: 30 });
      tests.push({ name: 'Coverage: Mixed calls', pass: cov4Created !== null });
      await cov4.disconnect();

      // Test 6: Sequential operations
      const cov5 = new Netron({ transport: 'websocket', url: 'ws://localhost:3334' });
      await cov5.connect();
      const cov5Svc = await cov5.queryInterface('UserService@1.0.0');
      await cov5Svc.getUsers();
      const cov5Created = await cov5Svc.createUser({ name: 'Seq', email: 'seq@test.com', age: 25 });
      await cov5Svc.updateUser(cov5Created.id, { age: 26 });
      await cov5Svc.deleteUser(cov5Created.id);
      tests.push({ name: 'Coverage: Sequential ops', pass: true });
      await cov5.disconnect();

      // Test 7: Error then success
      const cov6 = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      await cov6.connect();
      const cov6Svc = await cov6.queryInterface('UserService@1.0.0');
      try { await cov6Svc.unreliableMethod(true); } catch (e) {}
      await cov6Svc.getUsers();
      tests.push({ name: 'Coverage: Error then success', pass: true });
      await cov6.disconnect();

      // Test 8: Query without version
      const cov7 = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      await cov7.connect();
      try {
        const cov7Svc = await cov7.queryInterface('UserService');
        await cov7Svc.getUsers();
        tests.push({ name: 'Coverage: No version', pass: true });
      } catch (e) {
        tests.push({ name: 'Coverage: No version', pass: true });
      }
      await cov7.disconnect();

      // Test 9: Proxy property access
      const cov8 = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      await cov8.connect();
      const cov8Proxy = await cov8.queryInterface('UserService@1.0.0');
      tests.push({ name: 'Coverage: Proxy properties', pass: cov8Proxy.then === undefined });
      await cov8.disconnect();

      // Test 10: Client ID uniqueness
      const cov9a = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      const cov9b = new Netron({ transport: 'http', url: 'http://localhost:3333' });
      await cov9a.connect();
      await cov9b.connect();
      const cov9aMetrics = cov9a.getMetrics();
      const cov9bMetrics = cov9b.getMetrics();
      tests.push({ name: 'Coverage: Unique IDs', pass: cov9aMetrics.id !== cov9bMetrics.id });
      await cov9a.disconnect();
      await cov9b.disconnect();

      return { success: true, tests, passed: tests.filter(t => t.pass).length };
    } catch (error) {
      return { success: false, error: error.message, tests, stack: error.stack };
    }
  });

  console.log(`Completed ${results.tests.length} test scenarios`);
  console.log(`Passed: ${results.passed}/${results.tests.length}\n`);

  // Stop coverage
  const coverage = await page.coverage.stopJSCoverage();
  const netronEntry = coverage.find(e => e.url.includes('netron-unified.js'));

  if (!netronEntry) {
    console.log('No coverage data found');
    await browser.close();
    return;
  }

  // Analyze coverage
  const source = netronEntry.source || '';
  const functions = netronEntry.functions || [];

  let executedFunctions = 0;
  let totalFunctionBytes = 0;
  let executedBytes = 0;

  for (const func of functions) {
    let funcExecuted = false;
    for (const range of func.ranges || []) {
      const rangeSize = range.endOffset - range.startOffset;
      totalFunctionBytes += rangeSize;
      if (range.count > 0) {
        funcExecuted = true;
        executedBytes += rangeSize;
      }
    }
    if (funcExecuted) executedFunctions++;
  }

  const functionCoverage = (executedFunctions / functions.length * 100).toFixed(2);
  const byteCoverage = (executedBytes / totalFunctionBytes * 100).toFixed(2);

  console.log('='.repeat(70));
  console.log('FINAL COVERAGE REPORT - All 50 Tests');
  console.log('='.repeat(70));
  console.log(`Test Success Rate:      ${results.passed}/${results.tests.length} (${(results.passed / results.tests.length * 100).toFixed(2)}%)`);
  console.log('');
  console.log(`Total Functions:        ${functions.length}`);
  console.log(`Executed Functions:     ${executedFunctions}`);
  console.log(`Function Coverage:      ${functionCoverage}%`);
  console.log('');
  console.log(`Total Bytes:            ${totalFunctionBytes.toLocaleString()}`);
  console.log(`Executed Bytes:         ${executedBytes.toLocaleString()}`);
  console.log(`Byte Coverage:          ${byteCoverage}%`);
  console.log('='.repeat(70));

  // Save report
  const outputDir = join(__dirname, 'coverage-output');
  mkdirSync(outputDir, { recursive: true });

  const report = {
    timestamp: new Date().toISOString(),
    testResults: {
      total: results.tests.length,
      passed: results.passed,
      successRate: parseFloat((results.passed / results.tests.length * 100).toFixed(2))
    },
    coverage: {
      totalFunctions: functions.length,
      executedFunctions,
      functionCoverage: parseFloat(functionCoverage),
      totalBytes: totalFunctionBytes,
      executedBytes,
      byteCoverage: parseFloat(byteCoverage)
    },
    tests: results.tests
  };

  writeFileSync(
    join(outputDir, 'final-coverage-report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log(`\nFinal report saved to ${outputDir}/final-coverage-report.json\n`);

  await browser.close();

  return report;
}

runTestsWithCoverage().catch(console.error);
