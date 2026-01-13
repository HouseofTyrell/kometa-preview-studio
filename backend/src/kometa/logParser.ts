/**
 * Parse and format Kometa/renderer logs
 */

export interface ParsedLogEntry {
  timestamp: Date | null;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG' | 'UNKNOWN';
  message: string;
  raw: string;
}

export interface LogSummary {
  totalLines: number;
  infoCount: number;
  warningCount: number;
  errorCount: number;
  lastError: string | null;
  progress: number;
}

/**
 * Parse a single log line
 */
export function parseLogLine(line: string): ParsedLogEntry {
  const raw = line.trim();

  if (!raw) {
    return { timestamp: null, level: 'UNKNOWN', message: '', raw };
  }

  // Try to parse standard Python logging format: "2024-01-01 12:00:00 - LEVEL - message"
  const pythonLogMatch = raw.match(
    /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:,\d+)?)\s*-\s*(INFO|WARNING|ERROR|DEBUG)\s*-\s*(.*)$/i
  );

  if (pythonLogMatch) {
    const [, timestampStr, level, message] = pythonLogMatch;
    return {
      timestamp: new Date(timestampStr.replace(',', '.')),
      level: level.toUpperCase() as ParsedLogEntry['level'],
      message,
      raw,
    };
  }

  // Try ISO timestamp format
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+(.*)$/);
  if (isoMatch) {
    const [, timestampStr, rest] = isoMatch;
    const levelMatch = rest.match(/^(INFO|WARNING|ERROR|DEBUG)[:\s]+(.*)$/i);
    if (levelMatch) {
      return {
        timestamp: new Date(timestampStr),
        level: levelMatch[1].toUpperCase() as ParsedLogEntry['level'],
        message: levelMatch[2],
        raw,
      };
    }
    return {
      timestamp: new Date(timestampStr),
      level: 'INFO',
      message: rest,
      raw,
    };
  }

  // Try to detect level from message content
  if (/error|failed|exception/i.test(raw)) {
    return { timestamp: null, level: 'ERROR', message: raw, raw };
  }
  if (/warning|warn/i.test(raw)) {
    return { timestamp: null, level: 'WARNING', message: raw, raw };
  }

  return { timestamp: null, level: 'INFO', message: raw, raw };
}

/**
 * Parse multiple log lines
 */
export function parseLogLines(content: string): ParsedLogEntry[] {
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map(parseLogLine);
}

/**
 * Generate log summary
 */
export function summarizeLogs(entries: ParsedLogEntry[]): LogSummary {
  let infoCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  let lastError: string | null = null;

  for (const entry of entries) {
    switch (entry.level) {
      case 'INFO':
      case 'DEBUG':
        infoCount++;
        break;
      case 'WARNING':
        warningCount++;
        break;
      case 'ERROR':
        errorCount++;
        lastError = entry.message;
        break;
    }
  }

  // Estimate progress from log content
  const progress = estimateProgress(entries);

  return {
    totalLines: entries.length,
    infoCount,
    warningCount,
    errorCount,
    lastError,
    progress,
  };
}

/**
 * Estimate progress from log entries
 */
function estimateProgress(entries: ParsedLogEntry[]): number {
  // Look for progress indicators in the logs
  for (let i = entries.length - 1; i >= 0; i--) {
    const message = entries[i].message.toLowerCase();

    if (message.includes('complete') || message.includes('finished') || message.includes('succeeded')) {
      return 100;
    }
    if (message.includes('processing') || message.includes('rendering')) {
      // Count processed items
      const processedMatch = message.match(/(\d+)\s*(?:of|\/)\s*(\d+)/);
      if (processedMatch) {
        const current = parseInt(processedMatch[1], 10);
        const total = parseInt(processedMatch[2], 10);
        if (total > 0) {
          return Math.round((current / total) * 100);
        }
      }
      return 50;
    }
    if (message.includes('starting') || message.includes('initializing')) {
      return 10;
    }
  }

  return 0;
}

/**
 * Format log entry for display
 */
export function formatLogEntry(entry: ParsedLogEntry): string {
  const timestamp = entry.timestamp
    ? entry.timestamp.toISOString().replace('T', ' ').split('.')[0]
    : '          ';

  const levelColors: Record<string, string> = {
    INFO: '\x1b[36m',    // Cyan
    WARNING: '\x1b[33m', // Yellow
    ERROR: '\x1b[31m',   // Red
    DEBUG: '\x1b[90m',   // Gray
    UNKNOWN: '\x1b[0m',  // Reset
  };

  const reset = '\x1b[0m';
  const color = levelColors[entry.level] || reset;

  return `${timestamp} ${color}[${entry.level.padEnd(7)}]${reset} ${entry.message}`;
}

/**
 * Filter log entries by level
 */
export function filterByLevel(
  entries: ParsedLogEntry[],
  minLevel: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
): ParsedLogEntry[] {
  const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
  const minIndex = levels.indexOf(minLevel);

  return entries.filter((entry) => {
    const entryIndex = levels.indexOf(entry.level);
    return entryIndex >= minIndex || entry.level === 'UNKNOWN';
  });
}

/**
 * Extract errors from log entries
 */
export function extractErrors(entries: ParsedLogEntry[]): string[] {
  return entries.filter((e) => e.level === 'ERROR').map((e) => e.message);
}

/**
 * Extract warnings from log entries
 */
export function extractWarnings(entries: ParsedLogEntry[]): string[] {
  return entries.filter((e) => e.level === 'WARNING').map((e) => e.message);
}
