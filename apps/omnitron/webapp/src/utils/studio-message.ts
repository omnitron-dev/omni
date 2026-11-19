/** Attach the reviewed UTF-8 text to the message sent to the provider. */
export async function attachStudioText(file: File, prompt: string): Promise<string> {
  if (file.size > 24 * 1024) throw Error('Choose a UTF-8 text file up to 24 KiB.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  if (text.includes('\0')) throw Error('Choose a text file.');
  const next = prompt + (prompt ? '\n\n' : '') + text;
  if (new TextEncoder().encode(next).length > 32 * 1024) throw Error('The message exceeds 32 KiB.');
  return next;
}
