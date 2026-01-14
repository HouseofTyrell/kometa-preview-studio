import { useState, useCallback, useMemo } from 'react'
import {
  QueueConfig,
  OverlayConfig,
  HorizontalAlign,
  VerticalAlign,
  createQueueConfig,
} from '../../types/overlayConfig'
import './QueueConfigPanel.css'

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
      const newQueues = queues.map((q) => (q.id === queueId ? { ...q, ...updates } : q))
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
            <p className="hint">Queues let you arrange multiple overlays in a row or column.</p>
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
                  className={`grid-cell ${getQueuePositionKey(selectedQueue) === key ? 'active' : ''}`}
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
                className={`direction-btn ${selectedQueue.direction === 'horizontal' ? 'active' : ''}`}
                onClick={() => handleQueueUpdate(selectedQueue.id, { direction: 'horizontal' })}
                disabled={disabled}
              >
                → Horizontal
              </button>
              <button
                type="button"
                className={`direction-btn ${selectedQueue.direction === 'vertical' ? 'active' : ''}`}
                onClick={() => handleQueueUpdate(selectedQueue.id, { direction: 'vertical' })}
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
    </div>
  )
}

export default QueueConfigPanel
