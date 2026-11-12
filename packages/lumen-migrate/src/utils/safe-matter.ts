import { parseSafeFrontmatter as parseMetadata } from '@omnitron-dev/lumen-ast';

export class DisabledFrontmatterEngineError extends Error {
  constructor(engineName: string) {
    super(`Executable frontmatter engine "${engineName}" is disabled.`);
    this.name = 'DisabledFrontmatterEngineError';
  }
}

export interface SafeMatterResult {
  data: Record<string, unknown>;
  content: string;
}

export function parseSafeFrontmatter(rawContent: string): SafeMatterResult {
  const parsed = parseMetadata(rawContent);
  const error = parsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error?.code === 'EXECUTABLE_FRONTMATTER_FORBIDDEN') throw new DisabledFrontmatterEngineError('script');
  if (error) throw new Error(error.message);
  return { data: parsed.data, content: parsed.content };
}
