/**
 * Error boundary - routes/_error.tsx
 * Handles errors in any route
 */

import { defineComponent } from '@omnitron-dev/aether';

export default defineComponent<{ error: Error; reset: () => void }>((props) => {
  return () => (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Oops! Something went wrong</h1>
      <p>{props.error.message}</p>
      <button onClick={props.reset}>Try again</button>
      <a href="/">Go home</a>
    </div>
  );
});
