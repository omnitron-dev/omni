import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RoleBasedGuard, type AuthState } from './guards.js';

it('does not render previously authorized children during a role or permission revocation', () => {
  let state: AuthState = { isAuthenticated: true, isLoading: false, user: { id: 'a', roles: ['admin'], permissions: ['terminal.open'] } };
  const renderProtected = vi.fn();
  function Protected() { renderProtected(); return <span>Protected</span>; }
  const useAuth = () => state;
  const content = () => <RoleBasedGuard useAuth={useAuth} roles={['admin']} permissions={['terminal.open']}><Protected /></RoleBasedGuard>;
  const view = render(content());
  const authorizedRenders = renderProtected.mock.calls.length;
  state = { ...state, user: { id: 'a', roles: ['viewer'], permissions: [] } };
  view.rerender(content());
  expect(renderProtected).toHaveBeenCalledTimes(authorizedRenders);
  expect(view.queryByText('Protected')).toBeNull();
  view.unmount();
});
