'use client';

/**
 * Error Boundary Component
 *
 * React error boundary for graceful error handling.
 * Includes stack trace parsing for improved debugging.
 *
 * @module @omnitron-dev/prism/components/error-boundary
 */

import { Component, useState, type ReactNode, type ErrorInfo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// STACK TRACE PARSING
// =============================================================================

/**
 * Parsed stack frame information.
 */
export interface StackFrame {
  /** Function or method name */
  functionName: string | null;
  /** Source file path */
  filePath: string | null;
  /** Line number in the file */
  lineNumber: number | null;
  /** Column number in the file */
  columnNumber: number | null;
  /** Whether this frame is from app code (src/) vs node_modules */
  isAppCode: boolean;
}

/**
 * Parsed stack trace result.
 */
export interface ParsedStackTrace {
  /** Primary error location (first app code frame) */
  primary: StackFrame | null;
  /** All parsed frames */
  frames: StackFrame[];
  /** Original stack trace string */
  raw: string;
}

/**
 * Parse a single stack frame line.
 *
 * @param line - Stack trace line
 * @returns Parsed stack frame or null if couldn't parse
 */
function parseStackFrame(line: string): StackFrame | null {
  // Match patterns like:
  // "at functionName (file.tsx:123:45)"
  // "at Object.functionName (file.tsx:123:45)"
  // "at file.tsx:123:45"
  // "at async functionName (file.tsx:123:45)"
  const patterns = [
    // Named function with file: at functionName (file:line:col)
    /at\s+(?:async\s+)?([^\s(]+)\s+\((.+?):(\d+):(\d+)\)/,
    // Anonymous at file: at file:line:col
    /at\s+(.+?):(\d+):(\d+)/,
    // Webpack/Vite transformed: at Module.functionName (file?xxx:line:col)
    /at\s+(?:async\s+)?(?:Module\.)?([^\s(]+)\s+\((.+?)\?[^:]*:(\d+):(\d+)\)/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      const [, funcOrFile, file, lineStr, colStr] = match;

      // Check if first capture is actually a function name or file path
      const hasFile = file !== undefined;
      const functionName = hasFile ? funcOrFile : null;
      const filePath = hasFile ? file : funcOrFile;
      const lineNumber = parseInt(hasFile ? lineStr : (file as string), 10);
      const columnNumber = parseInt(hasFile ? colStr : lineStr, 10);

      // Determine if this is app code vs library code
      const isAppCode = filePath.includes('/src/') || (filePath.includes('src/') && !filePath.includes('node_modules'));

      return {
        functionName: functionName || null,
        filePath: cleanFilePath(filePath),
        lineNumber: isNaN(lineNumber) ? null : lineNumber,
        columnNumber: isNaN(columnNumber) ? null : columnNumber,
        isAppCode,
      };
    }
  }

  return null;
}

/**
 * Clean file path for display.
 */
function cleanFilePath(path: string): string {
  // Remove webpack/vite query strings
  const cleaned = path.replace(/\?.*$/, '');

  // Try to extract relative path from src/
  const srcIndex = cleaned.indexOf('/src/');
  if (srcIndex !== -1) {
    return cleaned.slice(srcIndex + 1);
  }

  // Try to get a reasonable path from the end
  const parts = cleaned.split('/');
  if (parts.length > 3) {
    return parts.slice(-3).join('/');
  }

  return cleaned;
}

/**
 * Parse an error stack trace into structured data.
 *
 * Extracts function names, file paths, and line numbers from stack traces.
 * Identifies app code vs library code for better debugging.
 *
 * @param stack - Error stack trace string
 * @returns Parsed stack trace with frames
 *
 * @example
 * ```tsx
 * try {
 *   throw new Error('Something went wrong');
 * } catch (error) {
 *   const parsed = parseStackTrace(error.stack);
 *   console.log('Error in:', parsed.primary?.filePath);
 *   console.log('Function:', parsed.primary?.functionName);
 *   console.log('Line:', parsed.primary?.lineNumber);
 * }
 * ```
 */
export function parseStackTrace(stack?: string): ParsedStackTrace {
  if (!stack) {
    return { primary: null, frames: [], raw: '' };
  }

  const lines = stack.split('\n');
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const frame = parseStackFrame(line.trim());
    if (frame) {
      frames.push(frame);
    }
  }

  // Find the first app code frame as the primary location
  const primary = frames.find((f) => f.isAppCode) ?? frames[0] ?? null;

  return { primary, frames, raw: stack };
}

/**
 * Get a summary of the error location.
 *
 * @param error - Error object
 * @returns Human-readable error location
 */
export function getErrorLocation(error: Error): string {
  const parsed = parseStackTrace(error.stack);
  const { primary } = parsed;

  if (!primary) {
    return 'Unknown location';
  }

  const parts: string[] = [];

  if (primary.functionName) {
    parts.push(`in ${primary.functionName}`);
  }

  if (primary.filePath) {
    const location = primary.lineNumber ? `${primary.filePath}:${primary.lineNumber}` : primary.filePath;
    parts.push(`(${location})`);
  }

  return parts.join(' ') || 'Unknown location';
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Error fallback component props.
 */
export interface FallbackProps {
  /** The error that was caught */
  error: Error;
  /** Error info from React */
  errorInfo: ErrorInfo | null;
  /** Parsed stack trace for debugging */
  parsedStack: ParsedStackTrace;
  /** Reset error boundary state */
  resetErrorBoundary: () => void;
}

/**
 * Error boundary props.
 */
export interface ErrorBoundaryProps {
  /** Child components to render */
  children: ReactNode;
  /** Custom fallback component */
  fallback?: ReactNode | ((props: FallbackProps) => ReactNode);
  /** Callback when error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo, parsedStack: ParsedStackTrace) => void;
  /** Callback when error is reset */
  onReset?: () => void;
  /** Reset keys - boundary resets when these change */
  resetKeys?: unknown[];
  /** Custom sx props for default fallback */
  sx?: SxProps<Theme>;
  /** Show detailed stack info in default fallback (auto-detects dev mode if not set) */
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// =============================================================================
// DEFAULT FALLBACK
// =============================================================================

interface DefaultFallbackProps extends FallbackProps {
  sx?: SxProps<Theme>;
  /** Show detailed stack info (auto-detected in dev) */
  showDetails?: boolean;
}

function DefaultErrorFallback({
  error,
  parsedStack,
  resetErrorBoundary,
  sx,
  showDetails,
}: DefaultFallbackProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Auto-detect dev mode if not specified
  const shouldShowDetails = showDetails ?? (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');

  const handleCopyStack = async () => {
    try {
      const text = [
        `Error: ${error.message}`,
        `Location: ${getErrorLocation(error)}`,
        '',
        'Stack Trace:',
        parsedStack.raw,
      ].join('\n');

      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
        p: 3,
        textAlign: 'center',
        ...sx,
      }}
    >
      <Typography variant="h6" color="error" gutterBottom>
        Something went wrong
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 1, maxWidth: 400 }}>
        {error.message || 'An unexpected error occurred'}
      </Typography>

      {shouldShowDetails && parsedStack.primary && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 2, fontFamily: 'monospace' }}>
          {parsedStack.primary.filePath}
          {parsedStack.primary.lineNumber && `:${parsedStack.primary.lineNumber}`}
          {parsedStack.primary.functionName && ` (${parsedStack.primary.functionName})`}
        </Typography>
      )}

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <Button variant="outlined" onClick={resetErrorBoundary}>
          Try Again
        </Button>

        {shouldShowDetails && (
          <>
            <IconButton
              size="small"
              onClick={() => setExpanded(!expanded)}
              sx={{
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            >
              <ExpandMoreIcon />
            </IconButton>

            <IconButton size="small" onClick={handleCopyStack} title="Copy error details">
              <ContentCopyIcon fontSize="small" />
            </IconButton>
            {copied && (
              <Typography variant="caption" color="success.main" sx={{ alignSelf: 'center' }}>
                Copied!
              </Typography>
            )}
          </>
        )}
      </Box>

      {shouldShowDetails && (
        <Collapse in={expanded}>
          <Box
            sx={{
              mt: 1,
              p: 2,
              bgcolor: 'grey.100',
              borderRadius: 1,
              maxWidth: 600,
              maxHeight: 300,
              overflow: 'auto',
              textAlign: 'left',
            }}
          >
            <Typography variant="caption" component="pre" sx={{ fontFamily: 'monospace', m: 0 }}>
              {parsedStack.frames.map((frame, i) => (
                <Box
                  key={i}
                  component="span"
                  sx={{
                    display: 'block',
                    color: frame.isAppCode ? 'error.main' : 'text.secondary',
                    fontWeight: frame.isAppCode ? 600 : 400,
                  }}
                >
                  {frame.functionName || '(anonymous)'} at {frame.filePath || 'unknown'}
                  {frame.lineNumber && `:${frame.lineNumber}`}
                </Box>
              ))}
            </Typography>
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

// =============================================================================
// ERROR BOUNDARY
// =============================================================================

/**
 * Error Boundary - Catches JavaScript errors in child components.
 *
 * @example
 * ```tsx
 * <ErrorBoundary
 *   fallback={({ error, resetErrorBoundary }) => (
 *     <div>
 *       <p>Error: {error.message}</p>
 *       <button onClick={resetErrorBoundary}>Retry</button>
 *     </div>
 *   )}
 *   onError={(error, info) => logErrorToService(error, info)}
 * >
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 *
 * @example
 * ```tsx
 * // With reset keys
 * <ErrorBoundary resetKeys={[userId, postId]}>
 *   <UserPost userId={userId} postId={postId} />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const parsedStack = parseStackTrace(error.stack);
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo, parsedStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    const { resetKeys } = this.props;
    const { hasError } = this.state;

    if (hasError && resetKeys && prevProps.resetKeys) {
      // Check if any reset key has changed
      const hasKeyChanged = resetKeys.some((key, index) => key !== prevProps.resetKeys?.[index]);

      if (hasKeyChanged) {
        this.resetErrorBoundary();
      }
    }
  }

  resetErrorBoundary = (): void => {
    this.props.onReset?.();
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, sx, showDetails } = this.props;

    if (hasError && error) {
      const parsedStack = parseStackTrace(error.stack);

      const fallbackProps: FallbackProps = {
        error,
        errorInfo,
        parsedStack,
        resetErrorBoundary: this.resetErrorBoundary,
      };

      if (typeof fallback === 'function') {
        return fallback(fallbackProps);
      }

      if (fallback) {
        return fallback;
      }

      return <DefaultErrorFallback {...fallbackProps} sx={sx} showDetails={showDetails} />;
    }

    return children;
  }
}

// =============================================================================
// HOOK FOR THROWING ERRORS
// =============================================================================

/**
 * Hook to throw errors from event handlers.
 * Useful for triggering error boundary from async code.
 *
 * @returns Function to throw an error
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const throwError = useErrorBoundary();
 *
 *   const handleClick = async () => {
 *     try {
 *       await fetchData();
 *     } catch (error) {
 *       throwError(error as Error);
 *     }
 *   };
 *
 *   return <button onClick={handleClick}>Fetch</button>;
 * }
 * ```
 */
export function useErrorBoundary(): (error: Error) => void {
  const [, setError] = useState<Error | null>(null);

  return (error: Error) => {
    setError(() => {
      throw error;
    });
  };
}
