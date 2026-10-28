import { quoteShellArgument } from './shell-command';

export function terminalCommand(nodeId: string): string {
  return `omnitron node ssh -- ${quoteShellArgument(nodeId)}`;
}

/** Raw bytes preserve both UTF-8 text and xterm's legacy binary mouse reports. */
export function encodeTerminalInput(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > 8192) throw new Error('Terminal input chunk must contain 1 to 8192 bytes');
  return btoa(String.fromCharCode(...bytes));
}

export function secureTerminalOrigin(location: Pick<Location, 'protocol' | 'hostname'>): boolean {
  return (
    location.protocol === 'https:' ||
    (location.protocol === 'http:' &&
      (location.hostname === 'localhost' ||
        location.hostname === '[::1]' ||
        /^127(?:\.\d{1,3}){3}$/.test(location.hostname)))
  );
}

/** Bracketed paste helps cooperating shells; review still applies to control bytes. */
export function requiresPasteReview(value: string): boolean {
  return /[\r\n\x00-\x08\x0b-\x1f\x7f]/.test(value);
}

export function visiblePaste(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}
