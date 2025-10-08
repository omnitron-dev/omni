/**
 * Debug test for HttpNetronClient
 */

import { test, expect } from '@playwright/test';

test('should debug HttpNetronClient', async ({ page }) => {
  await page.goto('/');

  // Enable console logging
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));

  const result = await page.evaluate(async () => {
    try {
      console.log('1. Importing HttpNetronClient...');
      const { HttpNetronClient } = await import('/netron-client.js');
      console.log('2. HttpNetronClient imported');

      console.log('3. Creating client...');
      const client = new HttpNetronClient({ baseUrl: 'http://localhost:3333' });
      console.log('4. Client created');

      console.log('5. Initializing client...');
      await client.initialize();
      console.log('6. Client initialized');

      console.log('7. Getting service interface...');
      const userService = await client.queryInterface('UserService');
      console.log('8. Service interface retrieved');

      console.log('9. Calling getUsers...');
      const users = await userService.getUsers();
      console.log('10. getUsers returned:', users);

      return {
        success: true,
        users,
        count: users ? users.length : 0
      };
    } catch (error: any) {
      console.error('ERROR:', error);
      return {
        success: false,
        error: error.message,
        stack: error.stack
      };
    }
  });

  console.log('Final result:', JSON.stringify(result, null, 2));
  expect(result.success).toBe(true);
});
