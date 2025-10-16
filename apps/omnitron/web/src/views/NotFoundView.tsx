import { defineComponent } from '@omnitron-dev/aether';
import { useNavigate } from '@omnitron-dev/aether/router';

/**
 * 404 Not Found View
 *
 * Displayed when a route doesn't exist
 */
export default defineComponent(() => {
  const navigate = useNavigate();

  const goHome = () => {
    navigate('/');
  };

  const goBack = () => {
    window.history.back();
  };

  return () => (
    <div class="view not-found-view">
      <div class="not-found-container">
        <div class="not-found-content">
          <h1 class="error-code">404</h1>
          <h2 class="error-title">Page Not Found</h2>
          <p class="error-message">The page you're looking for doesn't exist or has been moved.</p>

          <div class="not-found-illustration">
            <svg width="300" height="200" viewBox="0 0 300 200" class="illustration">
              <g fill="none" stroke="currentColor" stroke-width="2" opacity="0.3">
                {/* Circuit board pattern */}
                <path d="M50 50 L100 50 L100 100 L150 100" />
                <path d="M200 50 L250 50 L250 100" />
                <path d="M50 150 L100 150 L100 100" />
                <path d="M150 150 L200 150 L200 100 L250 100" />

                <circle cx="50" cy="50" r="4" fill="currentColor" />
                <circle cx="100" cy="50" r="4" fill="currentColor" />
                <circle cx="200" cy="50" r="4" fill="currentColor" />
                <circle cx="250" cy="50" r="4" fill="currentColor" />
                <circle cx="100" cy="100" r="4" fill="currentColor" />
                <circle cx="150" cy="100" r="4" fill="currentColor" />
                <circle cx="200" cy="100" r="4" fill="currentColor" />
                <circle cx="250" cy="100" r="4" fill="currentColor" />
                <circle cx="50" cy="150" r="4" fill="currentColor" />
                <circle cx="100" cy="150" r="4" fill="currentColor" />
                <circle cx="150" cy="150" r="4" fill="currentColor" />
                <circle cx="200" cy="150" r="4" fill="currentColor" />
              </g>

              {/* Disconnected node */}
              <g transform="translate(150, 100)">
                <circle cx="0" cy="0" r="20" fill="none" stroke="currentColor" stroke-width="2" />
                <text x="0" y="5" text-anchor="middle" font-size="16" fill="currentColor">
                  ?
                </text>
              </g>
            </svg>
          </div>

          <div class="not-found-actions">
            <button class="primary-button" onClick={goHome}>
              🏠 Go to Home
            </button>
            <button class="button" onClick={goBack}>
              ← Go Back
            </button>
          </div>

          <div class="not-found-suggestions">
            <p>You might want to check out:</p>
            <ul>
              <li>
                <a href="/canvas">Flow Canvas</a>
              </li>
              <li>
                <a href="/editor">Code Editor</a>
              </li>
              <li>
                <a href="/terminal">Terminal</a>
              </li>
              <li>
                <a href="/settings">Settings</a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
});
