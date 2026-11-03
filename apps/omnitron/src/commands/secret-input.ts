import { password } from '@xec-sh/kit';

/** A terminal completes on Enter; a pipe completes on EOF. Never echo the secret. */
export async function readSecretFromStdin(what: string, label = 'SSH'): Promise<string> {
  const maxBytes = 64 * 1024;
  if (process.stdin.isTTY) {
    const value = await password({
      message: `${label} ${what} (Enter to submit, Ctrl+C to cancel)`,
      input: process.stdin,
      output: process.stderr,
      validate: (input) => {
        if (!input) return `Enter a ${what}`;
        if (Buffer.byteLength(input, 'utf8') > maxBytes) return `${label} secret exceeds 64 KiB`;
        return undefined;
      },
    });
    if (typeof value !== 'string') throw new Error(`${label} secret input cancelled`);
    return value;
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new Error(`${label} secret exceeds 64 KiB`);
    chunks.push(buffer);
  }
  const value = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  if (!value) throw new Error(`No ${what} on stdin — pipe it in or use an interactive terminal`);
  return value;
}

