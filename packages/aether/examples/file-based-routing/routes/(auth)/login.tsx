/**
 * Login page - routes/(auth)/login.tsx → /login
 * Part of the (auth) route group
 */

import { defineComponent, signal } from '@omnitron-dev/aether';
import { useNavigate } from '@omnitron-dev/aether/router';

export default defineComponent(() => {
  const email = signal('');
  const password = signal('');
  const navigate = useNavigate();

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    // Login logic here
    console.log('Login:', email(), password());
    navigate('/dashboard');
  };

  return () => (
    <div>
      <h1>Login</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email()}
          onInput={(e) => email.set(e.currentTarget.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password()}
          onInput={(e) => password.set(e.currentTarget.value)}
        />
        <button type="submit">Login</button>
      </form>
    </div>
  );
});
