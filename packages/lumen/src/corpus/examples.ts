import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { LumenNode } from '@omnitron-dev/lumen-ast';
import type { LumenConfig } from '../config/schema.js';
import type { CorpusGraph } from './graph.js';

const MAX_SOURCE_BYTES = 1024 * 1024;

/** Only the trusted config selects files; callers must supply the audience-projected corpus. */
export function resolveExampleSources(corpus: CorpusGraph, config: LumenConfig, rootDir: string): void {
  if (!config.examples) return;
  const root = realpathSync(rootDir);
  const sources = new Map<string, string>();
  const readSource = (file: string) => {
    if (isAbsolute(file)) throw new Error('Example sources must be relative to the project root');
    const path = realpathSync(resolve(root, file));
    const within = relative(root, path);
    if (within === '..' || within.startsWith('..' + sep) || isAbsolute(within))
      throw new Error('Example source escapes the project root');
    const cached = sources.get(path);
    if (cached !== undefined) return cached;
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) throw new Error('Example source must be a file of at most 1 MiB');
      const bytes = readFileSync(fd);
      if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('Example source exceeds 1 MiB');
      const code = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      sources.set(path, code);
      return code;
    } finally { closeSync(fd); }
  };

  const project = (nodes: LumenNode[]): LumenNode[] => nodes.map(node => {
    const next = { ...node, ...(node.children ? { children: project(node.children) } : {}) };
    if (node.type !== 'jsxWidget' || !Object.hasOwn(config.examples!, String(node.name))) return next;
    const group = config.examples![String(node.name)]!;
    const id = node.props?.['example'];
    if (typeof id !== 'string' || !Object.hasOwn(group.sources, id))
      throw new Error(`Unregistered example for ${node.name}: ${String(id)}`);
    if (node.exampleSource) throw new Error('Example source is already resolved');
    return {
      ...next,
      exampleSource: {
        id,
        title: typeof node.props?.['title'] === 'string' ? node.props['title'] : id,
        labels: group.labels,
      },
      children: [...(next.children ?? []), { type: 'codeBlock', lang: group.language, value: readSource(group.sources[id]!) }],
    };
  });

  for (const document of corpus.getAllDocuments()) {
    if (document.ast) document.ast = { ...document.ast, children: project(document.ast.children) };
  }
}
