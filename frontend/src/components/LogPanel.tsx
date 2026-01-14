import { useEffect, useRef, useMemo, useState } from 'react'
import { JobEvent } from '../api/client'

interface LogPanelProps {
  logs: JobEvent[]
}

/**
 * Filter out verbose/unhelpful Kometa debug output
 * Returns true if the log should be shown, false if it should be hidden
 */
function shouldShowLog(log: JobEvent): boolean {
  const message = log.message.trim()

  // Always show errors, warnings, and completion events
  if (log.type === 'error' || log.type === 'warning' || log.type === 'complete') {
    return true
  }

  // Filter out empty or near-empty lines
  if (!message || message === '|' || message === '| |') {
    return false
  }

  // Filter out Kometa conditional debug lines that show just variable names
  // These look like "| Conditional: variable_name |" with no value
  if (/^\|\s*Conditional:\s*\w+\s*\|$/.test(message)) {
    return false
  }

  // Filter out lines that are just pipe separators (common in Kometa table output)
  if (/^[\|\s\-=+]+$/.test(message)) {
    return false
  }

  // Filter out verbose overlay processing lines without meaningful content
  if (/^\|\s*\|\s*$/.test(message)) {
    return false
  }

  return true
}

function LogPanel({ logs }: LogPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showVerbose, setShowVerbose] = useState(false)

  // Filter logs based on verbose mode
  const filteredLogs = useMemo(() => {
    if (showVerbose) {
      return logs
    }
    return logs.filter(shouldShowLog)
  }, [logs, showVerbose])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filteredLogs])

  const getLogTypeClass = (type: string): string => {
    switch (type) {
      case 'error':
        return 'log-error'
      case 'warning':
        return 'log-warning'
      case 'complete':
        return 'log-success'
      case 'progress':
        return 'log-progress'
      default:
        return 'log-info'
    }
  }

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp)
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return ''
    }
  }

  const hiddenCount = logs.length - filteredLogs.length

  return (
    <div className="log-panel card">
      <div className="log-header">
        <h2 className="card-title">Logs</h2>
        <div className="log-controls">
          {hiddenCount > 0 && !showVerbose && (
            <span className="log-hidden-count">{hiddenCount} hidden</span>
          )}
          <button
            className={`verbose-toggle ${showVerbose ? 'active' : ''}`}
            onClick={() => setShowVerbose(!showVerbose)}
            title={showVerbose ? 'Hide verbose logs' : 'Show all logs'}
          >
            {showVerbose ? 'Verbose' : 'Filtered'}
          </button>
        </div>
      </div>

      <div className="log-container" ref={scrollRef}>
        {filteredLogs.length === 0 ? (
          <div className="log-empty">
            <span>{logs.length === 0 ? 'No logs yet. Start a preview to see output.' : 'All logs filtered. Click "Verbose" to see all.'}</span>
          </div>
        ) : (
          <div className="log-entries">
            {filteredLogs.map((log, index) => (
              <div key={index} className={`log-entry ${getLogTypeClass(log.type)}`}>
                <span className="log-time">{formatTimestamp(log.timestamp)}</span>
                <span className="log-type">[{log.type.toUpperCase()}]</span>
                <span className="log-message">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .log-panel {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          height: fit-content;
          max-height: 600px;
        }

        .log-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .log-header .card-title {
          margin: 0;
        }

        .log-controls {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .log-hidden-count {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .verbose-toggle {
          font-size: 0.625rem;
          padding: 0.25rem 0.5rem;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.2s;
        }

        .verbose-toggle:hover {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .verbose-toggle.active {
          background-color: var(--accent-primary);
          border-color: var(--accent-primary);
          color: #000;
        }

        .log-container {
          background-color: var(--bg-primary);
          border-radius: var(--radius-sm);
          overflow-y: auto;
          max-height: 500px;
          min-height: 300px;
        }

        .log-empty {
          padding: 2rem;
          text-align: center;
          color: var(--text-muted);
          font-size: 0.875rem;
        }

        .log-entries {
          padding: 0.75rem;
          font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
          font-size: 0.75rem;
          line-height: 1.6;
        }

        .log-entry {
          display: flex;
          gap: 0.5rem;
          padding: 0.125rem 0;
          word-break: break-word;
        }

        .log-time {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .log-type {
          flex-shrink: 0;
          font-weight: 600;
        }

        .log-message {
          color: var(--text-primary);
        }

        .log-info .log-type {
          color: #64b5f6;
        }

        .log-warning .log-type {
          color: #ffb74d;
        }

        .log-error .log-type {
          color: #e57373;
        }

        .log-success .log-type {
          color: #81c784;
        }

        .log-progress .log-type {
          color: #ba68c8;
        }

        /* Scrollbar styling */
        .log-container::-webkit-scrollbar {
          width: 6px;
        }

        .log-container::-webkit-scrollbar-track {
          background: var(--bg-primary);
        }

        .log-container::-webkit-scrollbar-thumb {
          background: var(--border-color);
          border-radius: 3px;
        }

        .log-container::-webkit-scrollbar-thumb:hover {
          background: var(--text-muted);
        }
      `}</style>
    </div>
  )
}

export default LogPanel
