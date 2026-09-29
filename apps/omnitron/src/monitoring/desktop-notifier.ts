/**
 * A critical alert, said on this machine's screen.
 *
 * A fired alert was a row in `alert_events`. The console polls it every 15 s
 * and notifies — but only while it is open in a browser, and nothing else ever
 * read the row: the master's disk filled three times with nobody told. The
 * owner's decision, 2026-09-29: a critical alert is said on the master's own
 * desktop when it fires and when it resolves — nothing leaves the machine, no
 * third party learns that there is a server or when it is ill. (A second
 * channel, the platform's own notifications for its superadmins, is to follow.)
 *
 * macOS only: `osascript`'s `display notification`, run without a shell. The
 * words are the operator's (a rule's name, an app's, a container's), so they
 * are quoted as AppleScript strings — a quote in them ends nothing. Elsewhere
 * this does nothing, and the console stays the way to see an alert. The OS's
 * own notification settings are where it is switched off.
 */
import { execFile } from 'node:child_process';

/** A string as an AppleScript literal: quotes and backslashes escaped, one line. */
export function appleScriptString(text: string): string {
  const oneLine = text.replace(/[\r\n]+/g, ' ');
  return `"${oneLine.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface DesktopNotice {
  title: string;
  subtitle: string;
  body: string;
}

type Run = (file: string, args: string[], options: { timeout: number }, done: (err: Error | null) => void) => void;

/**
 * Say it on the desktop. Returns whether it was attempted — false off macOS.
 * A failure is handed to `onError` and is nobody's reason to stop evaluating.
 *
 * Quiet under the test runner by default: a court that fires `App crashed` on
 * a real database must not put «App crashed» on the screen of whoever runs the
 * suite, who would read it as the platform's. A court that wants the macOS
 * path passes its own `deps`.
 */
export function notifyDesktop(
  notice: DesktopNotice,
  onError: (err: Error) => void,
  deps: { platform: NodeJS.Platform; run: Run; quiet?: boolean } = {
    platform: process.platform,
    run: execFile as unknown as Run,
    quiet: process.env['NODE_ENV'] === 'test',
  }
): boolean {
  if (deps.quiet || deps.platform !== 'darwin') return false;
  const script =
    `display notification ${appleScriptString(notice.body)}` +
    ` with title ${appleScriptString(notice.title)}` +
    ` subtitle ${appleScriptString(notice.subtitle)}`;
  deps.run('osascript', ['-e', script], { timeout: 10_000 }, (err) => {
    if (err) onError(err);
  });
  return true;
}
