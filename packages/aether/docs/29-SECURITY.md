# 29. Security

## Table of Contents
- [Overview](#overview)
- [HTTPS and TLS](#https-and-tls)
- [Content Security Policy](#content-security-policy)
- [CORS](#cors)
- [Authentication](#authentication)
- [Authorization](#authorization)
- [Session Management](#session-management)
- [CSRF Protection](#csrf-protection)
- [XSS Prevention](#xss-prevention)
- [Input Validation](#input-validation)
- [Security Headers](#security-headers)
- [Rate Limiting](#rate-limiting)
- [Secrets Management](#secrets-management)
- [Data Protection](#data-protection)
- [API Security](#api-security)
- [Dependency Security](#dependency-security)
- [Security Testing](#security-testing)
- [Compliance](#compliance)
- [Titan Integration](#titan-integration)
- [Best Practices](#best-practices)

## Overview

Security is paramount in web applications. Aether provides built-in security features and follows security best practices.

### Security Principles

```typescript
/**
 * Core Security Principles:
 *
 * 1. Defense in Depth
 *    - Multiple layers of security
 *    - No single point of failure
 *
 * 2. Principle of Least Privilege
 *    - Minimum necessary permissions
 *    - Restrict access by default
 *
 * 3. Fail Securely
 *    - Errors should not expose sensitive information
 *    - Default to secure state on failure
 *
 * 4. Never Trust User Input
 *    - Validate all input
 *    - Sanitize before use
 *    - Escape output
 *
 * 5. Keep Security Simple
 *    - Complex systems are harder to secure
 *    - Use established patterns and libraries
 *
 * 6. Security by Default
 *    - Secure out of the box
 *    - Opt-in to less secure features
 */
```

### Threat Model

```typescript
/**
 * Common Web Security Threats (OWASP Top 10):
 *
 * 1. Broken Access Control
 * 2. Cryptographic Failures
 * 3. Injection (SQL, XSS, etc.)
 * 4. Insecure Design
 * 5. Security Misconfiguration
 * 6. Vulnerable and Outdated Components
 * 7. Identification and Authentication Failures
 * 8. Software and Data Integrity Failures
 * 9. Security Logging and Monitoring Failures
 * 10. Server-Side Request Forgery (SSRF)
 */
```

## HTTPS and TLS

Always use HTTPS in production.

### Force HTTPS

```typescript
// Server-side redirect to HTTPS
export const forceHTTPS = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    const proto = req.headers['x-forwarded-proto'];
    if (proto !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
  }
  next();
};

app.use(forceHTTPS);
```

### HSTS (HTTP Strict Transport Security)

```typescript
// Set HSTS header
app.use((req, res, next) => {
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );
  next();
});

// Or use helmet
import helmet from 'helmet';

app.use(helmet.hsts({
  maxAge: 31536000,
  includeSubDomains: true,
  preload: true
}));
```

### TLS Configuration

```typescript
// Node.js HTTPS server
import https from 'https';
import fs from 'fs';

const options = {
  key: fs.readFileSync('privkey.pem'),
  cert: fs.readFileSync('fullchain.pem'),

  // TLS 1.2 minimum
  minVersion: 'TLSv1.2',

  // Strong ciphers only
  ciphers: [
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384'
  ].join(':'),

  // Prefer server cipher order
  honorCipherOrder: true
};

https.createServer(options, app).listen(443);
```

## Content Security Policy

Prevent XSS and other injection attacks.

### CSP Configuration

```typescript
// nexus.config.ts
export default defineConfig({
  security: {
    csp: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.example.com'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'https:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'", 'https://api.example.com'],
        'frame-src': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': []
      },
      reportOnly: false, // Set to true during testing
      reportUri: '/api/csp-report'
    }
  }
});
```

### Server-Side CSP

```typescript
import helmet from 'helmet';

app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'nonce-{NONCE}'"],
    styleSrc: ["'self'", "'nonce-{NONCE}'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'", 'https://api.example.com'],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: []
  },
  reportOnly: false
}));

// Generate nonce for inline scripts
app.use((req, res, next) => {
  res.locals.nonce = generateNonce();
  next();
});

// Use nonce in templates
// <script nonce="${nonce}">...</script>
```

### CSP Nonces

```typescript
// Generate cryptographic nonce
import { randomBytes } from 'crypto';

export const generateNonce = (): string => {
  return randomBytes(16).toString('base64');
};

// Add nonce to response
export const cspNonceMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const nonce = generateNonce();
  res.locals.nonce = nonce;

  // Set CSP header with nonce
  res.setHeader(
    'Content-Security-Policy',
    `script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'`
  );

  next();
};

// Usage in HTML
// <script nonce="<%= nonce %>">
//   console.log('Safe inline script');
// </script>
```

## CORS

Control cross-origin resource sharing.

### CORS Configuration

```typescript
// nexus.config.ts
export default defineConfig({
  security: {
    cors: {
      origin: ['https://example.com', 'https://app.example.com'],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['X-Total-Count'],
      credentials: true,
      maxAge: 86400 // 24 hours
    }
  }
});
```

### Server-Side CORS

```typescript
import cors from 'cors';

// Simple CORS
app.use(cors({
  origin: 'https://example.com',
  credentials: true
}));

// Dynamic CORS
const corsOptions = {
  origin: (origin: string | undefined, callback: Function) => {
    const allowedOrigins = [
      'https://example.com',
      'https://app.example.com'
    ];

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Preflight requests
app.options('*', cors(corsOptions));
```

## Authentication

Secure user authentication.

### JWT Authentication

```typescript
// auth.service.ts
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = '7d';

export class AuthService {
  // Hash password
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  // Verify password
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // Generate JWT
  generateToken(userId: string): string {
    return jwt.sign(
      { userId },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
  }

  // Verify JWT
  verifyToken(token: string): { userId: string } {
    try {
      return jwt.verify(token, JWT_SECRET) as { userId: string };
    } catch {
      throw new Error('Invalid token');
    }
  }

  // Refresh token
  async refreshToken(oldToken: string): Promise<string> {
    const payload = this.verifyToken(oldToken);
    return this.generateToken(payload.userId);
  }
}

// Auth middleware
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const payload = authService.verifyToken(token);
    req.userId = payload.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
```

### OAuth 2.0

```typescript
// OAuth with Google
import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://example.com/auth/google/callback'
);

// Redirect to Google
export const googleLogin = (req: Request, res: Response) => {
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['profile', 'email']
  });
  res.redirect(url);
};

// Handle callback
export const googleCallback = async (req: Request, res: Response) => {
  const { code } = req.query;

  try {
    const { tokens } = await client.getToken(code as string);
    client.setCredentials(tokens);

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { sub, email, name } = payload!;

    // Find or create user
    let user = await db.user.findUnique({ where: { googleId: sub } });
    if (!user) {
      user = await db.user.create({
        data: { googleId: sub, email, name }
      });
    }

    // Generate JWT
    const token = authService.generateToken(user.id);

    res.redirect(`/auth/success?token=${token}`);
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};
```

### Multi-Factor Authentication

```typescript
// TOTP (Time-based One-Time Password)
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

export class MFAService {
  // Generate secret
  async generateSecret(userId: string): Promise<{ secret: string; qrCode: string }> {
    const secret = speakeasy.generateSecret({
      name: `Aether App (${userId})`,
      issuer: '(Aether)'
    });

    const qrCode = await QRCode.toDataURL(secret.otpauth_url!);

    return {
      secret: secret.base32,
      qrCode
    };
  }

  // Verify TOTP
  verifyToken(token: string, secret: string): boolean {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 2 // Allow 2 time steps before/after
    });
  }

  // Enable MFA
  async enableMFA(userId: string, token: string): Promise<void> {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret) {
      throw new Error('MFA not initialized');
    }

    if (!this.verifyToken(token, user.mfaSecret)) {
      throw new Error('Invalid token');
    }

    await db.user.update({
      where: { id: userId },
      data: { mfaEnabled: true }
    });
  }
}

// MFA middleware
export const mfaMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const user = await db.user.findUnique({ where: { id: req.userId } });

  if (user?.mfaEnabled) {
    const token = req.headers['x-mfa-token'];
    if (!token || !mfaService.verifyToken(token as string, user.mfaSecret!)) {
      return res.status(401).json({ error: 'MFA token required' });
    }
  }

  next();
};
```

## Authorization

Control access to resources.

### Role-Based Access Control (RBAC)

```typescript
// Define roles and permissions
enum Role {
  ADMIN = 'admin',
  USER = 'user',
  GUEST = 'guest'
}

enum Permission {
  READ_USER = 'read:user',
  WRITE_USER = 'write:user',
  DELETE_USER = 'delete:user',
  READ_POST = 'read:post',
  WRITE_POST = 'write:post'
}

const rolePermissions: Record<Role, Permission[]> = {
  [Role.ADMIN]: [
    Permission.READ_USER,
    Permission.WRITE_USER,
    Permission.DELETE_USER,
    Permission.READ_POST,
    Permission.WRITE_POST
  ],
  [Role.USER]: [
    Permission.READ_USER,
    Permission.READ_POST,
    Permission.WRITE_POST
  ],
  [Role.GUEST]: [
    Permission.READ_POST
  ]
};

// Check permission
export const hasPermission = (role: Role, permission: Permission): boolean => {
  return rolePermissions[role].includes(permission);
};

// Authorization middleware
export const requirePermission = (permission: Permission) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await db.user.findUnique({ where: { id: req.userId } });

    if (!user || !hasPermission(user.role, permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
};

// Usage
app.get('/api/users', authMiddleware, requirePermission(Permission.READ_USER), getUsers);
app.delete('/api/users/:id', authMiddleware, requirePermission(Permission.DELETE_USER), deleteUser);
```

### Attribute-Based Access Control (ABAC)

```typescript
// Policy-based authorization
interface AuthContext {
  user: User;
  resource: any;
  action: string;
  environment: {
    time: Date;
    ip: string;
  };
}

type Policy = (context: AuthContext) => boolean;

const policies: Record<string, Policy> = {
  // User can edit their own posts
  editOwnPost: ({ user, resource }) => {
    return resource.authorId === user.id;
  },

  // Admin can edit any post
  editAnyPost: ({ user }) => {
    return user.role === Role.ADMIN;
  },

  // Can only delete during business hours
  deletePostBusinessHours: ({ environment }) => {
    const hour = environment.time.getHours();
    return hour >= 9 && hour < 17;
  }
};

// Evaluate policy
export const evaluatePolicy = (policyName: string, context: AuthContext): boolean => {
  const policy = policies[policyName];
  if (!policy) return false;
  return policy(context);
};

// Middleware
export const requirePolicy = (policyName: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await db.user.findUnique({ where: { id: req.userId } });
    const resource = await getResource(req.params.id);

    const allowed = evaluatePolicy(policyName, {
      user,
      resource,
      action: req.method,
      environment: {
        time: new Date(),
        ip: req.ip
      }
    });

    if (!allowed) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
};
```

## Session Management

Secure session handling.

### Session Configuration

```typescript
import session from 'express-session';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';

// Redis client
const redisClient = createClient({
  url: process.env.REDIS_URL
});
await redisClient.connect();

// Session middleware
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET!,
  name: 'sessionId', // Don't use default name
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true, // HTTPS only
    httpOnly: true, // Not accessible via JavaScript
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict' // CSRF protection
  }
}));
```

### Session Security

```typescript
// Regenerate session ID on login
export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !await authService.verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Regenerate session to prevent session fixation
  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ error: 'Session error' });
    }

    req.session.userId = user.id;
    res.json({ success: true });
  });
};

// Destroy session on logout
export const logout = (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('sessionId');
    res.json({ success: true });
  });
};

// Session timeout
export const sessionTimeout = (req: Request, res: Response, next: NextFunction) => {
  if (req.session.lastActivity) {
    const inactiveTime = Date.now() - req.session.lastActivity;
    const timeout = 30 * 60 * 1000; // 30 minutes

    if (inactiveTime > timeout) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Session expired' });
    }
  }

  req.session.lastActivity = Date.now();
  next();
};
```

## CSRF Protection

Prevent Cross-Site Request Forgery attacks.

### CSRF Tokens

```typescript
import csrf from 'csurf';

// CSRF middleware
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict'
  }
});

app.use(csrfProtection);

// Include token in forms
app.get('/form', (req, res) => {
  res.render('form', { csrfToken: req.csrfToken() });
});

// Verify token on POST
app.post('/submit', csrfProtection, (req, res) => {
  // Process form
  res.json({ success: true });
});
```

### Double Submit Cookie

```typescript
// Generate CSRF token
export const generateCSRFToken = (): string => {
  return randomBytes(32).toString('hex');
};

// CSRF middleware
export const csrfMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const cookieToken = req.cookies.csrf;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  next();
};

// Set CSRF token cookie
app.use((req, res, next) => {
  if (!req.cookies.csrf) {
    const token = generateCSRFToken();
    res.cookie('csrf', token, {
      httpOnly: false, // Client needs to read this
      secure: true,
      sameSite: 'strict'
    });
  }
  next();
});

app.use(csrfMiddleware);
```

### Frontend CSRF Handling

```typescript
// Get CSRF token from cookie
const getCSRFToken = (): string | null => {
  const match = document.cookie.match(/csrf=([^;]+)/);
  return match ? match[1] : null;
};

// Add to all requests
export const apiFetch = async (url: string, options: RequestInit = {}) => {
  const csrfToken = getCSRFToken();

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'X-CSRF-Token': csrfToken || ''
    }
  });
};

// Usage
await apiFetch('/api/users', {
  method: 'POST',
  body: JSON.stringify({ name: 'Alice' })
});
```

## XSS Prevention

Prevent Cross-Site Scripting attacks.

### Input Sanitization

```typescript
import DOMPurify from 'isomorphic-dompurify';

// Sanitize HTML input
export const sanitizeHTML = (dirty: string): string => {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
    ALLOWED_ATTR: ['href', 'title']
  });
};

// Usage
const userInput = '<script>alert("XSS")</script><p>Safe content</p>';
const clean = sanitizeHTML(userInput); // '<p>Safe content</p>'
```

### Output Encoding

```typescript
// HTML entity encoding
export const escapeHTML = (str: string): string => {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };

  return str.replace(/[&<>"'/]/g, (char) => map[char]);
};

// Usage in component
export default defineComponent(() => {
  const userInput = '<script>alert("XSS")</script>';

  return () => (
    <div>
      {/* ✅ Safe - Aether auto-escapes */}
      <p>{userInput}</p>

      {/* ⚠️  Dangerous - bypasses escaping */}
      <p innerHTML={userInput} />

      {/* ✅ Safe - sanitized HTML */}
      <p innerHTML={sanitizeHTML(userInput)} />
    </div>
  );
});
```

### Dangerous Operations

```typescript
// Avoid innerHTML with user input
// ❌ Dangerous
element.innerHTML = userInput;

// ✅ Safe
element.textContent = userInput;

// Avoid eval and Function constructor
// ❌ Dangerous
eval(userInput);
new Function(userInput)();

// Avoid javascript: URLs
// ❌ Dangerous
<a href={`javascript:${userInput}`}>Click</a>

// ✅ Safe
<a href={sanitizeURL(userInput)}>Click</a>
```

## Input Validation

Validate and sanitize all user input.

### Schema Validation

```typescript
import { z } from 'zod';

// Define validation schema
const userSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  age: z.number().int().min(18).max(120),
  website: z.string().url().optional()
});

// Validate input
export const validateUser = (data: unknown) => {
  return userSchema.parse(data); // Throws on invalid
};

// Safe validation
export const safeValidateUser = (data: unknown) => {
  const result = userSchema.safeParse(data);
  if (result.success) {
    return { data: result.data, errors: null };
  } else {
    return { data: null, errors: result.error.errors };
  }
};

// API endpoint
app.post('/api/users', async (req, res) => {
  const validation = safeValidateUser(req.body);

  if (validation.errors) {
    return res.status(400).json({ errors: validation.errors });
  }

  const user = await db.user.create({ data: validation.data });
  res.json(user);
});
```

### Custom Validators

```typescript
// URL validation
export const isValidURL = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// SQL injection prevention (parameterized queries)
// ❌ Dangerous - String concatenation
const query = `SELECT * FROM users WHERE email = '${email}'`;

// ✅ Safe - Parameterized query
const query = 'SELECT * FROM users WHERE email = ?';
db.query(query, [email]);

// File upload validation
export const validateFile = (file: File): { valid: boolean; error?: string } => {
  // Size limit (10MB)
  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, error: 'File too large' };
  }

  // Type whitelist
  const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Invalid file type' };
  }

  // Filename validation
  const safeFilename = /^[a-zA-Z0-9_\-\.]+$/;
  if (!safeFilename.test(file.name)) {
    return { valid: false, error: 'Invalid filename' };
  }

  return { valid: true };
};
```

## Security Headers

Set security headers to protect against attacks.

### Helmet.js

```typescript
import helmet from 'helmet';

// Use helmet with defaults
app.use(helmet());

// Custom configuration
app.use(helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:']
    }
  },

  // HSTS
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },

  // X-Frame-Options
  frameguard: {
    action: 'deny'
  },

  // X-Content-Type-Options
  noSniff: true,

  // X-XSS-Protection
  xssFilter: true,

  // Referrer-Policy
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  }
}));
```

### Manual Headers

```typescript
// Set security headers manually
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // XSS protection (legacy)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  next();
});
```

## Rate Limiting

Prevent abuse and DDoS attacks.

### Express Rate Limit

```typescript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

// General rate limit
const limiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:'
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', limiter);

// Strict rate limit for auth endpoints
const authLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:auth:'
  }),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 attempts per hour
  skipSuccessfulRequests: true // Don't count successful requests
});

app.post('/api/login', authLimiter, login);
app.post('/api/register', authLimiter, register);

// IP-based rate limiting
const ipLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: async (req) => {
    // Different limits based on user
    if (req.userId && await isPremiumUser(req.userId)) {
      return 1000; // Higher limit for premium users
    }
    return 60; // Default limit
  },
  keyGenerator: (req) => req.ip
});
```

### Slowdown

```typescript
import slowDown from 'express-slow-down';

// Gradually slow down responses
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 50, // Start slowing down after 50 requests
  delayMs: 500, // Add 500ms delay per request
  maxDelayMs: 20000 // Max 20s delay
});

app.use('/api/', speedLimiter);
```

## Secrets Management

Securely manage API keys and secrets.

### Environment Variables

```typescript
// .env (gitignored!)
DATABASE_URL=postgresql://...
JWT_SECRET=super-secret-key
API_KEY=abc123

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Access secrets
const dbUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;

// Validate required secrets
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}
```

### Secret Rotation

```typescript
// Support multiple secrets for rotation
const JWT_SECRETS = [
  process.env.JWT_SECRET_CURRENT!,
  process.env.JWT_SECRET_PREVIOUS! // For gradual rotation
];

// Verify with any valid secret
export const verifyToken = (token: string): any => {
  for (const secret of JWT_SECRETS) {
    try {
      return jwt.verify(token, secret);
    } catch {
      continue;
    }
  }
  throw new Error('Invalid token');
};

// Always sign with current secret
export const signToken = (payload: any): string => {
  return jwt.sign(payload, JWT_SECRETS[0]);
};
```

### Vault Integration

```typescript
// HashiCorp Vault integration
import vault from 'node-vault';

const vaultClient = vault({
  endpoint: process.env.VAULT_ADDR,
  token: process.env.VAULT_TOKEN
});

// Read secrets from Vault
export const getSecret = async (path: string): Promise<string> => {
  const result = await vaultClient.read(path);
  return result.data.value;
};

// Cache secrets
const secretCache = new Map<string, string>();

export const getCachedSecret = async (path: string): Promise<string> => {
  if (secretCache.has(path)) {
    return secretCache.get(path)!;
  }

  const secret = await getSecret(path);
  secretCache.set(path, secret);
  return secret;
};

// Refresh secrets periodically
setInterval(async () => {
  secretCache.clear();
}, 60 * 60 * 1000); // Refresh every hour
```

## Data Protection

Protect sensitive data.

### Encryption

```typescript
import crypto from 'crypto';

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes
const ALGORITHM = 'aes-256-gcm';

// Encrypt data
export const encrypt = (text: string): string => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Return IV + authTag + encrypted data
  return iv.toString('hex') + authTag.toString('hex') + encrypted;
};

// Decrypt data
export const decrypt = (encryptedData: string): string => {
  const iv = Buffer.from(encryptedData.slice(0, 32), 'hex');
  const authTag = Buffer.from(encryptedData.slice(32, 64), 'hex');
  const encrypted = encryptedData.slice(64);

  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};

// Usage
const sensitive = 'Credit card: 1234-5678-9012-3456';
const encrypted = encrypt(sensitive);
const decrypted = decrypt(encrypted);
```

### Data Masking

```typescript
// Mask sensitive data in logs
export const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
};

export const maskCreditCard = (card: string): string => {
  return `****-****-****-${card.slice(-4)}`;
};

export const maskSSN = (ssn: string): string => {
  return `***-**-${ssn.slice(-4)}`;
};

// Logger with automatic masking
export const logger = {
  info: (message: string, data?: any) => {
    const masked = maskSensitiveData(data);
    console.log(message, masked);
  }
};

const maskSensitiveData = (obj: any): any => {
  if (typeof obj !== 'object' || obj === null) return obj;

  const masked = { ...obj };

  if (masked.email) masked.email = maskEmail(masked.email);
  if (masked.creditCard) masked.creditCard = maskCreditCard(masked.creditCard);
  if (masked.ssn) masked.ssn = maskSSN(masked.ssn);

  return masked;
};
```

## API Security

Secure your API endpoints.

### API Authentication

```typescript
// API key authentication
export const apiKeyAuth = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  // Verify API key (use hash comparison)
  const hashedKey = crypto.createHash('sha256').update(apiKey as string).digest('hex');
  const validKey = await db.apiKey.findUnique({ where: { hash: hashedKey } });

  if (!validKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  // Check rate limits for this API key
  const used = await redis.incr(`api:${validKey.id}:${Date.now()}`);
  if (used > validKey.rateLimit) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  req.apiKeyId = validKey.id;
  next();
};
```

### Request Signing

```typescript
// Sign requests with HMAC
export const signRequest = (
  method: string,
  path: string,
  body: string,
  secret: string
): string => {
  const message = `${method}${path}${body}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
};

// Verify signature
export const verifySignature = (req: Request, res: Response, next: NextFunction) => {
  const signature = req.headers['x-signature'];
  const timestamp = req.headers['x-timestamp'];

  if (!signature || !timestamp) {
    return res.status(401).json({ error: 'Missing signature or timestamp' });
  }

  // Prevent replay attacks (5 minute window)
  const age = Date.now() - parseInt(timestamp as string);
  if (age > 5 * 60 * 1000) {
    return res.status(401).json({ error: 'Request expired' });
  }

  // Verify signature
  const expectedSignature = signRequest(
    req.method,
    req.path,
    JSON.stringify(req.body),
    process.env.API_SECRET!
  );

  if (signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
};
```

## Dependency Security

Keep dependencies secure.

### Automated Scanning

```bash
# npm audit
npm audit
npm audit fix

# Yarn audit
yarn audit

# Snyk
npm install -g snyk
snyk test
snyk monitor

# OWASP Dependency Check
dependency-check --project myapp --scan .
```

### Dependabot

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: 'npm'
    directory: '/'
    schedule:
      interval: 'weekly'
    open-pull-requests-limit: 10
    reviewers:
      - 'security-team'
```

### Package Lock

```bash
# Always commit lock files
git add package-lock.json
git add yarn.lock

# Use exact versions for critical packages
{
  "dependencies": {
    "express": "4.18.2" // Exact version, not ^4.18.2
  }
}
```

## Security Testing

Test for security vulnerabilities.

### Automated Security Tests

```typescript
// security.test.ts
import { test, expect } from '@playwright/test';

test.describe('Security', () => {
  test('prevents XSS injection', async ({ page }) => {
    await page.goto('/search');
    await page.fill('input[name="q"]', '<script>alert("XSS")</script>');
    await page.click('button[type="submit"]');

    // Should not execute script
    await expect(page.locator('script')).toHaveCount(0);

    // Should display escaped HTML
    await expect(page.locator('body')).toContainText('<script>');
  });

  test('requires CSRF token', async ({ page }) => {
    // Try POST without CSRF token
    const response = await page.request.post('/api/users', {
      data: { name: 'Alice' }
    });

    expect(response.status()).toBe(403);
  });

  test('rate limits login attempts', async ({ page }) => {
    // Try multiple failed logins
    for (let i = 0; i < 6; i++) {
      await page.goto('/login');
      await page.fill('[name="email"]', 'test@example.com');
      await page.fill('[name="password"]', 'wrong');
      await page.click('button[type="submit"]');
    }

    // Should be rate limited
    await expect(page.locator('.error')).toContainText('Too many attempts');
  });
});
```

### Penetration Testing

```typescript
/**
 * Security Testing Checklist:
 *
 * 1. Authentication
 *    - Test password strength requirements
 *    - Test brute force protection
 *    - Test session management
 *    - Test MFA bypass
 *
 * 2. Authorization
 *    - Test privilege escalation
 *    - Test horizontal access (user A accessing user B's data)
 *    - Test vertical access (user accessing admin functions)
 *
 * 3. Input Validation
 *    - Test SQL injection
 *    - Test XSS
 *    - Test command injection
 *    - Test path traversal
 *
 * 4. Session Management
 *    - Test session fixation
 *    - Test session hijacking
 *    - Test logout functionality
 *    - Test concurrent sessions
 *
 * 5. Business Logic
 *    - Test payment manipulation
 *    - Test race conditions
 *    - Test negative quantities
 *
 * 6. File Upload
 *    - Test malicious file upload
 *    - Test file type validation
 *    - Test file size limits
 *
 * 7. API Security
 *    - Test API authentication
 *    - Test rate limiting
 *    - Test mass assignment
 */
```

## Compliance

Ensure compliance with regulations.

### GDPR Compliance

```typescript
// User data export
export const exportUserData = async (userId: string): Promise<any> => {
  const user = await db.user.findUnique({ where: { id: userId } });
  const posts = await db.post.findMany({ where: { authorId: userId } });
  const comments = await db.comment.findMany({ where: { authorId: userId } });

  return {
    user: {
      email: user.email,
      name: user.name,
      createdAt: user.createdAt
    },
    posts: posts.map(p => ({ title: p.title, content: p.content })),
    comments: comments.map(c => ({ content: c.content }))
  };
};

// Right to be forgotten
export const deleteUserData = async (userId: string): Promise<void> => {
  // Anonymize or delete user data
  await db.post.updateMany({
    where: { authorId: userId },
    data: { authorId: null, authorName: 'Deleted User' }
  });

  await db.comment.updateMany({
    where: { authorId: userId },
    data: { authorId: null, authorName: 'Deleted User' }
  });

  await db.user.delete({ where: { id: userId } });
};

// Cookie consent
export const CookieConsent = defineComponent(() => {
  const accepted = signal(false

  onMount(() => {
    const consent = localStorage.getItem('cookie-consent');
    if (consent) {
      accepted.set(true);
      // Load analytics scripts
    }
  });

  const accept = () => {
    localStorage.setItem('cookie-consent', 'true');
    accepted.set(true);
    // Load analytics scripts
  };

  return () => (
    <Show when={!accepted()}>
      <div class="cookie-banner">
        <p>We use cookies to improve your experience.</p>
        <button onClick={accept}>Accept</button>
      </div>
    </Show>
  );
});
```

## Titan Integration

Security for full-stack applications.

### Unified Security

```typescript
// Shared security configuration
// packages/shared/security.ts

export const securityConfig = {
  jwtSecret: process.env.JWT_SECRET!,
  encryptionKey: process.env.ENCRYPTION_KEY!,
  csrfEnabled: true,
  rateLimiting: {
    windowMs: 15 * 60 * 1000,
    max: 100
  }
};

// Backend (Titan)
import { securityConfig } from '@shared/security';

@Injectable()
export class SecurityModule {
  @Inject() private jwt: JwtService;

  async validateToken(token: string) {
    return this.jwt.verify(token, securityConfig.jwtSecret);
  }
}

// Frontend (Aether)
import { securityConfig } from '@shared/security';

// Use same CSRF configuration
```

## Best Practices

### Security Checklist

```typescript
/**
 * Production Security Checklist:
 *
 * [ ] HTTPS enabled with HSTS
 * [ ] Security headers configured (CSP, X-Frame-Options, etc.)
 * [ ] CORS properly configured
 * [ ] Rate limiting enabled
 * [ ] CSRF protection enabled
 * [ ] XSS prevention (input sanitization, output encoding)
 * [ ] SQL injection prevention (parameterized queries)
 * [ ] Authentication implemented (JWT, OAuth, etc.)
 * [ ] Authorization implemented (RBAC/ABAC)
 * [ ] Session management secure
 * [ ] Secrets managed securely (environment variables, Vault)
 * [ ] Data encrypted at rest and in transit
 * [ ] Input validation on all endpoints
 * [ ] File upload restrictions
 * [ ] Dependency scanning enabled
 * [ ] Security monitoring and logging
 * [ ] Regular security audits
 * [ ] Incident response plan
 */
```

## Summary

Security is multi-layered and requires constant vigilance:

1. **HTTPS**: Always use HTTPS with HSTS
2. **CSP**: Configure Content Security Policy
3. **CORS**: Control cross-origin access
4. **Authentication**: Implement secure auth (JWT, OAuth, MFA)
5. **Authorization**: Control access with RBAC/ABAC
6. **Sessions**: Secure session management
7. **CSRF**: Prevent cross-site request forgery
8. **XSS**: Prevent cross-site scripting
9. **Validation**: Validate all input
10. **Headers**: Set security headers
11. **Rate Limiting**: Prevent abuse
12. **Secrets**: Manage secrets securely
13. **Encryption**: Encrypt sensitive data
14. **Dependencies**: Keep dependencies updated
15. **Testing**: Regular security testing

Follow the principle of defense in depth and assume breach.
