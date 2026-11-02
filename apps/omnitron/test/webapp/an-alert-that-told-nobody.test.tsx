// @vitest-environment happy-dom

/**
 * An alert that told nobody.
 *
 * Three settings — a desktop notification, a sound, a minimum severity —
 * were written by the settings page and read by nothing: an alert fired into
 * a list somebody had to be looking at. The threshold offered log levels
 * (info / warn / error / fatal) where alerts are info / warning / critical,
 * so `critical` could not be chosen and the default, `error`, matched none.
 *
 * `useAlertNotifications` reads them, on every page of the console — and in
 * a background tab, which is the tab a desktop notification is for.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { ActiveAlert } from '../../src/shared/dto/alerts.js';

const getActiveAlerts = vi.fn<() => Promise<ActiveAlert[]>>();
const describeAccess = vi.fn();

vi.mock('src/netron/client', () => ({
  alerts: { getActiveAlerts: () => getActiveAlerts() },
  access: { describe: () => describeAccess() },
  getSessionId: () => null,
}));
// Exercise the layout's own subscription without mounting its independent footer poller.
vi.mock('src/components/console-keyboard', () => ({ ConsoleKeyboard: () => null }));

import {
  alertsToAnnounce,
  readMinSeverity,
  LS_ALERT_SEVERITY,
  LS_DESKTOP_NOTIFICATIONS,
  LS_SOUND_ALERTS,
} from '../../webapp/src/utils/alert-notify-settings.js';
import { useAlertNotifications } from '../../webapp/src/hooks/use-alert-notifications.js';
import { ConsoleLayout } from '../../webapp/src/layouts/console-layout.js';
import { ConsoleAccessProvider } from '../../webapp/src/auth/access.js';
import { useAuthStore } from '../../webapp/src/auth/store.js';

const alert = (id: string, severity: ActiveAlert['severity']): ActiveAlert => ({
  id,
  ruleId: `rule-${id}`,
  ruleName: `Rule ${id}`,
  severity,
  message: `message ${id}`,
  firedAt: '2026-09-24T10:00:00.000Z',
  resolvedAt: null,
  acknowledged: false,
  node: null,
});

describe('the minimum severity', () => {
  beforeEach(() => localStorage.clear());

  it('is one of the alerts’ own, `warning` by default — a log level left from before reads as the default', () => {
    expect(readMinSeverity()).toBe('warning');
    localStorage.setItem(LS_ALERT_SEVERITY, 'error');
    expect(readMinSeverity()).toBe('warning');
    localStorage.setItem(LS_ALERT_SEVERITY, 'critical');
    expect(readMinSeverity()).toBe('critical');
  });
});

describe('the alerts to announce', () => {
  it('are the new ones at or above the threshold, each once', () => {
    const seen = new Set(['a1']);
    const firing = [alert('a1', 'critical'), alert('a2', 'warning'), alert('a3', 'info')];

    expect(alertsToAnnounce(seen, firing, 'warning').map((a) => a.id)).toEqual(['a2']);
    expect(alertsToAnnounce(seen, firing, 'info')).toEqual([]);
  });
});

describe('an alert that fires while the console is open', () => {
  const notified: Array<{ title: string; body?: string }> = [];
  let tones = 0;
  let firing: ActiveAlert[] = [];

  class FakeNotification {
    static permission: NotificationPermission = 'granted';
    constructor(title: string, options?: NotificationOptions) {
      notified.push({ title, ...(options?.body !== undefined && { body: options.body }) });
    }
  }
  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    constructor() {
      tones += 1;
    }
    createOscillator() {
      return { frequency: {}, connect: (n: unknown) => n, start() {}, stop() {}, onended: null };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n };
    }
    close() {}
  }

  function Console({ signedIn }: { signedIn: boolean }) {
    useAlertNotifications(signedIn ? 'reader' : null);
    return null;
  }
  const poll = () => act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
  const setVisibility = (state: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Notification', FakeNotification);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    localStorage.clear();
    localStorage.setItem(LS_DESKTOP_NOTIFICATIONS, 'true');
    localStorage.setItem(LS_SOUND_ALERTS, 'true');
    notified.length = 0;
    tones = 0;
    firing = [alert('a1', 'critical')];
    getActiveAlerts.mockReset();
    getActiveAlerts.mockImplementation(async () => firing);
  });
  afterEach(() => {
    setVisibility('visible');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is announced — what was firing when the console opened is not', async () => {
    render(<Console signedIn />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(notified).toEqual([]);

    firing = [...firing, alert('a2', 'warning'), alert('a3', 'info')];
    await poll();

    expect(notified).toEqual([{ title: 'WARNING · Rule a2', body: 'message a2' }]);
    expect(tones).toBe(1);
  });

  it('is announced in a background tab too', async () => {
    render(<Console signedIn />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    setVisibility('hidden');

    firing = [...firing, alert('a4', 'critical')];
    await poll();

    expect(notified.map((n) => n.title)).toEqual(['CRITICAL · Rule a4']);
  });

  it('below the chosen severity, or with notifications off, is not shown — the sound follows its own setting', async () => {
    localStorage.setItem(LS_ALERT_SEVERITY, 'critical');
    render(<Console signedIn />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));

    firing = [...firing, alert('a5', 'warning')];
    await poll();
    expect(notified).toEqual([]);
    expect(tones).toBe(0);

    localStorage.setItem(LS_DESKTOP_NOTIFICATIONS, 'false');
    firing = [...firing, alert('a6', 'critical')];
    await poll();
    expect(notified).toEqual([]);
    expect(tones).toBe(1);
  });

  it('is not asked for while nobody is signed in', async () => {
    render(<Console signedIn={false} />);
    await poll();
    expect(getActiveAlerts).not.toHaveBeenCalled();
  });

  it('discards an in-flight notification when the reader loses access', async () => {
    const view = render(<Console signedIn />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    let complete!: (items: ActiveAlert[]) => void;
    getActiveAlerts.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await poll();
    view.rerender(<Console signedIn={false} />);
    firing = [...firing, alert('a2', 'critical')];
    await act(async () => complete(firing));
    view.rerender(<Console signedIn />);
    await poll();
    expect(notified).toEqual([]);
    expect(tones).toBe(0);
  });

  it.each(['/logs', '/nodes'])('polls from the shared layout on %s only with the alert read grant', async (route) => {
    const account = { id: 'reader', username: 'reader', displayName: 'Reader', role: 'viewer' };
    let allowed = false;
    describeAccess.mockReset().mockImplementation(async () => ({
      userId: account.id, role: account.role, roles: [],
      capabilities: [{ service: 'OmnitronAlerts', method: 'getActiveAlerts', allowed }],
    }));
    useAuthStore.setState({ user: account });
    try {
      render(
        <MemoryRouter initialEntries={[route]}>
          <ConsoleAccessProvider><ConsoleLayout /></ConsoleAccessProvider>
        </MemoryRouter>
      );
      await poll();
      expect(describeAccess).toHaveBeenCalled();
      expect(getActiveAlerts).not.toHaveBeenCalled();
      allowed = true;
      await poll();
      expect(getActiveAlerts).toHaveBeenCalled();
      act(() => useAuthStore.setState({ user: null }));
      getActiveAlerts.mockClear();
      await poll();
      expect(getActiveAlerts).not.toHaveBeenCalled();
    } finally {
      act(() => useAuthStore.setState({ user: null }));
    }
  });
});
