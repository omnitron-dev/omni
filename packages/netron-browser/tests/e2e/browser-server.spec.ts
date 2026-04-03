/**
 * E2E tests for Netron Browser client with Titan server
 * Tests full integration between browser client and server
 */

import { test, expect } from '@playwright/test';

test.describe('Netron Browser HTTP Client E2E', () => {
  test('should connect to server via HTTP', async ({ page }) => {
    await page.goto('/');

    // Select HTTP transport
    await page.selectOption('#transport', 'http');

    // Click connect button
    await page.click('#connect');

    // Wait for connection
    await page.waitForSelector('.status.connected', { timeout: 5000 });

    // Verify status
    const status = await page.textContent('#status');
    expect(status).toContain('Connected');

    // Check output log
    const output = await page.textContent('#output');
    expect(output).toContain('Connected via HTTP');
  });

  test('should perform calculator operations', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#transport', 'http');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    // Test addition
    await page.click('[data-test="calc-add"]');
    await page.waitForTimeout(500);
    let output = await page.textContent('#output');
    expect(output).toContain('Add 5 + 3');
    expect(output).toContain('8');

    // Test subtraction
    await page.click('[data-test="calc-subtract"]');
    await page.waitForTimeout(500);
    output = await page.textContent('#output');
    expect(output).toContain('Subtract 10 - 4');
    expect(output).toContain('6');

    // Test multiplication
    await page.click('[data-test="calc-multiply"]');
    await page.waitForTimeout(500);
    output = await page.textContent('#output');
    expect(output).toContain('Multiply 6 * 7');
    expect(output).toContain('42');

    // Test division
    await page.click('[data-test="calc-divide"]');
    await page.waitForTimeout(500);
    output = await page.textContent('#output');
    expect(output).toContain('Divide 20 / 4');
    expect(output).toContain('5');
  });

  test('should handle calculator errors', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#transport', 'http');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    // Test division by zero
    await page.click('[data-test="calc-error"]');
    await page.waitForTimeout(500);

    const output = await page.textContent('#output');
    expect(output).toContain('Error');
    expect(output).toContain('Division by zero');
  });

  test('should perform user operations', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#transport', 'http');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    // List users
    await page.click('[data-test="user-list"]');
    await page.waitForTimeout(500);
    let output = await page.textContent('#output');
    expect(output).toContain('Alice');
    expect(output).toContain('Bob');
    expect(output).toContain('Charlie');

    // Get user
    await page.click('[data-test="user-get"]');
    await page.waitForTimeout(500);
    output = await page.textContent('#output');
    expect(output).toContain('Alice');
    expect(output).toContain('alice@example.com');

    // Create user
    await page.click('[data-test="user-create"]');
    await page.waitForTimeout(500);
    output = await page.textContent('#output');
    expect(output).toContain('Test User');
    expect(output).toContain('test@example.com');
  });

  test('should handle user errors', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#transport', 'http');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    // Try to get non-existent user
    await page.click('[data-test="user-error"]');
    await page.waitForTimeout(500);

    const output = await page.textContent('#output');
    expect(output).toContain('Error');
    expect(output).toContain('User not found');
  });

  test('should perform echo operations', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#transport', 'http');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    // Echo string
    await page.click('[data-test="echo-string"]');
    await page.waitForTimeout(500);
    let output = await page.textContent('#output');
    expect(output).toContain('Hello, Netron!');

    // Echo number
    await page.click('[data-test="echo-number"]');
    await page.waitForTimeout(500);
    output = await page.textContent('#output');
    expect(output).toContain('42');

    // Echo object
    await page.click('[data-test="echo-object"]');
    await page.waitForTimeout(500);
    output = await page.textContent('#output');
    expect(output).toContain('Test');
    expect(output).toContain('nested');

    // Echo array
    await page.click('[data-test="echo-array"]');
    await page.waitForTimeout(500);
    output = await page.textContent('#output');
    expect(output).toContain('[1,2,3');
  });

  test('should handle echo errors', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#transport', 'http');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    await page.click('[data-test="echo-error"]');
    await page.waitForTimeout(500);

    const output = await page.textContent('#output');
    expect(output).toContain('Error');
    expect(output).toContain('Test error message');
  });

  test('should handle sequential performance test', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#transport', 'http');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    await page.click('[data-test="perf-sequential"]');
    await page.waitForTimeout(2000);

    const output = await page.textContent('#output');
    expect(output).toContain('Sequential: 10 calls');
    expect(output).toContain('ms');
  });

  test('should handle parallel performance test', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#transport', 'http');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    await page.click('[data-test="perf-parallel"]');
    await page.waitForTimeout(2000);

    const output = await page.textContent('#output');
    expect(output).toContain('Parallel: 10 calls');
    expect(output).toContain('ms');
  });

  test('should disconnect gracefully', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#transport', 'http');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    // Click disconnect
    await page.click('#disconnect');
    await page.waitForTimeout(500);

    // Verify disconnected status
    const status = await page.textContent('#status');
    expect(status).toContain('Disconnected');

    // Verify connect button is enabled
    const connectBtn = await page.$('#connect');
    const isDisabled = await connectBtn?.isDisabled();
    expect(isDisabled).toBe(false);
  });
});

test.describe('Netron Browser WebSocket Client E2E', () => {
  test('should connect to server via WebSocket', async ({ page }) => {
    await page.goto('/');

    // Select WebSocket transport
    await page.selectOption('#transport', 'websocket');

    // Update URL to use ws://
    await page.fill('#serverUrl', 'ws://localhost:3000');

    // Click connect button
    await page.click('#connect');

    // Wait for connection
    await page.waitForSelector('.status.connected', { timeout: 5000 });

    // Verify status
    const status = await page.textContent('#status');
    expect(status).toContain('Connected');

    // Check output log
    const output = await page.textContent('#output');
    expect(output).toContain('Connected via WEBSOCKET');
  });

  test('should perform operations via WebSocket', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#transport', 'websocket');
    await page.fill('#serverUrl', 'ws://localhost:3000');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    // Test calculator
    await page.click('[data-test="calc-add"]');
    await page.waitForTimeout(500);
    const output = await page.textContent('#output');
    expect(output).toContain('Add 5 + 3');
    expect(output).toContain('8');
  });

  test('should handle WebSocket reconnection', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#transport', 'websocket');
    await page.fill('#serverUrl', 'ws://localhost:3000');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    // Disconnect
    await page.click('#disconnect');
    await page.waitForSelector('.status.disconnected');

    // Reconnect
    await page.click('#connect');
    await page.waitForSelector('.status.connected', { timeout: 5000 });

    // Verify operations work after reconnection
    await page.click('[data-test="calc-add"]');
    await page.waitForTimeout(500);
    const output = await page.textContent('#output');
    expect(output).toContain('8');
  });
});

test.describe('Error Handling', () => {
  test('should handle connection failure gracefully', async ({ page }) => {
    await page.goto('/');

    // Try to connect to invalid server
    await page.fill('#serverUrl', 'http://localhost:9999');
    await page.click('#connect');

    // Wait a bit for connection attempt
    await page.waitForTimeout(1000);

    // Should still show error in output
    const output = await page.textContent('#output');
    expect(output).toContain('fail' || 'error' || 'Error');
  });

  test('should disable test buttons when disconnected', async ({ page }) => {
    await page.goto('/');

    // All test buttons should be disabled initially
    const calcBtn = await page.$('[data-test="calc-add"]');
    const isDisabled = await calcBtn?.isDisabled();
    expect(isDisabled).toBe(true);

    // Connect
    await page.selectOption('#transport', 'http');
    await page.click('#connect');
    await page.waitForSelector('.status.connected');

    // Buttons should be enabled
    const isEnabledAfterConnect = await calcBtn?.isDisabled();
    expect(isEnabledAfterConnect).toBe(false);

    // Disconnect
    await page.click('#disconnect');
    await page.waitForSelector('.status.disconnected');

    // Buttons should be disabled again
    const isDisabledAfterDisconnect = await calcBtn?.isDisabled();
    expect(isDisabledAfterDisconnect).toBe(true);
  });
});
