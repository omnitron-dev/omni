/**
 * Simple test to debug connection
 */

import { test, expect } from '@playwright/test';

test('should make fetch request', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    try {
      console.log('Attempting fetch to http://localhost:3333/netron/invoke');

      const response = await fetch('http://localhost:3333/netron/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: 'test123',
          version: '2.0',
          timestamp: Date.now(),
          service: 'UserService',
          method: 'getUsers',
          input: []
        })
      });

      console.log('Response received:', response.status);
      const data = await response.json();
      console.log('Data:', data);

      return {
        success: true,
        status: response.status,
        data
      };
    } catch (error: any) {
      console.error('Fetch error:', error);
      return {
        success: false,
        error: error.message,
        stack: error.stack
      };
    }
  });

  console.log('Test result:', JSON.stringify(result, null, 2));

  expect(result.success).toBe(true);
});
