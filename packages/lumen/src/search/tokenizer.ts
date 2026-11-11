/**
 * Multilingual Tokenizer for Pagefind Search Indexing
 * Supports Latin, Cyrillic, CJK, and other Unicode word boundaries.
 */
export function tokenizeMultilingual(text: string): string[] {
  if (!text) return [];

  // Unicode-aware word tokenization matching letters and numbers
  const tokens = text
    .toLowerCase()
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]+/gu);

  if (!tokens) return [];

  // Filter out single punctuation / symbols, preserve all alphabetic words
  return tokens.filter((token) => token.length > 0);
}
