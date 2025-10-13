/**
 * API Route - routes/api/users/[id].ts → /api/users/:id
 * Handles individual user operations
 */

import type { ApiHandler } from '@omnitron-dev/aether/routing/file-based';
import { json, error } from '@omnitron-dev/aether/routing/file-based';

// Mock database
const users = new Map([
  ['1', { id: '1', name: 'Alice', email: 'alice@example.com' }],
  ['2', { id: '2', name: 'Bob', email: 'bob@example.com' }],
]);

// GET /api/users/:id - Get single user
export const GET: ApiHandler = async ({ params }) => {
  const user = users.get(params.id as string);

  if (!user) {
    return error('User not found', 404);
  }

  return json(user);
};

// PATCH /api/users/:id - Update user
export const PATCH: ApiHandler = async ({ params, request }) => {
  const user = users.get(params.id as string);

  if (!user) {
    return error('User not found', 404);
  }

  try {
    const data = await request.json();

    // Update user
    const updated = { ...user, ...data, id: user.id };
    users.set(params.id as string, updated);

    return json(updated);
  } catch (err) {
    return error('Invalid JSON', 400);
  }
};

// DELETE /api/users/:id - Delete user
export const DELETE: ApiHandler = async ({ params }) => {
  const existed = users.delete(params.id as string);

  if (!existed) {
    return error('User not found', 404);
  }

  return new Response(null, { status: 204 });
};
