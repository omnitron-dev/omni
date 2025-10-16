/**
 * SVG Path Utilities
 *
 * Utilities for parsing, manipulating, and analyzing SVG paths.
 *
 * @module svg/utils/path
 */

/**
 * Path command interface
 */
export interface PathCommand {
  type: string;
  values: number[];
}

/**
 * Path bounds
 */
export interface PathBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Point coordinates
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Parse SVG path string into commands
 *
 * @param pathData - SVG path data string
 * @returns Array of path commands
 *
 * @example
 * ```typescript
 * const commands = parsePath('M 10 10 L 20 20');
 * // [{ type: 'M', values: [10, 10] }, { type: 'L', values: [20, 20] }]
 * ```
 */
export function parsePath(pathData: string): PathCommand[] {
  // Handle null, undefined, or empty input
  if (!pathData || typeof pathData !== 'string') {
    return [];
  }

  const commands: PathCommand[] = [];
  // Updated regex to avoid matching letters inside NaN/Infinity
  // Look for command letters followed by whitespace, comma, digit, sign, or end
  const commandRegex = /([MLHVCSQTAZmlhvcsqtaz])(?=[\s,\d.+-]|$)/g;

  let match;
  const matches: Array<{ type: string; start: number; end: number }> = [];

  // Find all command positions
  while ((match = commandRegex.exec(pathData)) !== null) {
    matches.push({
      type: match[1]!,
      start: match.index,
      end: match.index + 1,
    });
  }

  // Extract values between commands
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!;
    const next = matches[i + 1];
    const type = current.type;
    const valueString = pathData.substring(current.end, next ? next.start : pathData.length).trim();

    // Parse values
    const values: number[] = [];
    if (valueString) {
      // Updated regex to also match NaN and Infinity
      const valueRegex = /[-+]?(?:NaN|Infinity|[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/g;
      let valueMatch;
      while ((valueMatch = valueRegex.exec(valueString)) !== null) {
        values.push(parseFloat(valueMatch[0]!));
      }
    }

    commands.push({ type, values });
  }

  return commands;
}

/**
 * Normalize path to absolute coordinates
 *
 * Converts all relative path commands to absolute coordinates.
 *
 * @param pathData - SVG path data string
 * @returns Normalized path string with absolute coordinates
 *
 * @example
 * ```typescript
 * const normalized = normalizePath('m 10 10 l 20 20');
 * // 'M 10 10 L 30 30'
 * ```
 */
export function normalizePath(pathData: string): string {
  const commands = parsePath(pathData);
  const normalized: string[] = [];
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  for (const cmd of commands) {
    const type = cmd.type;
    const values = [...cmd.values];
    let newCmd = '';

    switch (type.toUpperCase()) {
      case 'M':
        if (type === 'm' && normalized.length > 0) {
          // Relative move
          currentX += values[0] ?? 0;
          currentY += values[1] ?? 0;
        } else {
          // Absolute move
          currentX = values[0] ?? 0;
          currentY = values[1] ?? 0;
        }
        startX = currentX;
        startY = currentY;
        newCmd = `M ${currentX} ${currentY}`;
        break;

      case 'L':
        if (type === 'l') {
          currentX += values[0] ?? 0;
          currentY += values[1] ?? 0;
        } else {
          currentX = values[0] ?? 0;
          currentY = values[1] ?? 0;
        }
        newCmd = `L ${currentX} ${currentY}`;
        break;

      case 'H':
        if (type === 'h') {
          currentX += values[0] ?? 0;
        } else {
          currentX = values[0] ?? 0;
        }
        newCmd = `L ${currentX} ${currentY}`;
        break;

      case 'V':
        if (type === 'v') {
          currentY += values[0] ?? 0;
        } else {
          currentY = values[0] ?? 0;
        }
        newCmd = `L ${currentX} ${currentY}`;
        break;

      case 'C':
        if (type === 'c') {
          values[0] = (values[0] ?? 0) + currentX;
          values[1] = (values[1] ?? 0) + currentY;
          values[2] = (values[2] ?? 0) + currentX;
          values[3] = (values[3] ?? 0) + currentY;
          values[4] = (values[4] ?? 0) + currentX;
          values[5] = (values[5] ?? 0) + currentY;
        }
        currentX = values[4] ?? 0;
        currentY = values[5] ?? 0;
        newCmd = `C ${values.join(' ')}`;
        break;

      case 'S':
        if (type === 's') {
          values[0] = (values[0] ?? 0) + currentX;
          values[1] = (values[1] ?? 0) + currentY;
          values[2] = (values[2] ?? 0) + currentX;
          values[3] = (values[3] ?? 0) + currentY;
        }
        currentX = values[2] ?? 0;
        currentY = values[3] ?? 0;
        newCmd = `S ${values.join(' ')}`;
        break;

      case 'Q':
        if (type === 'q') {
          values[0] = (values[0] ?? 0) + currentX;
          values[1] = (values[1] ?? 0) + currentY;
          values[2] = (values[2] ?? 0) + currentX;
          values[3] = (values[3] ?? 0) + currentY;
        }
        currentX = values[2] ?? 0;
        currentY = values[3] ?? 0;
        newCmd = `Q ${values.join(' ')}`;
        break;

      case 'T':
        if (type === 't') {
          values[0] = (values[0] ?? 0) + currentX;
          values[1] = (values[1] ?? 0) + currentY;
        }
        currentX = values[0] ?? 0;
        currentY = values[1] ?? 0;
        newCmd = `T ${values.join(' ')}`;
        break;

      case 'A':
        if (type === 'a') {
          values[5] = (values[5] ?? 0) + currentX;
          values[6] = (values[6] ?? 0) + currentY;
        }
        currentX = values[5] ?? 0;
        currentY = values[6] ?? 0;
        newCmd = `A ${values.join(' ')}`;
        break;

      case 'Z':
        currentX = startX;
        currentY = startY;
        newCmd = 'Z';
        break;

      default:
        // Unknown command type - skip
        break;
    }

    normalized.push(newCmd);
  }

  return normalized.join(' ');
}

/**
 * Simplify path by removing redundant commands
 *
 * @param pathData - SVG path data string
 * @param precision - Number of decimal places (default: 2)
 * @returns Simplified path string
 *
 * @example
 * ```typescript
 * const simplified = simplifyPath('M 10.12345 10.67890 L 20.11111 20.99999', 2);
 * // 'M 10.12 10.68 L 20.11 21'
 * ```
 */
export function simplifyPath(pathData: string, precision: number = 2): string {
  const commands = parsePath(pathData);
  const simplified: string[] = [];

  const round = (num: number) => {
    const factor = Math.pow(10, precision);
    return Math.round(num * factor) / factor;
  };

  for (const cmd of commands) {
    const roundedValues = cmd.values.map(round);
    const valueStr = roundedValues.length > 0 ? ` ${roundedValues.join(' ')}` : '';
    simplified.push(`${cmd.type}${valueStr}`);
  }

  return simplified.join(' ');
}

/**
 * Calculate bounding box of path
 *
 * @param pathData - SVG path data string
 * @returns Bounding box {x, y, width, height}
 *
 * @example
 * ```typescript
 * const bounds = calculatePathBounds('M 10 10 L 90 90');
 * // { x: 10, y: 10, width: 80, height: 80 }
 * ```
 */
export function calculatePathBounds(pathData: string): PathBounds {
  const commands = parsePath(pathData);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let currentX = 0;
  let currentY = 0;

  const updateBounds = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const cmd of commands) {
    const type = cmd.type;
    const values = cmd.values;

    switch (type.toUpperCase()) {
      case 'M':
      case 'L':
        if (type === type.toLowerCase() && commands.indexOf(cmd) > 0) {
          currentX += values[0] ?? 0;
          currentY += values[1] ?? 0;
        } else {
          currentX = values[0] ?? 0;
          currentY = values[1] ?? 0;
        }
        updateBounds(currentX, currentY);
        break;

      case 'H':
        currentX = type === 'h' ? currentX + (values[0] ?? 0) : (values[0] ?? 0);
        updateBounds(currentX, currentY);
        break;

      case 'V':
        currentY = type === 'v' ? currentY + (values[0] ?? 0) : (values[0] ?? 0);
        updateBounds(currentX, currentY);
        break;

      case 'C': {
        // For cubic bezier, check control points and end point
        const isRelative = type === 'c';
        const c1x = isRelative ? currentX + (values[0] ?? 0) : (values[0] ?? 0);
        const c1y = isRelative ? currentY + (values[1] ?? 0) : (values[1] ?? 0);
        const c2x = isRelative ? currentX + (values[2] ?? 0) : (values[2] ?? 0);
        const c2y = isRelative ? currentY + (values[3] ?? 0) : (values[3] ?? 0);
        const endX = isRelative ? currentX + (values[4] ?? 0) : (values[4] ?? 0);
        const endY = isRelative ? currentY + (values[5] ?? 0) : (values[5] ?? 0);
        updateBounds(c1x, c1y);
        updateBounds(c2x, c2y);
        updateBounds(endX, endY);
        currentX = endX;
        currentY = endY;
        break;
      }

      case 'Q':
      case 'S':
      case 'T': {
        // Simplified - just use end point
        const qEndX =
          type === type.toLowerCase() ? currentX + (values[values.length - 2] ?? 0) : (values[values.length - 2] ?? 0);
        const qEndY =
          type === type.toLowerCase() ? currentY + (values[values.length - 1] ?? 0) : (values[values.length - 1] ?? 0);
        updateBounds(qEndX, qEndY);
        currentX = qEndX;
        currentY = qEndY;
        break;
      }

      case 'A': {
        // Arc - use end point (simplified)
        const aEndX = type === 'a' ? currentX + (values[5] ?? 0) : (values[5] ?? 0);
        const aEndY = type === 'a' ? currentY + (values[6] ?? 0) : (values[6] ?? 0);
        updateBounds(aEndX, aEndY);
        currentX = aEndX;
        currentY = aEndY;
        break;
      }

      default:
        // Unknown command - skip
        break;
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Get center point of path
 *
 * @param pathData - SVG path data string
 * @returns Center point {x, y}
 *
 * @example
 * ```typescript
 * const center = getPathCenter('M 10 10 L 90 90');
 * // { x: 50, y: 50 }
 * ```
 */
export function getPathCenter(pathData: string): Point {
  const bounds = calculatePathBounds(pathData);
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

/**
 * Reverse path direction
 *
 * @param pathData - SVG path data string
 * @returns Reversed path string
 *
 * @example
 * ```typescript
 * const reversed = reversePath('M 10 10 L 20 20 L 30 10 Z');
 * // 'M 30 10 L 20 20 L 10 10 Z'
 * ```
 */
export function reversePath(pathData: string): string {
  const commands = parsePath(pathData);
  const reversed: string[] = [];

  // Reverse the commands array
  const reversedCommands = [...commands].reverse();

  for (let i = 0; i < reversedCommands.length; i++) {
    const cmd = reversedCommands[i];
    if (!cmd) continue;

    // Keep the first M command at the start
    if (i === 0 && cmd.type.toUpperCase() === 'M') {
      reversed.push(`${cmd.type} ${cmd.values.join(' ')}`);
    } else if (cmd.type.toUpperCase() === 'Z') {
      // Keep Z at the end
      continue;
    } else {
      reversed.push(`${cmd.type} ${cmd.values.join(' ')}`);
    }
  }

  // Add Z if original had it
  const lastCmd = commands[commands.length - 1];
  if (lastCmd?.type.toUpperCase() === 'Z') {
    reversed.push('Z');
  }

  return reversed.join(' ');
}

/**
 * Convert path to relative coordinates
 *
 * @param pathData - SVG path data string
 * @returns Path string with relative coordinates
 *
 * @example
 * ```typescript
 * const relative = toRelativePath('M 10 10 L 20 20 L 30 30');
 * // 'M 10 10 l 10 10 l 10 10'
 * ```
 */
export function toRelativePath(pathData: string): string {
  const commands = parsePath(pathData);
  const relative: string[] = [];
  let currentX = 0;
  let currentY = 0;

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd) continue;
    const type = cmd.type;
    const values = [...cmd.values];

    // First M command stays absolute
    if (i === 0 && type.toUpperCase() === 'M') {
      currentX = values[0] ?? 0;
      currentY = values[1] ?? 0;
      relative.push(`M ${values.join(' ')}`);
      continue;
    }

    // Convert absolute to relative
    if (type === type.toUpperCase()) {
      switch (type) {
        case 'M':
        case 'L': {
          const relX = (values[0] ?? 0) - currentX;
          const relY = (values[1] ?? 0) - currentY;
          values[0] = relX;
          values[1] = relY;
          currentX += relX;
          currentY += relY;
          relative.push(`${type.toLowerCase()} ${values.join(' ')}`);
          break;
        }

        case 'H': {
          const relX = (values[0] ?? 0) - currentX;
          values[0] = relX;
          currentX += relX;
          relative.push(`h ${values[0]}`);
          break;
        }

        case 'V': {
          const relY = (values[0] ?? 0) - currentY;
          values[0] = relY;
          currentY += relY;
          relative.push(`v ${values[0]}`);
          break;
        }

        case 'Z':
          relative.push('z');
          break;

        default:
          // Keep other commands as-is for now
          relative.push(`${type} ${values.join(' ')}`);
          if (type === 'C' || type === 'S' || type === 'Q' || type === 'T') {
            currentX = values[values.length - 2] ?? 0;
            currentY = values[values.length - 1] ?? 0;
          }
          break;
      }
    } else {
      // Already relative
      relative.push(`${type} ${values.join(' ')}`);
      if (type === 'm' || type === 'l') {
        currentX += values[0] ?? 0;
        currentY += values[1] ?? 0;
      }
    }
  }

  return relative.join(' ');
}
