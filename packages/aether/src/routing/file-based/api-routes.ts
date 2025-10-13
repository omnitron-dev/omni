/**
 * API Routes Handler
 *
 * Handles API route requests with HTTP method routing
 */

import type { RouteDefinition } from '../../router/types.js';

/**
 * HTTP methods supported
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

/**
 * API route handler function
 */
export type ApiHandler = (context: ApiContext) => Response | Promise<Response>;

/**
 * API route handlers by method
 */
export interface ApiHandlers {
  GET?: ApiHandler;
  POST?: ApiHandler;
  PUT?: ApiHandler;
  PATCH?: ApiHandler;
  DELETE?: ApiHandler;
  OPTIONS?: ApiHandler;
  HEAD?: ApiHandler;
}

/**
 * API route context
 */
export interface ApiContext {
  /** Request object */
  request: Request;
  /** URL parameters */
  params: Record<string, string | string[]>;
  /** Query parameters */
  query: Record<string, string>;
  /** Request URL */
  url: URL;
  /** Cookies (if available) */
  cookies?: Record<string, string>;
  /** Headers */
  headers: Headers;
}

/**
 * API route module export
 */
export interface ApiRouteModule {
  GET?: ApiHandler;
  POST?: ApiHandler;
  PUT?: ApiHandler;
  PATCH?: ApiHandler;
  DELETE?: ApiHandler;
  OPTIONS?: ApiHandler;
  HEAD?: ApiHandler;
  default?: ApiHandlers;
}

/**
 * Create API route handler
 */
export function createApiHandler(handlers: ApiHandlers): ApiHandler {
  return async (context: ApiContext) => {
    const method = context.request.method.toUpperCase() as HttpMethod;

    // Find handler for method
    const handler = handlers[method];

    if (!handler) {
      // Method not allowed
      return new Response(
        JSON.stringify({
          error: 'Method Not Allowed',
          message: `Method ${method} is not supported for this route`,
          allowedMethods: Object.keys(handlers),
        }),
        {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            Allow: Object.keys(handlers).join(', '),
          },
        }
      );
    }

    try {
      return await handler(context);
    } catch (err) {
      console.error('API route error:', err);

      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }
  };
}

/**
 * Execute API route
 */
export async function executeApiRoute(
  route: RouteDefinition,
  request: Request,
  params: Record<string, string | string[]>
): Promise<Response> {
  // Load the route module
  if (!route.lazy) {
    return new Response(
      JSON.stringify({
        error: 'Not Found',
        message: 'API route not found',
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const module = (await route.lazy()) as ApiRouteModule;
    const handlers: ApiHandlers = module.default || module;

    // Build context
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());

    const context: ApiContext = {
      request,
      params,
      query,
      url,
      headers: request.headers,
      cookies: parseCookies(request.headers.get('cookie')),
    };

    // Create and execute handler
    const handler = createApiHandler(handlers);
    return await handler(context);
  } catch (err) {
    console.error('Failed to execute API route:', err);

    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        message: err instanceof Error ? err.message : 'Failed to load API route',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Parse cookies from header
 */
function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};

  const cookies: Record<string, string> = {};

  for (const cookie of cookieHeader.split(';')) {
    const [name, ...valueParts] = cookie.trim().split('=');
    if (name) {
      cookies[name] = valueParts.join('=');
    }
  }

  return cookies;
}

/**
 * Helper to create JSON response
 */
export function json(data: any, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
}

/**
 * Helper to create error response
 */
export function error(message: string, status = 500, init?: ResponseInit): Response {
  return json(
    {
      error: getErrorName(status),
      message,
    },
    {
      ...init,
      status,
    }
  );
}

/**
 * Get error name from status code
 */
function getErrorName(status: number): string {
  switch (status) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 405:
      return 'Method Not Allowed';
    case 409:
      return 'Conflict';
    case 422:
      return 'Unprocessable Entity';
    case 429:
      return 'Too Many Requests';
    case 500:
      return 'Internal Server Error';
    case 501:
      return 'Not Implemented';
    case 502:
      return 'Bad Gateway';
    case 503:
      return 'Service Unavailable';
    default:
      return 'Error';
  }
}

/**
 * Helper to create redirect response
 */
export function redirect(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: {
      Location: location,
    },
  });
}

/**
 * Helper to handle CORS
 */
export function cors(
  response: Response,
  options: {
    origin?: string | string[];
    methods?: string[];
    headers?: string[];
    credentials?: boolean;
    maxAge?: number;
  } = {}
): Response {
  const {
    origin = '*',
    methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    headers = ['Content-Type', 'Authorization'],
    credentials = false,
    maxAge = 86400,
  } = options;

  const newHeaders = new Headers(response.headers);

  // Set origin
  if (Array.isArray(origin)) {
    newHeaders.set('Access-Control-Allow-Origin', origin[0] ?? '*');
    newHeaders.set('Vary', 'Origin');
  } else {
    newHeaders.set('Access-Control-Allow-Origin', origin);
  }

  // Set methods
  newHeaders.set('Access-Control-Allow-Methods', methods.join(', '));

  // Set headers
  newHeaders.set('Access-Control-Allow-Headers', headers.join(', '));

  // Set credentials
  if (credentials) {
    newHeaders.set('Access-Control-Allow-Credentials', 'true');
  }

  // Set max age
  newHeaders.set('Access-Control-Max-Age', maxAge.toString());

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * API middleware type
 */
export type ApiMiddleware = (
  context: ApiContext,
  next: () => Promise<Response>
) => Promise<Response>;

/**
 * Compose API middlewares
 */
export function composeMiddleware(...middlewares: ApiMiddleware[]): ApiMiddleware {
  return async (context: ApiContext, handler: () => Promise<Response>) => {
    let index = -1;

    const dispatch = async (i: number): Promise<Response> => {
      if (i <= index) {
        throw new Error('next() called multiple times');
      }

      index = i;

      if (i === middlewares.length) {
        return handler();
      }

      const middleware = middlewares[i];
      if (!middleware) {
        throw new Error('Middleware not found');
      }

      return middleware(context, () => dispatch(i + 1));
    };

    return dispatch(0);
  };
}

/**
 * Example middleware: Logging
 */
export function loggingMiddleware(): ApiMiddleware {
  return async (context, next) => {
    const start = Date.now();
    console.log(`→ ${context.request.method} ${context.url.pathname}`);

    const response = await next();

    const duration = Date.now() - start;
    console.log(`← ${response.status} (${duration}ms)`);

    return response;
  };
}

/**
 * Example middleware: Authentication
 */
export function authMiddleware(verify: (token: string) => Promise<boolean>): ApiMiddleware {
  return async (context, next) => {
    const authHeader = context.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error('Missing or invalid authorization header', 401);
    }

    const token = authHeader.slice(7);

    const isValid = await verify(token);
    if (!isValid) {
      return error('Invalid token', 401);
    }

    return next();
  };
}

/**
 * Example middleware: Rate limiting
 */
export function rateLimitMiddleware(options: {
  max: number;
  window: number;
}): ApiMiddleware {
  const requests = new Map<string, { count: number; resetAt: number }>();

  return async (context, next) => {
    const ip = context.headers.get('x-forwarded-for') || 'unknown';
    const now = Date.now();

    let record = requests.get(ip);

    // Reset if window expired
    if (!record || record.resetAt < now) {
      record = {
        count: 0,
        resetAt: now + options.window,
      };
      requests.set(ip, record);
    }

    // Check limit
    if (record.count >= options.max) {
      return error('Too many requests', 429, {
        headers: {
          'Retry-After': Math.ceil((record.resetAt - now) / 1000).toString(),
        },
      });
    }

    // Increment and continue
    record.count++;

    return next();
  };
}
