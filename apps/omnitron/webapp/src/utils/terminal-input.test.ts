import { describe, expect, it } from 'vitest';
import { encodeTerminalInput, requiresPasteReview, secureTerminalOrigin, visiblePaste } from './terminal-input';

describe('terminal input safety', () => {
  it('round trips binary mouse reports and UTF-8 split across RPC boundaries', () => {
    const source = new TextEncoder().encode('😀Привет'.repeat(2000));
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < source.length; offset += 8192)
      chunks.push(Buffer.from(encodeTerminalInput(source.subarray(offset, offset + 8192)), 'base64'));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(source));
    const mouse = Uint8Array.from([0x1b, 0x5b, 0x4d, 0xff, 0x80, 0x00]);
    expect(Buffer.from(encodeTerminalInput(mouse), 'base64')).toEqual(Buffer.from(mouse));
    expect(() => encodeTerminalInput(new Uint8Array(8193))).toThrow();
  });
  it('allows TLS and loopback development, but not plaintext remote access', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]'])
      expect(secureTerminalOrigin({ protocol: 'http:', hostname })).toBe(true);
    expect(secureTerminalOrigin({ protocol: 'https:', hostname: 'console.example.org' })).toBe(true);
    for (const hostname of ['console.example.org', 'localhost.example.org', '192.168.1.2'])
      expect(secureTerminalOrigin({ protocol: 'http:', hostname })).toBe(false);
  });
  it('requires review for lines and invisible shell control bytes, but not plain text', () => {
    for (const value of ['id\r', 'ls\npwd', '\x1b[201~whoami', '\x03', 'a\x7fb'])
      expect(requiresPasteReview(value)).toBe(true);
    expect(requiresPasteReview('git status')).toBe(false);
    expect(visiblePaste('a\x1bb')).toBe('a\\x1bb');
  });
});
