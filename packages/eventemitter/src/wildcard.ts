import type { PatternCache } from './types.js';

/**
 * Wildcard pattern matcher for event names
 */
export class WildcardMatcher {
  private delimiter: string;
  private wildcard: string;
  private globstar: string;
  private cache: Map<string, PatternCache> = new Map();

  constructor(delimiter = '.', wildcard = '*', globstar = '**') {
    this.delimiter = delimiter;
    this.wildcard = wildcard;
    this.globstar = globstar;
  }

  /**
   * Check if a pattern contains wildcards
   */
  isWildcard(pattern: string): boolean {
    return pattern.includes(this.wildcard) || pattern.includes(this.globstar);
  }

  /**
   * Match an event name against a pattern
   */
  match(eventName: string, pattern: string): boolean {
    // Direct match
    if (eventName === pattern) return true;

    // No wildcards, no match
    if (!this.isWildcard(pattern)) return false;

    // Get or create cached pattern
    const cached = this.getOrCreatePattern(pattern);
    return cached.regex.test(eventName);
  }

  /**
   * Find all patterns that match an event name
   */
  findMatchingPatterns(eventName: string, patterns: string[]): string[] {
    return patterns.filter((pattern) => this.match(eventName, pattern));
  }

  /**
   * Get or create a cached pattern
   */
  private getOrCreatePattern(pattern: string): PatternCache {
    let cached = this.cache.get(pattern);
    if (!cached) {
      cached = this.compilePattern(pattern);
      this.cache.set(pattern, cached);
    }
    return cached;
  }

  /**
   * Compile a pattern into a regex
   */
  private compilePattern(pattern: string): PatternCache {
    const parts = pattern.split(this.delimiter);
    const isWildcard = this.isWildcard(pattern);

    if (!isWildcard) {
      return {
        pattern,
        regex: new RegExp(`^${this.escapeRegex(pattern)}$`),
        parts,
        isWildcard: false,
      };
    }

    let regexStr = '^';
    let addedDelimiter = false;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      // Handle undefined or empty parts (consecutive delimiters)
      if (!part || part === '') {
        if (i === 0) {
          // Empty part at the beginning (e.g., ".start" split gives ["", "start"])
          // Don't add anything, but we'll need a delimiter before next non-empty part
          addedDelimiter = false;
        } else if (i === parts.length - 1) {
          // Empty part at the end (e.g., "end." split gives ["end", ""])
          // Add delimiter if needed
          if (!addedDelimiter && i > 0) {
            regexStr += this.escapeRegex(this.delimiter);
          }
        } else {
          // Empty part in the middle - add delimiter
          if (!addedDelimiter) {
            regexStr += this.escapeRegex(this.delimiter);
            addedDelimiter = true;
          }
        }
        continue;
      }

      // Add delimiter before part if not first and not already added
      const needsDelimiter = i > 0 && !addedDelimiter;

      if (part === this.globstar) {
        // ** matches zero or more segments
        if (i === 0) {
          // ** at the beginning
          if (parts.length === 1) {
            // Just ** - matches everything
            regexStr += '.*';
          } else {
            // **.something - matches "something" or "anything.something"
            regexStr += `(?:.*${this.escapeRegex(this.delimiter)})?`;
          }
          addedDelimiter = true; // Delimiter already included in pattern
        } else if (i === parts.length - 1) {
          // ** at the end - matches remaining path or nothing
          if (needsDelimiter) {
            regexStr += `(?:${this.escapeRegex(this.delimiter)}.*)?`;
          } else {
            regexStr += '(?:.*)?';
          }
          addedDelimiter = false;
        } else {
          // ** in the middle - matches zero or more segments between parts
          // Example: app.**.error should match:
          //   - app.error (zero segments)
          //   - app.db.error (one segment)
          //   - app.db.connection.error (multiple segments)
          if (needsDelimiter) {
            const delim = this.escapeRegex(this.delimiter);
            // Match either:
            // - just delimiter for zero segments (app.error)
            // - delimiter + content + delimiter for 1+ segments (app.xxx.error)
            regexStr += `${delim}(?:.*${delim})?`;
          } else {
            // Should not happen in practice as ** in middle always follows something
            regexStr += `(?:.*${this.escapeRegex(this.delimiter)})?`;
          }
          addedDelimiter = true; // Delimiter is already part of the pattern
        }
      } else if (part === this.wildcard) {
        if (needsDelimiter) {
          regexStr += this.escapeRegex(this.delimiter);
        }
        // * matches exactly one segment (not containing delimiter, can be empty)
        regexStr += `[^${this.escapeRegex(this.delimiter)}]*`;
        addedDelimiter = false;
      } else if (part.includes(this.wildcard)) {
        if (needsDelimiter) {
          regexStr += this.escapeRegex(this.delimiter);
        }
        // Handle partial wildcards like "user*" or "*Service"
        let partRegex = '';
        let lastIdx = 0;
        let idx = part.indexOf(this.wildcard);

        while (idx !== -1) {
          if (idx > lastIdx) {
            partRegex += this.escapeRegex(part.substring(lastIdx, idx));
          }
          partRegex += `[^${this.escapeRegex(this.delimiter)}]*`;
          lastIdx = idx + this.wildcard.length;
          idx = part.indexOf(this.wildcard, lastIdx);
        }

        if (lastIdx < part.length) {
          partRegex += this.escapeRegex(part.substring(lastIdx));
        }

        regexStr += partRegex;
        addedDelimiter = false;
      } else {
        // Literal part
        if (needsDelimiter) {
          regexStr += this.escapeRegex(this.delimiter);
        }
        regexStr += this.escapeRegex(part);
        addedDelimiter = false;
      }
    }
    regexStr += '$';

    const regex = new RegExp(regexStr);

    return {
      pattern,
      regex,
      parts,
      isWildcard: true,
    };
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Clear the pattern cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache size for monitoring
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}
