// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OwnerRecoveryPage from '../../webapp/src/pages/auth/owner-recovery.js';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('src/netron/client', () => ({ daemonClient: { invoke } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); invoke.mockReset(); });

const operation = '92f8ed8b-559a-4c15-a69a-3f5d503e190e';
const origin = 'https://application.example';
const protocol = 'omnitron.owner-recovery.v1';

function openReview() {
  vi.stubGlobal('PublicKeyCredential', class {});
  vi.stubGlobal('isSecureContext', true);
  const opener = { postMessage: vi.fn() };
  vi.stubGlobal('opener', opener);
  render(<MemoryRouter initialEntries={['/auth/owner-recovery?operation=' + operation]}><OwnerRecoveryPage /></MemoryRouter>);
  expect(opener.postMessage).toHaveBeenCalledWith({ protocol, type: 'ready', operationId: operation }, '*');
  return opener;
}

async function receive(source: object, origin: string, operationId = operation) {
  const event = new MessageEvent('message', {
    source: source as Window, origin,
    data: { protocol, type: 'review', operationId, reviewToken: 'test-review' },
  });
  await act(async () => { window.dispatchEvent(event); });
}

it('only loads a review supplied by the opener for the current operation', async () => {
  const opener = openReview();
  await receive({}, origin);
  await receive(opener, origin, crypto.randomUUID());
  await receive(opener, 'null');
  expect(invoke).not.toHaveBeenCalled();
  invoke.mockResolvedValue({ applicationOrigin: origin, applicationLabel: 'Paired catalog', accountLabel: 'Owner', installationLabel: 'Primary' });
  await receive(opener, origin);
  expect(await screen.findByText('Paired catalog')).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith('daemon', 'OmnitronOwnerRecovery@1.0.0', 'getChallenge',
    [{ operationId: operation, reviewToken: 'test-review' }], { skipAuth: true });
});

it('withholds the approval form when the challenge belongs to another application origin', async () => {
  const opener = openReview();
  invoke.mockResolvedValue({ applicationOrigin: origin, accountLabel: 'Private subject label' });
  await receive(opener, 'https://another.example');
  await waitFor(() => expect(screen.queryByText(/request is unavailable/)).toBeTruthy());
  expect(screen.queryByText('Private subject label')).toBeNull();
  expect(screen.queryByLabelText('One-time offline code')).toBeNull();
});
