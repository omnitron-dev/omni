/**
 * Debug test to verify standalone Netron client works
 */

import { test, expect } from '@playwright/test';

test('should import and use standalone HttpNetronClient', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    try {
      // Import standalone client
      const { HttpNetronClient } = await import('/netron-client.js');
      console.log('Standalone client imported successfully');

      // Create client
      const client = new HttpNetronClient({
        baseUrl: 'http://localhost:3333',
      });

      await client.initialize();

      return {
        success: true,
        clientCreated: true,
        metrics: client.getMetrics(),
      };
    } catch (error: any) {
      console.error('Error:', error);
      return {
        success: false,
        error: error.message,
        stack: error.stack,
      };
    }
  });

  console.log('Result:', JSON.stringify(result, null, 2));

  if (!result.success) {
    console.error('Error:', result.error);
    console.error('Stack:', result.stack);
  }

  expect(result.success).toBe(true);
  expect(result.clientCreated).toBe(true);
});
