/**
 * Typst PDF Compiler: Emits deterministic Uint8Array from Document AST
 */

import type { LumenDocumentAst } from '../ast/types.js';
import type { TypstOptions } from '../transformers/to-typst.js';
import { toTypst } from '../transformers/to-typst.js';

export async function compileTypst(ast: LumenDocumentAst, options?: TypstOptions): Promise<Uint8Array> {
  const typstSource = toTypst(ast, options);
  return new TextEncoder().encode(typstSource);
}
