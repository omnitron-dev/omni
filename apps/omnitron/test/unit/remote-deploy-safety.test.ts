/**
 * What reaches a remote shell during deployment.
 *
 * Every command here ends up as an argument to `ssh`, which hands it to a
 * shell on the far side running as the configured user — `root` by default.
 * Three separate things had to be true for that to be safe, and one of them
 * was: quoting was applied at each interpolation, and the quoting was the
 * only defence.
 *
 * Quoting stops a value from becoming a command. It does not stop a value
 * from meaning something else in the position it occupies — a path segment
 * of `..`, a heredoc line equal to the delimiter, a quote inside a generated
 * TypeScript file. Those are the three fixed here.
 *
 * The names involved come from the project registry and the console's own
 * forms, so this is defence in depth rather than a live hole. It is worth
 * having because the cost is a regular expression and a `JSON.stringify`.
 */

import { describe, it, expect } from 'vitest';

import {
  assertRemotePathSegment,
  writeRemoteFileCommand,
} from '../../src/services/remote-deployer.service.js';

describe('assertRemotePathSegment', () => {
  it('accepts the names a project actually has', () => {
    for (const name of ['daos', 'daos-dev', 'main', 'app_2', 'v1.2.3', 'a']) {
      expect(assertRemotePathSegment('project name', name), name).toBe(name);
    }
  });

  it('refuses a segment that escapes the artifact root', () => {
    // `/opt/omnitron/artifacts/../../etc` is what `mkdir -p` would then
    // create, as root. Quoting the path does not help: the path is quoted
    // correctly and still points somewhere else.
    for (const name of ['..', '../..', 'a/../..', 'x..y/..']) {
      expect(() => assertRemotePathSegment('project name', name), name).toThrow(/not usable in a remote path/);
    }
  });

  it('refuses separators, so one segment cannot become several', () => {
    for (const name of ['a/b', '/abs', 'a\\b']) {
      expect(() => assertRemotePathSegment('app name', name), name).toThrow();
    }
  });

  it('refuses shell metacharacters and whitespace', () => {
    // They are quoted downstream. Refusing them anyway means the quoting is
    // not the only thing standing between a name and a remote root shell.
    for (const name of ['a b', 'a;rm -rf /', 'a$(id)', 'a`id`', "a'b", 'a\nb', 'a|b', 'a&b']) {
      expect(() => assertRemotePathSegment('version', name), JSON.stringify(name)).toThrow();
    }
  });

  it('refuses an empty or leading-punctuation name', () => {
    for (const name of ['', '.', '.hidden', '-flag', '_x']) {
      expect(() => assertRemotePathSegment('project name', name), JSON.stringify(name)).toThrow();
    }
  });

  it('names the offending value and what is allowed', () => {
    // The message is the whole remedy for whoever typed the name.
    try {
      assertRemotePathSegment('project name', 'my project');
      expect.unreachable('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('project name');
      expect(msg).toContain('"my project"');
      expect(msg).toContain('Allowed');
    }
  });
});

describe('writeRemoteFileCommand', () => {
  const decode = (command: string): string => {
    const m = command.match(/printf %s '([^']*)'/);
    return Buffer.from(m![1]!, 'base64').toString('utf8');
  };

  it('round-trips ordinary content', () => {
    const content = "export default {\n  name: 'daos',\n};\n";
    expect(decode(writeRemoteFileCommand('/etc/omnitron/omnitron.config.ts', content))).toBe(content);
  });

  it('survives content containing the old heredoc delimiter', () => {
    // The regression. `cat > file << 'OMNITRON_EOF'` ends at the first line
    // equal to OMNITRON_EOF, and everything after it is run as a command by
    // the remote shell — and `generateSlaveConfig` interpolates the project
    // name into the file, so the delimiter was reachable from a name.
    const hostile = "line one\nOMNITRON_EOF\nid > /tmp/pwned\n";
    const command = writeRemoteFileCommand('/etc/omnitron/omnitron.config.ts', hostile);

    expect(decode(command)).toBe(hostile);
    expect(command).not.toContain('OMNITRON_EOF');
    expect(command).not.toContain('/tmp/pwned');
  });

  it('puts nothing but base64 between the quotes', () => {
    // Which is why the content cannot influence the command at all: the
    // alphabet has no character a shell reacts to.
    const command = writeRemoteFileCommand('/etc/x', "quotes ' and $(id) and `id` and \\ and \n");
    const payload = command.match(/printf %s '([^']*)'/)![1]!;

    expect(payload).toMatch(/^[A-Za-z0-9+/=]*$/);
  });

  it('quotes the destination path', () => {
    const command = writeRemoteFileCommand("/etc/omnitron/a b'c.ts", 'x');
    expect(command).toContain("'/etc/omnitron/a b'\\''c.ts'");
  });

  it('handles content the size of a real config', () => {
    const big = 'x'.repeat(64 * 1024);
    expect(decode(writeRemoteFileCommand('/etc/x', big))).toBe(big);
  });

  it('handles empty content without producing a malformed command', () => {
    const command = writeRemoteFileCommand('/etc/x', '');
    expect(command).toContain("printf %s ''");
    expect(command).toContain('base64 -d > ');
  });
});
