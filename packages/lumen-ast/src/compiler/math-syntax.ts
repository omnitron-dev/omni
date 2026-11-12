import type { Options } from 'mdast-util-from-markdown';
import { math as tokenizer } from 'micromark-extension-math';

// This build asset exposes only syntax. Its declaration uses the parser's
// published extension contract, without retaining the bundled dev dependency.
export const math: () => NonNullable<Options['extensions']>[number] = tokenizer;
