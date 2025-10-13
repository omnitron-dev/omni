/**
 * User profile page - routes/users/[id].tsx → /users/:id
 * Dynamic route with parameter
 */

import { defineComponent } from '@omnitron-dev/aether';
import { useParams, useLoaderData } from '@omnitron-dev/aether/router';
import type { RouteLoader } from '@omnitron-dev/aether/router';

interface User {
  id: string;
  name: string;
  email: string;
}

// Loader function - runs before component renders
export const loader: RouteLoader<User> = async ({ params }) => {
  // Fetch user data
  const response = await fetch(`/api/users/${params.id}`);
  return response.json();
};

export default defineComponent(() => {
  const params = useParams<{ id: string }>();
  const user = useLoaderData<User>();

  return () => (
    <div>
      <h1>User Profile</h1>
      <div>
        <p>
          <strong>ID:</strong> {params.id}
        </p>
        <p>
          <strong>Name:</strong> {user().name}
        </p>
        <p>
          <strong>Email:</strong> {user().email}
        </p>
      </div>
    </div>
  );
});
