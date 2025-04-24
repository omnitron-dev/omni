import { OrbitError } from "../core/errors/error";
import { OrbitConfig } from "../core/config/orbitConfig";
import { Variables } from "../core/templating/variables";

export type OrbitResult<T = any> = {
  success: boolean;
  data?: T;
  error?: OrbitError;
};


export type LoggerLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LoggerLevel, message: string, meta?: Record<string, any>): void;
  trace(message: string, meta?: Record<string, any>): void;
  debug(message: string, meta?: Record<string, any>): void;
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, meta?: Record<string, any>): void;
}

export interface AlertDetails {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  details: Record<string, any>;
}

export interface AlertingService {
  sendAlert(details: AlertDetails): Promise<void>;
}

export interface ErrorHandler {
  handleError(error: OrbitError, meta?: Record<string, any>): void;
}

export interface OrbitContext {
  variables: Variables;
  config: OrbitConfig;
  logger: Logger;
  errorHandler: ErrorHandler;             // ✅ новое поле
  alertingService?: AlertingService;      // ✅ новое опциональное поле
}
