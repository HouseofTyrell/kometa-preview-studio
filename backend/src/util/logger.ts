import pino from 'pino';

/**
 * Structured logger for Kometa Preview Studio
 *
 * Uses pino for fast, structured JSON logging in production
 * and pretty-printed output in development.
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

// Configure transport for pretty printing in development
const transport = isDevelopment
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport,
  base: {
    // Don't include pid and hostname in logs
    pid: undefined,
    hostname: undefined,
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

/**
 * Create a child logger with a specific component name
 * @param component - Name of the component (e.g., 'docker', 'plex', 'api')
 */
export function createLogger(component: string): pino.Logger {
  return logger.child({ component });
}

// Named loggers for different components
export const dockerLogger = createLogger('docker');
export const plexLogger = createLogger('plex');
export const apiLogger = createLogger('api');
export const jobLogger = createLogger('job');
export const serverLogger = createLogger('server');
