import { Worker } from 'node:worker_threads';
import type { LumenDocumentAst, LumenNode } from '../ast/types.js';
import { toTypst, type TypstOptions } from '../transformers/to-typst.js';

export interface PdfOptions extends TypstOptions {
  /** Additional OpenType/TrueType font bytes. Never paths or remote URLs. */
  fontData?: readonly Uint8Array[];
  /** Hard wall-clock limit, including initialization. Default 30 seconds. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

// This is trusted worker bootstrap code; document text is only structured data.
// The typesetter sees an in-memory filesystem, no package registry and no host fonts.
const BOOTSTRAP = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { readFile } = require('node:fs/promises');
(async () => {
  const engine = await import(workerData.engine);
  await engine.default();
  const { create } = await import(workerData.fontkit);
  const fonts = [];
  const blobs = await Promise.all(workerData.fontUrls.map(url => readFile(new URL(url))));
  blobs.push(...workerData.fontData.map(bytes => Buffer.from(bytes)));
  for (const blob of blobs) {
    const parsed = create(blob);
    fonts.push(...(parsed.fonts ?? [parsed]));
  }
  const missing = [...new Set(workerData.glyphText)].filter(char =>
    !/[\s\p{Cf}\uFE00-\uFE0F]/u.test(char) && !fonts.some(font => font.hasGlyphForCodePoint(char.codePointAt(0)))
  );
  if (missing.length) throw new Error('Missing PDF font glyphs: ' + missing.slice(0, 16).map(char => 'U+' + char.codePointAt(0).toString(16).toUpperCase()).join(', ') + '. Supply fontData and font families explicitly.');
  const builder = new engine.TypstCompilerBuilder();
  builder.set_dummy_access_model();
  for (const blob of blobs) await builder.add_raw_font(blob);
  const compiler = await builder.build();
  try {
    compiler.add_source('/document.typ', workerData.source);
    const world = compiler.snapshot(undefined, '/document.typ', []);
    try {
      const { result, diagnostics = [] } = world.get_artifact(1, 3);
      if (!result || diagnostics.length) {
        throw new Error('Typst compilation failed: ' + JSON.stringify(diagnostics));
      }
      if (result.byteLength > 64 * 1024 * 1024) throw new Error('PDF exceeds 64 MiB');
      parentPort.postMessage({ result });
    } finally { world.free(); }
  } finally { compiler.free(); }
})().catch(error => parentPort.postMessage({ error: String(error.message ?? error) }));
`;

const FONTS = ['NewCM10-Regular.otf', 'NewCM10-Bold.otf', 'NewCM10-Italic.otf',
  'NewCM10-BoldItalic.otf', 'NewCMMath-Regular.otf', 'DejaVuSansMono.ttf'];
let activeCompilations = 0;

function visibleText(ast: LumenDocumentAst, options: PdfOptions): string {
  const parts = [options.title ?? ast.frontmatter.title ?? 'Document', options.author, options.date, options.abstract];
  const nodes: LumenNode[] = [...ast.children];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (node.children) nodes.push(...node.children);
    for (const key of ['value', 'tex', 'raw', 'title', 'label', 'code'] as const) {
      if (typeof node[key] === 'string') parts.push(node[key]);
    }
  }
  return parts.filter((part): part is string => typeof part === 'string').join('');
}

/** Compile a projected document through the real Typst engine, offline, in a disposable Worker. */
export async function compileTypst(ast: LumenDocumentAst, options: PdfOptions = {}): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) throw new RangeError('PDF timeout must be 1–120000 ms');
  const source = toTypst(ast, options);
  if (Buffer.byteLength(source) > 2 * 1024 * 1024) throw new RangeError('PDF source exceeds 2 MiB');
  const fontData = options.fontData ?? [];
  if (fontData.length > 16 || fontData.some((font) => !(font instanceof Uint8Array)) ||
      fontData.reduce((size, font) => size + font.byteLength, 0) > 32 * 1024 * 1024) {
    throw new RangeError('PDF fonts exceed 16 files or 32 MiB');
  }
  if (activeCompilations >= 4) throw new Error('PDF compiler capacity reached (4 workers)');
  activeCompilations++;
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    worker = new Worker(BOOTSTRAP, {
      eval: true, env: {}, execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
      workerData: {
        engine: import.meta.resolve('@myriaddreamin/typst-ts-web-compiler'), source, fontData,
        fontkit: import.meta.resolve('fontkit'), glyphText: visibleText(ast, options),
        fontUrls: FONTS.map((name) => new URL(`../../fonts/${name}`, import.meta.url).href),
      },
    });
    return await new Promise<Uint8Array>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`PDF compilation exceeded ${timeout} ms`)), timeout);
      abort = () => reject(options.signal?.reason ?? new Error('PDF compilation aborted'));
      options.signal?.addEventListener('abort', abort, { once: true });
      worker!.once('error', reject);
      worker!.once('exit', (code) => reject(new Error(`PDF worker exited before completion (${code})`)));
      worker!.once('message', (message: { result?: Uint8Array; error?: string }) => {
        if (message.result instanceof Uint8Array) resolve(message.result);
        else reject(new Error(message.error ?? 'Typst returned no PDF'));
      });
      if (options.signal?.aborted) abort();
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) options.signal?.removeEventListener('abort', abort);
    try { await worker?.terminate(); } finally { activeCompilations--; }
  }
}
