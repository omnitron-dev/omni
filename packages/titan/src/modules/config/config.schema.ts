/**
 * Configuration Schemas
 *
 * Common configuration schemas for validation
 */

import { z } from 'zod';

/**
 * Application configuration schema
 */
export const AppConfigSchema = z.object({
  name: z.string().default('titan-app'),
  version: z.string().default('0.0.0'),
  environment: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  port: z.number().int().positive().max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
  baseUrl: z.string().url().optional(),
  shutdownTimeout: z.number().int().positive().default(30000),
  timezone: z.string().default('UTC'),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Logger configuration schema
 */
export const LoggerConfigSchema = z.object({
  level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  pretty: z.boolean().default(true),
  timestamp: z.boolean().default(true),
  redact: z.array(z.string()).default(['password', 'token', 'secret', 'apiKey', 'authorization']),
  destination: z.string().optional(),
  sync: z.boolean().default(false),
  name: z.string().optional(),
  serializers: z.record(z.string(), z.any()).optional(),
  hooks: z.object({
    logMethod: z.function().optional(),
  }).optional(),
});

export type LoggerConfig = z.infer<typeof LoggerConfigSchema>;

/**
 * Database configuration schema
 */
export const DatabaseConfigSchema = z.object({
  type: z.enum(['postgres', 'mysql', 'mariadb', 'sqlite', 'mssql', 'oracle', 'mongodb']).default('postgres'),
  host: z.string().default('localhost'),
  port: z.number().int().positive().max(65535).default(5432),
  username: z.string().default('postgres'),
  password: z.string().default(''),
  database: z.string().default('app'),
  schema: z.string().optional(),
  ssl: z.union([
    z.boolean(),
    z.object({
      rejectUnauthorized: z.boolean().optional(),
      ca: z.string().optional(),
      cert: z.string().optional(),
      key: z.string().optional(),
    })
  ]).default(false),
  poolSize: z.number().int().positive().default(10),
  connectionTimeout: z.number().int().positive().default(60000),
  idleTimeout: z.number().int().positive().default(10000),
  logging: z.boolean().default(false),
  synchronize: z.boolean().default(false),
  migrations: z.array(z.string()).optional(),
  entities: z.array(z.string()).optional(),
  url: z.string().optional(), // Connection string
});

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

/**
 * Redis configuration schema
 */
export const RedisConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().int().positive().max(65535).default(6379),
  password: z.string().optional(),
  username: z.string().optional(),
  db: z.number().int().min(0).max(15).default(0),
  keyPrefix: z.string().optional(),
  family: z.enum(['4', '6']).transform(Number).default(4),
  connectionName: z.string().optional(),
  sentinels: z.array(z.object({
    host: z.string(),
    port: z.number(),
  })).optional(),
  name: z.string().optional(), // Sentinel master name
  role: z.enum(['master', 'slave']).optional(),
  enableReadyCheck: z.boolean().default(true),
  enableOfflineQueue: z.boolean().default(true),
  connectTimeout: z.number().int().positive().default(10000),
  maxRetriesPerRequest: z.number().int().default(20),
  retryStrategy: z.function().optional(),
  reconnectOnError: z.function().optional(),
  lazyConnect: z.boolean().default(false),
  keepAlive: z.number().optional(),
  noDelay: z.boolean().default(true),
  tls: z.object({
    cert: z.string().optional(),
    key: z.string().optional(),
    ca: z.string().optional(),
  }).optional(),
});

export type RedisConfig = z.infer<typeof RedisConfigSchema>;

/**
 * HTTP/API configuration schema
 */
export const HttpConfigSchema = z.object({
  timeout: z.number().int().positive().default(30000),
  maxBodySize: z.string().default('10mb'),
  trustProxy: z.boolean().default(false),
  compression: z.boolean().default(true),
  cors: z.object({
    enabled: z.boolean().default(true),
    origin: z.union([
      z.string(),
      z.array(z.string()),
      z.boolean(),
      z.function(),
    ]).default('*'),
    credentials: z.boolean().default(true),
    methods: z.array(z.string()).default(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']),
    allowedHeaders: z.array(z.string()).optional(),
    exposedHeaders: z.array(z.string()).optional(),
    maxAge: z.number().optional(),
    preflightContinue: z.boolean().default(false),
    optionsSuccessStatus: z.number().default(204),
  }).optional(),
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    windowMs: z.number().int().positive().default(60000),
    max: z.number().int().positive().default(100),
    message: z.string().default('Too many requests'),
    statusCode: z.number().default(429),
    skipSuccessfulRequests: z.boolean().default(false),
    skipFailedRequests: z.boolean().default(false),
    keyGenerator: z.function().optional(),
    skip: z.function().optional(),
  }).optional(),
  helmet: z.object({
    enabled: z.boolean().default(true),
    contentSecurityPolicy: z.union([z.boolean(), z.object({})]).default(false),
    crossOriginEmbedderPolicy: z.boolean().default(false),
  }).optional(),
});

export type HttpConfig = z.infer<typeof HttpConfigSchema>;

/**
 * Monitoring configuration schema
 */
export const MonitoringConfigSchema = z.object({
  enabled: z.boolean().default(true),
  metrics: z.object({
    enabled: z.boolean().default(true),
    port: z.number().int().positive().max(65535).default(9090),
    path: z.string().default('/metrics'),
    defaultLabels: z.record(z.string(), z.string()).optional(),
    buckets: z.array(z.number()).optional(),
  }).optional(),
  tracing: z.object({
    enabled: z.boolean().default(false),
    serviceName: z.string().optional(),
    endpoint: z.string().url().optional(),
    samplingRate: z.number().min(0).max(1).default(1),
    propagators: z.array(z.string()).optional(),
  }).optional(),
  healthCheck: z.object({
    enabled: z.boolean().default(true),
    path: z.string().default('/health'),
    timeout: z.number().int().positive().default(5000),
    interval: z.number().int().positive().default(30000),
  }).optional(),
});

export type MonitoringConfig = z.infer<typeof MonitoringConfigSchema>;

/**
 * Security configuration schema
 */
export const SecurityConfigSchema = z.object({
  jwt: z.object({
    secret: z.string(),
    expiresIn: z.string().default('1h'),
    refreshExpiresIn: z.string().default('7d'),
    algorithm: z.string().default('HS256'),
    issuer: z.string().optional(),
    audience: z.string().optional(),
  }).optional(),
  encryption: z.object({
    key: z.string(),
    algorithm: z.string().default('aes-256-gcm'),
    ivLength: z.number().default(16),
  }).optional(),
  bcrypt: z.object({
    rounds: z.number().int().min(4).max(31).default(10),
  }).optional(),
  session: z.object({
    secret: z.string(),
    name: z.string().default('sessionId'),
    resave: z.boolean().default(false),
    saveUninitialized: z.boolean().default(false),
    cookie: z.object({
      secure: z.boolean().default(false),
      httpOnly: z.boolean().default(true),
      maxAge: z.number().optional(),
      sameSite: z.enum(['strict', 'lax', 'none']).optional(),
    }).optional(),
  }).optional(),
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

/**
 * Queue/Job configuration schema
 */
export const QueueConfigSchema = z.object({
  redis: RedisConfigSchema.optional(),
  defaultJobOptions: z.object({
    removeOnComplete: z.boolean().default(false),
    removeOnFail: z.boolean().default(false),
    attempts: z.number().int().positive().default(3),
    backoff: z.object({
      type: z.enum(['fixed', 'exponential']).default('exponential'),
      delay: z.number().int().positive().default(5000),
    }).optional(),
  }).optional(),
  workers: z.number().int().positive().default(1),
  concurrency: z.number().int().positive().default(1),
});

export type QueueConfig = z.infer<typeof QueueConfigSchema>;

/**
 * Email configuration schema
 */
export const EmailConfigSchema = z.object({
  transport: z.enum(['smtp', 'sendgrid', 'mailgun', 'aws-ses']).default('smtp'),
  from: z.string().email(),
  smtp: z.object({
    host: z.string(),
    port: z.number().int().positive().max(65535),
    secure: z.boolean().default(false),
    auth: z.object({
      user: z.string(),
      pass: z.string(),
    }).optional(),
    tls: z.object({
      rejectUnauthorized: z.boolean().default(false),
    }).optional(),
  }).optional(),
  sendgrid: z.object({
    apiKey: z.string(),
  }).optional(),
  mailgun: z.object({
    apiKey: z.string(),
    domain: z.string(),
    host: z.string().optional(),
  }).optional(),
  awsSes: z.object({
    region: z.string(),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
  }).optional(),
});

export type EmailConfig = z.infer<typeof EmailConfigSchema>;

/**
 * Storage configuration schema
 */
export const StorageConfigSchema = z.object({
  provider: z.enum(['local', 's3', 'gcs', 'azure']).default('local'),
  local: z.object({
    basePath: z.string().default('./storage'),
    publicPath: z.string().default('/public'),
  }).optional(),
  s3: z.object({
    bucket: z.string(),
    region: z.string(),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    endpoint: z.string().optional(),
    forcePathStyle: z.boolean().default(false),
  }).optional(),
  gcs: z.object({
    bucket: z.string(),
    projectId: z.string(),
    keyFilename: z.string().optional(),
    credentials: z.object({}).optional(),
  }).optional(),
  azure: z.object({
    container: z.string(),
    accountName: z.string(),
    accountKey: z.string(),
    connectionString: z.string().optional(),
  }).optional(),
});

export type StorageConfig = z.infer<typeof StorageConfigSchema>;

/**
 * Complete application configuration schema
 */
export const TitanConfigSchema = z.object({
  app: AppConfigSchema.optional(),
  logger: LoggerConfigSchema.optional(),
  database: DatabaseConfigSchema.optional(),
  redis: RedisConfigSchema.optional(),
  http: HttpConfigSchema.optional(),
  monitoring: MonitoringConfigSchema.optional(),
  security: SecurityConfigSchema.optional(),
  queue: QueueConfigSchema.optional(),
  email: EmailConfigSchema.optional(),
  storage: StorageConfigSchema.optional(),
  custom: z.record(z.string(), z.any()).optional(),
});

export type TitanConfig = z.infer<typeof TitanConfigSchema>;

/**
 * Helper function to create partial schema
 */
export function createPartialSchema<T extends z.ZodObject<any>>(schema: T) {
  return schema.partial();
}

/**
 * Helper function to create strict schema
 */
export function createStrictSchema<T extends z.ZodObject<any>>(schema: T) {
  return schema.strict();
}

/**
 * Helper function to merge schemas
 */
export function mergeSchemas<T extends z.ZodObject<any>, U extends z.ZodObject<any>>(
  schema1: T,
  schema2: U
) {
  return schema1.merge(schema2);
}

/**
 * Helper function to extend schema
 */
export function extendSchema<T extends z.ZodObject<any>>(
  baseSchema: T,
  extensions: z.ZodRawShape
) {
  return baseSchema.extend(extensions);
}