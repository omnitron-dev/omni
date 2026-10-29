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

/** Control bytes other than tab and newline must be rendered before pasting. */
function hiddenControl(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 9 || (code >= 11 && code <= 31) || code === 127;
}

/** Bracketed paste helps cooperating shells; review still applies to control bytes. */
export function requiresPasteReview(value: string): boolean {
  return value.includes('\n') || [...value].some(hiddenControl);
}

export function visiblePaste(value: string): string {
  return [...value].map(character => hiddenControl(character)
    ? `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`
    : character).join('');
}
