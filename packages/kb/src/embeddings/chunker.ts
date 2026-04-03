import type { ICodeChunk, ISymbolDoc } from '../core/types.js';

export interface ChunkerOptions {
  /** Target tokens per chunk (default: 400) */
  targetTokens?: number;
  /** Max tokens per chunk (default: 600) */
  maxTokens?: number;
  /** Overlap in lines between chunks (default: 2) */
  overlapLines?: number;
}

/**
 * AST-aware code chunker.
 * Splits code into chunks that respect symbol boundaries (classes, functions)
 * rather than splitting mid-statement.
 */
export class Chunker {
  private readonly targetTokens: number;
  private readonly maxTokens: number;
  private readonly overlapLines: number;

  constructor(options: ChunkerOptions = {}) {
    this.targetTokens = options.targetTokens ?? 400;
    this.maxTokens = options.maxTokens ?? 600;
    this.overlapLines = options.overlapLines ?? 2;
  }

  /**
   * Chunk a source file using symbol boundaries from ts-morph extraction.
   * Symbols act as natural chunk boundaries.
   */
  chunkWithSymbols(
    content: string,
    filePath: string,
    packageName: string,
    symbols: ISymbolDoc[],
  ): ICodeChunk[] {
    const lines = content.split('\n');
    const chunks: ICodeChunk[] = [];

    // Sort symbols by line number
    const fileSymbols = symbols
      .filter(s => s.filePath === filePath)
      .sort((a, b) => a.line - b.line);

    if (fileSymbols.length === 0) {
      // No symbols — fall back to line-based chunking
      return this.chunkByLines(content, filePath, packageName);
    }

    // Create chunks around symbol boundaries
    let currentStart = 0;

    for (const sym of fileSymbols) {
      const symLine = sym.line - 1; // 0-indexed

      // If there's a gap between current position and symbol, chunk it
      if (symLine > currentStart + 5) {
        const gapContent = lines.slice(currentStart, symLine).join('\n');
        const gapTokens = this.estimateTokens(gapContent);
        if (gapTokens > 20) {
          chunks.push({
            source: filePath,
            range: { start: currentStart + 1, end: symLine },
            content: gapContent,
            package: packageName,
            tokens: gapTokens,
          });
        }
      }

      // Find the end of this symbol (next symbol start or end of file)
      const nextSymbol = fileSymbols.find(s => s.line - 1 > symLine);
      const symEnd = nextSymbol ? nextSymbol.line - 2 : lines.length - 1;

      const symContent = lines.slice(symLine, symEnd + 1).join('\n');
      const symTokens = this.estimateTokens(symContent);

      if (symTokens <= this.maxTokens) {
        // Symbol fits in one chunk
        chunks.push({
          source: filePath,
          range: { start: symLine + 1, end: symEnd + 1 },
          content: symContent,
          symbol: sym.name,
          package: packageName,
          tokens: symTokens,
        });
      } else {
        // Symbol too large — split by methods/members
        const subChunks = this.splitLargeSymbol(
          lines, symLine, symEnd, sym.name, filePath, packageName,
        );
        chunks.push(...subChunks);
      }

      currentStart = symEnd + 1;
    }

    return chunks;
  }

  /**
   * Fallback: chunk by lines with overlap.
   */
  chunkByLines(content: string, filePath: string, packageName: string): ICodeChunk[] {
    const lines = content.split('\n');
    const chunks: ICodeChunk[] = [];
    let start = 0;

    while (start < lines.length) {
      let end = start;
      let tokens = 0;

      while (end < lines.length && tokens < this.targetTokens) {
        tokens += this.estimateTokens(lines[end]!) + 1; // +1 for newline
        end++;
      }

      const chunkContent = lines.slice(start, end).join('\n');
      chunks.push({
        source: filePath,
        range: { start: start + 1, end },
        content: chunkContent,
        package: packageName,
        tokens: this.estimateTokens(chunkContent),
      });

      start = Math.max(start + 1, end - this.overlapLines);
    }

    return chunks;
  }

  /**
   * Split a large symbol (e.g., 200-line class) into sub-chunks.
   */
  private splitLargeSymbol(
    lines: string[],
    start: number,
    end: number,
    symbolName: string,
    filePath: string,
    packageName: string,
  ): ICodeChunk[] {
    const chunks: ICodeChunk[] = [];
    let chunkStart = start;

    while (chunkStart <= end) {
      let chunkEnd = chunkStart;
      let tokens = 0;

      while (chunkEnd <= end && tokens < this.targetTokens) {
        tokens += this.estimateTokens(lines[chunkEnd]!) + 1;
        chunkEnd++;
      }

      // Try to break at a natural boundary (empty line, closing brace)
      const adjustedEnd = this.findNaturalBreak(lines, chunkEnd, end);

      const content = lines.slice(chunkStart, adjustedEnd + 1).join('\n');
      chunks.push({
        source: filePath,
        range: { start: chunkStart + 1, end: adjustedEnd + 1 },
        content,
        symbol: symbolName,
        package: packageName,
        tokens: this.estimateTokens(content),
      });

      chunkStart = Math.max(chunkStart + 1, adjustedEnd + 1 - this.overlapLines);
    }

    return chunks;
  }

  /**
   * Find a natural break point near the target line.
   */
  private findNaturalBreak(lines: string[], target: number, max: number): number {
    // Look forward up to 5 lines for an empty line or closing brace
    for (let i = target; i <= Math.min(target + 5, max); i++) {
      const line = lines[i]?.trim() ?? '';
      if (line === '' || line === '}' || line === '};') return i;
    }
    // Look backward
    for (let i = target; i >= Math.max(target - 3, 0); i--) {
      const line = lines[i]?.trim() ?? '';
      if (line === '' || line === '}' || line === '};') return i;
    }
    return Math.min(target, max);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
