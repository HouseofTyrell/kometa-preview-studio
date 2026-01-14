import { useState, useCallback, useMemo } from 'react'
import {
  QueueConfig,
  OverlayConfig,
  HorizontalAlign,
  VerticalAlign,
  createQueueConfig,
} from '../../types/overlayConfig'

interface QueueConfigPanelProps {
  queues: QueueConfig[]
  overlays: OverlayConfig[]
  onQueuesChange: (queues: QueueConfig[]) => void
  onOverlayQueueChange: (overlayId: string, queueName: string | undefined) => void
  disabled?: boolean
}

// Grid positions for queue placement
const GRID_POSITIONS: Array<{
  key: string
  h: HorizontalAlign
  v: VerticalAlign
}> = [
  { key: 'top-left', h: 'left', v: 'top' },
  { key: 'top-center', h: 'center', v: 'top' },
  { key: 'top-right', h: 'right', v: 'top' },
  { key: 'center-left', h: 'left', v: 'center' },
  { key: 'center-center', h: 'center', v: 'center' },
  { key: 'center-right', h: 'right', v: 'center' },
  { key: 'bottom-left', h: 'left', v: 'bottom' },
  { key: 'bottom-center', h: 'center', v: 'bottom' },
  { key: 'bottom-right', h: 'right', v: 'bottom' },
]

function QueueConfigPanel({
  queues,
  overlays,
  onQueuesChange,
  onOverlayQueueChange,
  disabled = false,
}: QueueConfigPanelProps) {
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(
    queues.length > 0 ? queues[0].id : null
  )
  const [newQueueName, setNewQueueName] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Get selected queue
  const selectedQueue = useMemo(
    () => queues.find((q) => q.id === selectedQueueId) || null,
    [queues, selectedQueueId]
  )

  // Get overlays assigned to each queue
  const overlaysByQueue = useMemo(() => {
    const map: Record<string, OverlayConfig[]> = {}
    for (const overlay of overlays) {
      if (overlay.grouping.queue) {
        if (!map[overlay.grouping.queue]) {
          map[overlay.grouping.queue] = []
        }
        map[overlay.grouping.queue].push(overlay)
      }
    }
    return map
  }, [overlays])

  // Create a new queue
  const handleCreateQueue = useCallback(() => {
    if (!newQueueName.trim()) return

    const newQueue = createQueueConfig(newQueueName.trim())
    onQueuesChange([...queues, newQueue])
    setSelectedQueueId(newQueue.id)
    setNewQueueName('')
    setShowCreateForm(false)
  }, [newQueueName, queues, onQueuesChange])

  // Delete a queue
  const handleDeleteQueue = useCallback(
    (queueId: string) => {
      const queue = queues.find((q) => q.id === queueId)
      if (!queue) return

      // Remove queue assignment from all overlays in this queue
      const overlaysInQueue = overlaysByQueue[queue.name] || []
      for (const overlay of overlaysInQueue) {
        onOverlayQueueChange(overlay.id, undefined)
      }

      // Remove the queue
      const newQueues = queues.filter((q) => q.id !== queueId)
      onQueuesChange(newQueues)

      // Select another queue if the deleted one was selected
      if (selectedQueueId === queueId) {
        setSelectedQueueId(newQueues.length > 0 ? newQueues[0].id : null)
      }
    },
    [queues, overlaysByQueue, selectedQueueId, onQueuesChange, onOverlayQueueChange]
  )

  // Update queue property
  const handleQueueUpdate = useCallback(
    (queueId: string, updates: Partial<QueueConfig>) => {
      const newQueues = queues.map((q) =>
        q.id === queueId ? { ...q, ...updates } : q
      )
      onQueuesChange(newQueues)
    },
    [queues, onQueuesChange]
  )

  // Update queue position
  const handlePositionChange = useCallback(
    (h: HorizontalAlign, v: VerticalAlign) => {
      if (!selectedQueue) return
      handleQueueUpdate(selectedQueue.id, {
        position: { horizontalAlign: h, verticalAlign: v },
      })
    },
    [selectedQueue, handleQueueUpdate]
  )

  // Get queue position key
  const getQueuePositionKey = (queue: QueueConfig) =>
    `${queue.position.verticalAlign}-${queue.position.horizontalAlign}`

  return (
    <div className="queue-config-panel">
      <div className="panel-header">
        <h3 className="panel-title">Queue Configuration</h3>
        <button
          type="button"
          className="add-queue-btn"
          onClick={() => setShowCreateForm(!showCreateForm)}
          disabled={disabled}
        >
          {showCreateForm ? 'Cancel' : '+ Add Queue'}
        </button>
      </div>

      {/* Create Queue Form */}
      {showCreateForm && (
        <div className="create-form">
          <input
            type="text"
            className="queue-name-input"
            value={newQueueName}
            onChange={(e) => setNewQueueName(e.target.value)}
            placeholder="Queue name (e.g., bottom_row)"
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateQueue()
            }}
          />
          <button
            type="button"
            className="create-btn"
            onClick={handleCreateQueue}
            disabled={disabled || !newQueueName.trim()}
          >
            Create
          </button>
        </div>
      )}

      {/* Queue List */}
      <div className="queue-list">
        {queues.length === 0 ? (
          <div className="empty-state">
            <p>No queues configured.</p>
            <p className="hint">
              Queues let you arrange multiple overlays in a row or column.
            </p>
          </div>
        ) : (
          queues.map((queue) => (
            <div
              key={queue.id}
              className={`queue-item ${selectedQueueId === queue.id ? 'selected' : ''}`}
              onClick={() => setSelectedQueueId(queue.id)}
            >
              <div className="queue-info">
                <span className="queue-name">{queue.name}</span>
                <span className="queue-meta">
                  {queue.direction === 'horizontal' ? '→' : '↓'}{' '}
                  {overlaysByQueue[queue.name]?.length || 0} items
                </span>
              </div>
              <button
                type="button"
                className="delete-queue-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteQueue(queue.id)
                }}
                disabled={disabled}
                title="Delete queue"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      {/* Queue Editor */}
      {selectedQueue && (
        <div className="queue-editor">
          <div className="editor-section">
            <label className="section-label">Starting Position</label>
            <div className="position-grid">
              {GRID_POSITIONS.map(({ key, h, v }) => (
                <button
                  key={key}
                  type="button"
                  className={`grid-cell ${
                    getQueuePositionKey(selectedQueue) === key ? 'active' : ''
                  }`}
                  onClick={() => handlePositionChange(h, v)}
                  disabled={disabled}
                  title={key}
                >
                  <span className="cell-dot" />
                </button>
              ))}
            </div>
          </div>

          <div className="editor-section">
            <label className="section-label">Direction</label>
            <div className="direction-toggle">
              <button
                type="button"
                className={`direction-btn ${
                  selectedQueue.direction === 'horizontal' ? 'active' : ''
                }`}
                onClick={() =>
                  handleQueueUpdate(selectedQueue.id, { direction: 'horizontal' })
                }
                disabled={disabled}
              >
                → Horizontal
              </button>
              <button
                type="button"
                className={`direction-btn ${
                  selectedQueue.direction === 'vertical' ? 'active' : ''
                }`}
                onClick={() =>
                  handleQueueUpdate(selectedQueue.id, { direction: 'vertical' })
                }
                disabled={disabled}
              >
                ↓ Vertical
              </button>
            </div>
          </div>

          <div className="editor-section">
            <div className="control-row">
              <label className="control-label">Spacing:</label>
              <div className="number-input-group">
                <input
                  type="number"
                  className="number-input"
                  value={selectedQueue.spacing}
                  onChange={(e) =>
                    handleQueueUpdate(selectedQueue.id, {
                      spacing: Math.max(0, parseInt(e.target.value) || 0),
                    })
                  }
                  disabled={disabled}
                  min={0}
                  max={100}
                />
                <span className="unit">px</span>
              </div>
            </div>
          </div>

          {/* Items in Queue */}
          <div className="editor-section">
            <label className="section-label">
              Items in Queue ({overlaysByQueue[selectedQueue.name]?.length || 0})
            </label>
            <div className="queue-items">
              {overlaysByQueue[selectedQueue.name]?.length ? (
                overlaysByQueue[selectedQueue.name]
                  .sort((a, b) => b.grouping.weight - a.grouping.weight)
                  .map((overlay, index) => (
                    <div key={overlay.id} className="queue-overlay-item">
                      <span className="item-index">{index + 1}</span>
                      <span className="item-name">{overlay.displayName}</span>
                      <span className="item-weight">w: {overlay.grouping.weight}</span>
                      <button
                        type="button"
                        className="remove-from-queue-btn"
                        onClick={() => onOverlayQueueChange(overlay.id, undefined)}
                        disabled={disabled}
                        title="Remove from queue"
                      >
                        ×
                      </button>
                    </div>
                  ))
              ) : (
                <div className="no-items">
                  No overlays in this queue.
                  <br />
                  <span className="hint">
                    Assign overlays via Advanced Options in the properties panel.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .queue-config-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background-color: var(--bg-secondary);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-color);
          overflow: hidden;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border-color);
        }

        .panel-title {
          margin: 0;
          font-size: 0.875rem;
          font-weight: 600;
        }

        .add-queue-btn {
          padding: 0.375rem 0.75rem;
          background-color: var(--primary);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          font-size: 0.75rem;
          font-weight: 500;
          cursor: pointer;
        }

        .add-queue-btn:hover:not(:disabled) {
          opacity: 0.9;
        }

        .add-queue-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .create-form {
          display: flex;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border-color);
          background-color: var(--bg-tertiary);
        }

        .queue-name-input {
          flex: 1;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          background-color: var(--bg-primary);
          color: var(--text-primary);
          font-size: 0.875rem;
        }

        .queue-name-input:focus {
          outline: none;
          border-color: var(--primary);
        }

        .create-btn {
          padding: 0.5rem 1rem;
          background-color: var(--success);
          color: white;
          border: none;
          border-radius: var(--radius-sm);
          font-size: 0.875rem;
          cursor: pointer;
        }

        .create-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .queue-list {
          padding: 0.5rem;
          max-height: 150px;
          overflow-y: auto;
          border-bottom: 1px solid var(--border-color);
        }

        .empty-state {
          text-align: center;
          padding: 1rem;
          color: var(--text-muted);
          font-size: 0.875rem;
        }

        .empty-state .hint {
          font-size: 0.75rem;
          margin-top: 0.25rem;
        }

        .queue-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 0.75rem;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.15s;
        }

        .queue-item:hover {
          background-color: var(--bg-tertiary);
        }

        .queue-item.selected {
          background-color: var(--primary-light, rgba(99, 102, 241, 0.1));
          border-left: 2px solid var(--primary);
        }

        .queue-info {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }

        .queue-name {
          font-size: 0.875rem;
          font-weight: 500;
        }

        .queue-meta {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .delete-queue-btn {
          padding: 0.25rem 0.5rem;
          background: none;
          border: none;
          font-size: 1rem;
          color: var(--text-muted);
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.15s;
        }

        .queue-item:hover .delete-queue-btn {
          opacity: 1;
        }

        .delete-queue-btn:hover {
          color: var(--danger);
        }

        .queue-editor {
          flex: 1;
          padding: 1rem;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .editor-section {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .section-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .position-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 4px;
          width: 100px;
        }

        .grid-cell {
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.15s;
        }

        .grid-cell:hover:not(:disabled) {
          background-color: var(--bg-primary);
          border-color: var(--primary);
        }

        .grid-cell.active {
          background-color: var(--primary);
          border-color: var(--primary);
        }

        .grid-cell.active .cell-dot {
          background-color: white;
        }

        .cell-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background-color: var(--text-muted);
        }

        .direction-toggle {
          display: flex;
          gap: 0.25rem;
          padding: 0.25rem;
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-sm);
        }

        .direction-btn {
          flex: 1;
          padding: 0.5rem;
          border: none;
          background: transparent;
          font-size: 0.75rem;
          color: var(--text-secondary);
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: all 0.15s;
        }

        .direction-btn:hover:not(:disabled) {
          color: var(--text-primary);
        }

        .direction-btn.active {
          background-color: var(--bg-primary);
          color: var(--primary);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        .control-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .control-label {
          font-size: 0.75rem;
          color: var(--text-secondary);
          min-width: 60px;
        }

        .number-input-group {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .number-input {
          width: 60px;
          padding: 0.375rem 0.5rem;
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          background-color: var(--bg-primary);
          color: var(--text-primary);
          font-size: 0.875rem;
          text-align: center;
        }

        .number-input:focus {
          outline: none;
          border-color: var(--primary);
        }

        .unit {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .queue-items {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          max-height: 150px;
          overflow-y: auto;
        }

        .queue-overlay-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-sm);
        }

        .item-index {
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--primary);
          color: white;
          font-size: 0.75rem;
          font-weight: bold;
          border-radius: 50%;
        }

        .item-name {
          flex: 1;
          font-size: 0.875rem;
        }

        .item-weight {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .remove-from-queue-btn {
          padding: 0.125rem 0.375rem;
          background: none;
          border: none;
          font-size: 0.875rem;
          color: var(--text-muted);
          cursor: pointer;
        }

        .remove-from-queue-btn:hover {
          color: var(--danger);
        }

        .no-items {
          text-align: center;
          padding: 1rem;
          color: var(--text-muted);
          font-size: 0.75rem;
        }

        .no-items .hint {
          font-size: 0.625rem;
          margin-top: 0.25rem;
        }
      `}</style>
    </div>
  )
}

export default QueueConfigPanel
