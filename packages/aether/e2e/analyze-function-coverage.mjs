/**
 * Analyze function-level coverage to find unexecuted code paths
 */

import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function analyzeFunctionCoverage() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Enable detailed coverage
  await page.coverage.startJSCoverage({ reportAnonymousScripts: true });

  // Navigate and run tests
  await page.goto('http://localhost:3456/');

  // Run all our test scenarios
  await page.evaluate(async () => {
    const { Netron } = await import('/netron-unified.js');

    // HTTP tests
    const http = new Netron({ transport: 'http', url: 'http://localhost:3333' });
    await http.connect();
    const httpSvc = await http.queryInterface('UserService@1.0.0');
    await httpSvc.getUsers();
    await httpSvc.getUser('user-1');
    const created = await httpSvc.createUser({ name: 'Test', email: 'test@test.com', age: 25 });
    await httpSvc.updateUser(created.id, { age: 26 });
    await httpSvc.deleteUser(created.id);
    await httpSvc.findUsers({ minAge: 25 });
    try { await httpSvc.unreliableMethod(true); } catch (e) {}
    http.getMetrics();
    http.isConnected();
    await http.disconnect();

    // WebSocket tests
    const ws = new Netron({ transport: 'websocket', url: 'ws://localhost:3334', reconnect: true });
    await ws.connect();
    const wsSvc = await ws.queryInterface('UserService@1.0.0');
    await wsSvc.getUsers();
    await wsSvc.getUser('user-1');
    const wsCreated = await wsSvc.createUser({ name: 'WS', email: 'ws@test.com', age: 28 });
    await wsSvc.updateUser(wsCreated.id, { age: 29 });
    await wsSvc.deleteUser(wsCreated.id);
    await wsSvc.findUsers({ minAge: 25 });
    await Promise.all([wsSvc.getUsers(), wsSvc.getUsers(), wsSvc.getUsers()]);
    ws.getMetrics();
    ws.isConnected();
    await ws.disconnect();

    // Edge cases
    const http2 = new Netron({ transport: 'http', url: 'http://localhost:3333' });
    try { await http2.queryInterface('Test'); } catch (e) {}
    await http2.connect();
    await http2.queryInterface('UserService');
    await http2.disconnect();
  });

  // Stop coverage
  const coverage = await page.coverage.stopJSCoverage();
  const netronEntry = coverage.find(e => e.url.includes('netron-unified.js'));

  if (!netronEntry) {
    console.log('No coverage found');
    await browser.close();
    return;
  }

  const source = netronEntry.source || '';
  const functions = netronEntry.functions || [];

  console.log(`\nTotal functions: ${functions.length}`);

  // Analyze function execution
  let executedFunctions = 0;
  let unexecutedFunctions = 0;
  let totalFunctionBytes = 0;
  let executedFunctionBytes = 0;

  const unexecutedDetails = [];

  for (const func of functions) {
    let functionExecuted = false;
    let functionBytes = 0;
    let executedBytes = 0;

    for (const range of func.ranges || []) {
      const rangeSize = range.endOffset - range.startOffset;
      functionBytes += rangeSize;

      if (range.count > 0) {
        functionExecuted = true;
        executedBytes += rangeSize;
      }
    }

    totalFunctionBytes += functionBytes;

    if (functionExecuted) {
      executedFunctions++;
      executedFunctionBytes += executedBytes;
    } else {
      unexecutedFunctions++;

      // Get function source snippet
      const funcRange = func.ranges && func.ranges[0];
      if (funcRange) {
        const start = funcRange.startOffset;
        const end = Math.min(funcRange.endOffset, start + 200);
        const snippet = source.substring(start, end).split('\n')[0];
        unexecutedDetails.push({
          name: func.functionName || '<anonymous>',
          start: funcRange.startOffset,
          end: funcRange.endOffset,
          bytes: functionBytes,
          snippet: snippet.substring(0, 100) + (snippet.length > 100 ? '...' : '')
        });
      }
    }
  }

  const functionCoveragePercent = functions.length > 0
    ? (executedFunctions / functions.length * 100).toFixed(2)
    : '0.00';

  const byteCoveragePercent = totalFunctionBytes > 0
    ? (executedFunctionBytes / totalFunctionBytes * 100).toFixed(2)
    : '0.00';

  console.log('\n' + '='.repeat(70));
  console.log('FUNCTION-LEVEL COVERAGE ANALYSIS');
  console.log('='.repeat(70));
  console.log(`Total functions:        ${functions.length}`);
  console.log(`Executed functions:     ${executedFunctions}`);
  console.log(`Unexecuted functions:   ${unexecutedFunctions}`);
  console.log(`Function coverage:      ${functionCoveragePercent}%`);
  console.log('');
  console.log(`Total bytes:            ${totalFunctionBytes.toLocaleString()}`);
  console.log(`Executed bytes:         ${executedFunctionBytes.toLocaleString()}`);
  console.log(`Byte coverage:          ${byteCoveragePercent}%`);
  console.log('='.repeat(70));

  if (unexecutedDetails.length > 0) {
    console.log(`\nTop ${Math.min(20, unexecutedDetails.length)} Unexecuted Functions:`);
    console.log('-'.repeat(70));

    // Sort by size (largest first)
    unexecutedDetails.sort((a, b) => b.bytes - a.bytes);

    for (let i = 0; i < Math.min(20, unexecutedDetails.length); i++) {
      const func = unexecutedDetails[i];
      console.log(`${i + 1}. ${func.name} (${func.bytes} bytes)`);
      console.log(`   ${func.snippet}`);
      console.log('');
    }
  }

  // Save report
  const outputDir = join(__dirname, 'coverage-output');
  mkdirSync(outputDir, { recursive: true });

  writeFileSync(
    join(outputDir, 'function-coverage.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        totalFunctions: functions.length,
        executedFunctions,
        unexecutedFunctions,
        functionCoveragePercent: parseFloat(functionCoveragePercent),
        totalBytes: totalFunctionBytes,
        executedBytes: executedFunctionBytes,
        byteCoveragePercent: parseFloat(byteCoveragePercent)
      },
      unexecutedFunctions: unexecutedDetails
    }, null, 2)
  );

  console.log(`Report saved to ${outputDir}/function-coverage.json\n`);

  await browser.close();

  return {
    functionCoveragePercent: parseFloat(functionCoveragePercent),
    byteCoveragePercent: parseFloat(byteCoveragePercent),
    executedFunctions,
    totalFunctions: functions.length
  };
}

analyzeFunctionCoverage().catch(console.error);
