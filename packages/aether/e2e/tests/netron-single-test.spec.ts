/**
 * Single test to debug queryInterface
 */

import { test, expect } from '@playwright/test';

test('debug queryInterface with detailed logging', async ({ page }) => {
  await page.goto('/');

  // Enable console logging
  page.on('console', (msg) => console.log('BROWSER:', msg.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

  const result = await page.evaluate(async () => {
    try {
      console.log('1. Importing Netron...');
      const { Netron } = await import('/netron-unified.js');

      console.log('2. Creating client...');
      const client = new Netron({
        transport: 'http',
        url: 'http://localhost:3333',
      });

      console.log('3. Connecting...');
      await client.connect();
      console.log('4. Connected');

      console.log('5. Calling queryInterface...');
      const userService = await client.queryInterface('UserService@1.0.0');
      console.log('6. Got service proxy:', typeof userService);
      console.log('7. Service proxy keys:', Object.keys(userService));

      console.log('8. Calling getUsers method...');
      const users = await userService.getUsers();
      console.log('9. Got users:', users);

      await client.disconnect();

      return {
        success: true,
        users,
        count: users.length,
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

  console.log('Final result:', JSON.stringify(result, null, 2));
  expect(result.success).toBe(true);
});
