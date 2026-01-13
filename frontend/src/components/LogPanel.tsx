import { useEffect, useRef } from 'react'
import { JobEvent } from '../api/client'

interface LogPanelProps {
  logs: JobEvent[]
}

function LogPanel({ logs }: LogPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

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

  return (
    <div className="log-panel card">
      <h2 className="card-title">Logs</h2>

      <div className="log-container" ref={scrollRef}>
        {logs.length === 0 ? (
          <div className="log-empty">
            <span>No logs yet. Start a preview to see output.</span>
          </div>
        ) : (
          <div className="log-entries">
            {logs.map((log, index) => (
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
