/**
 * Retry utility with exponential backoff
 *
 * Provides configurable retry logic for network operations that may
 * temporarily fail due to network issues, rate limiting, or server errors.
 */

import { apiLogger } from './logger.js';

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds between retries (default: 10000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Function to determine if error is retryable (default: retries all errors) */
  isRetryable?: (error: Error) => boolean;
  /** Optional context for logging */
  context?: string;
}

const DEFAULT_CONFIG: Required<Omit<RetryConfig, 'context'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  isRetryable: () => true,
};

/**
 * Check if an HTTP error is retryable based on status code
 * - 429: Rate limited (definitely retry)
 * - 5xx: Server errors (retry)
 * - Network errors: Retry
 */
export function isRetryableHttpError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Rate limiting - always retry
  if (message.includes('429') || message.includes('rate limit')) {
    return true;
  }

  // Server errors (5xx) - retry
  if (/\b5\d{2}\b/.test(message)) {
    return true;
  }

  // Network errors - retry
  const networkErrors = [
    'econnrefused',
    'econnreset',
    'etimedout',
    'enotfound',
    'socket hang up',
    'network',
    'timeout',
  ];
  if (networkErrors.some(err => message.includes(err))) {
    return true;
  }

  // Client errors (4xx except 429) - don't retry
  if (/\b4\d{2}\b/.test(message) && !message.includes('429')) {
    return false;
  }

  // Default: retry unknown errors
  return true;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry logic and exponential backoff
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration
 * @returns The result of the function
 * @throws The last error if all retries fail
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchDataFromApi(),
 *   {
 *     maxRetries: 3,
 *     initialDelayMs: 1000,
 *     context: 'fetchUserData',
 *     isRetryable: isRetryableHttpError,
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const {
    maxRetries,
    initialDelayMs,
    maxDelayMs,
    backoffMultiplier,
    isRetryable,
  } = { ...DEFAULT_CONFIG, ...config };

  const context = config.context || 'operation';
  let lastError: Error | null = null;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt >= maxRetries || !isRetryable(lastError)) {
        apiLogger.error(
          { err: lastError, attempt, maxRetries, context },
          `${context} failed after ${attempt + 1} attempt(s)`
        );
        throw lastError;
      }

      // Calculate jittered delay (adds 0-25% random variation)
      const jitter = delay * (0.75 + Math.random() * 0.25);
      const actualDelay = Math.min(jitter, maxDelayMs);

      apiLogger.warn(
        { err: lastError.message, attempt: attempt + 1, maxRetries, delayMs: Math.round(actualDelay), context },
        `${context} failed, retrying in ${Math.round(actualDelay)}ms`
      );

      await sleep(actualDelay);

      // Exponential backoff for next attempt
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError || new Error('Retry failed');
}

/**
 * Create a wrapped function that automatically retries on failure
 *
 * @param fn - The async function to wrap
 * @param config - Default retry configuration for all calls
 * @returns A wrapped function with built-in retry logic
 *
 * @example
 * ```typescript
 * const fetchWithRetry = createRetryWrapper(
 *   (url: string) => fetch(url).then(r => r.json()),
 *   { maxRetries: 3, context: 'apiFetch' }
 * );
 *
 * const data = await fetchWithRetry('https://api.example.com/data');
 * ```
 */
export function createRetryWrapper<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  defaultConfig: RetryConfig = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), defaultConfig);
}
