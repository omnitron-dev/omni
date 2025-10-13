/**
 * API Route - routes/api/users.ts → /api/users
 * Handles user CRUD operations
 */

import type { ApiHandler } from '@omnitron-dev/aether/routing/file-based';
import { json, error } from '@omnitron-dev/aether/routing/file-based';

// Mock database
const users = [
  { id: '1', name: 'Alice', email: 'alice@example.com' },
  { id: '2', name: 'Bob', email: 'bob@example.com' },
];

// GET /api/users - List all users
export const GET: ApiHandler = async () => {
  return json(users);
};

// POST /api/users - Create new user
export const POST: ApiHandler = async ({ request }) => {
  try {
    const data = await request.json();

    // Validate
    if (!data.name || !data.email) {
      return error('Name and email are required', 400);
    }

    // Create user
    const newUser = {
      id: String(users.length + 1),
      name: data.name,
      email: data.email,
    };

    users.push(newUser);

    return json(newUser, { status: 201 });
  } catch (err) {
    return error('Invalid JSON', 400);
  }
};
