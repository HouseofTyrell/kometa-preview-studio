import { useCallback, useState } from 'react'
import { OverlayConfig } from '../../types/overlayConfig'
import { exportOverlay } from '../../utils/overlayExport'

interface ActiveOverlaysListProps {
  overlays: OverlayConfig[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  onReorder: (overlays: OverlayConfig[]) => void
  onDelete: (id: string) => void
  disabled?: boolean
}

function ActiveOverlaysList({
  overlays,
  selectedId,
  onSelect,
  onToggle,
  onReorder,
  onDelete,
  disabled = false,
}: ActiveOverlaysListProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [searchFilter, setSearchFilter] = useState('')

  const getPositionLabel = (overlay: OverlayConfig): string => {
    const { horizontalAlign, verticalAlign } = overlay.position
    const vLabel = verticalAlign === 'top' ? 'Top' : verticalAlign === 'bottom' ? 'Bottom' : 'Mid'
    const hLabel = horizontalAlign === 'left' ? 'Left' : horizontalAlign === 'right' ? 'Right' : 'Center'
    return `${vLabel}-${hLabel}`
  }

  const moveOverlay = useCallback(
    (index: number, direction: 'up' | 'down') => {
      if (disabled) return
      const newIndex = direction === 'up' ? index - 1 : index + 1
      if (newIndex < 0 || newIndex >= overlays.length) return

      const newOverlays = [...overlays]
      const [removed] = newOverlays.splice(index, 1)
      newOverlays.splice(newIndex, 0, removed)

      // Update weights based on new order
      const reweighted = newOverlays.map((o, i) => ({
        ...o,
        grouping: {
          ...o.grouping,
          weight: (newOverlays.length - i) * 10,
        },
      }))

      onReorder(reweighted)
    },
    [overlays, onReorder, disabled]
  )

  // Drag and drop handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      if (disabled) return
      setDraggedIndex(index)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', index.toString())
      // Add a slight delay to allow the drag image to be set
      setTimeout(() => {
        const target = e.target as HTMLElement
        target.classList.add('dragging')
      }, 0)
    },
    [disabled]
  )

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault()
      if (draggedIndex === null || draggedIndex === index) return
      setDragOverIndex(index)
    },
    [draggedIndex]
  )

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault()
      if (draggedIndex === null || draggedIndex === dropIndex || disabled) return

      const newOverlays = [...overlays]
      const [removed] = newOverlays.splice(draggedIndex, 1)
      newOverlays.splice(dropIndex, 0, removed)

      // Update weights based on new order
      const reweighted = newOverlays.map((o, i) => ({
        ...o,
        grouping: {
          ...o.grouping,
          weight: (newOverlays.length - i) * 10,
        },
      }))

      onReorder(reweighted)
      setDraggedIndex(null)
      setDragOverIndex(null)
    },
    [draggedIndex, overlays, onReorder, disabled]
  )

  if (overlays.length === 0) {
    return (
      <div className="active-overlays empty">
        <div className="empty-state">
          <p>No overlays added yet</p>
          <p className="empty-hint">Add overlays from the library on the left</p>
        </div>

        <style>{`
          .active-overlays.empty {
            padding: 2rem 1rem;
            text-align: center;
            color: var(--text-muted);
            background-color: var(--bg-secondary);
            border-radius: var(--radius-md);
            border: 1px dashed var(--border-color);
          }

          .empty-hint {
            font-size: 0.75rem;
            margin-top: 0.25rem;
          }
        `}</style>
      </div>
    )
  }

  // Filter overlays based on search
  const filteredOverlays = searchFilter
    ? overlays.filter((o) =>
        o.displayName.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (o.pmmOverlay && o.pmmOverlay.toLowerCase().includes(searchFilter.toLowerCase()))
      )
    : overlays

  const enabledCount = overlays.filter((o) => o.enabled).length
  const allEnabled = overlays.length > 0 && enabledCount === overlays.length
  const noneEnabled = enabledCount === 0

  const handleEnableAll = () => {
    if (disabled) return
    const updatedOverlays = overlays.map((o) => ({ ...o, enabled: true }))
    // Recalculate weights
    const reweighted = updatedOverlays.map((o, i) => ({
      ...o,
      grouping: { ...o.grouping, weight: (updatedOverlays.length - i) * 10 },
    }))
    onReorder(reweighted)
  }

  const handleDisableAll = () => {
    if (disabled) return
    const updatedOverlays = overlays.map((o) => ({ ...o, enabled: false }))
    const reweighted = updatedOverlays.map((o, i) => ({
      ...o,
      grouping: { ...o.grouping, weight: (updatedOverlays.length - i) * 10 },
    }))
    onReorder(reweighted)
  }

  const handleToggleAll = () => {
    if (allEnabled) {
      handleDisableAll()
    } else {
      handleEnableAll()
    }
  }

  return (
    <div className="active-overlays">
      <div className="list-header">
        <div className="header-left">
          <input
            type="checkbox"
            checked={allEnabled}
            ref={(el) => {
              if (el) el.indeterminate = !allEnabled && !noneEnabled
            }}
            onChange={handleToggleAll}
            disabled={disabled || overlays.length === 0}
            title={allEnabled ? 'Disable all' : 'Enable all'}
          />
          <span className="header-title">Active Overlays</span>
        </div>
        <div className="header-right">
          <span className="header-count">{enabledCount}/{overlays.length}</span>
          <div className="bulk-actions">
            <button
              type="button"
              className="bulk-btn"
              onClick={handleEnableAll}
              disabled={disabled || allEnabled}
              title="Enable all overlays"
            >
              All On
            </button>
            <button
              type="button"
              className="bulk-btn"
              onClick={handleDisableAll}
              disabled={disabled || noneEnabled}
              title="Disable all overlays"
            >
              All Off
            </button>
          </div>
        </div>
      </div>

      {overlays.length > 3 && (
        <div className="search-bar">
          <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Filter overlays..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
          {searchFilter && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setSearchFilter('')}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      )}

      <div className="overlay-list">
        {filteredOverlays.length === 0 && searchFilter && (
          <div className="no-results">
            No overlays match "{searchFilter}"
          </div>
        )}
        {filteredOverlays.map((overlay) => {
          const originalIndex = overlays.findIndex((o) => o.id === overlay.id)
          const isFiltering = searchFilter.length > 0
          return (
          <div
            key={overlay.id}
            className={`overlay-row ${selectedId === overlay.id ? 'selected' : ''} ${
              !overlay.enabled ? 'disabled-overlay' : ''
            } ${draggedIndex === originalIndex ? 'dragging' : ''} ${
              dragOverIndex === originalIndex ? 'drag-over' : ''
            }`}
            onClick={() => onSelect(overlay.id)}
            draggable={!disabled && !isFiltering}
            onDragStart={(e) => handleDragStart(e, originalIndex)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, originalIndex)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, originalIndex)}
          >
            {!isFiltering && (
              <div className="drag-handle" title="Drag to reorder">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="9" cy="6" r="2" />
                  <circle cx="15" cy="6" r="2" />
                  <circle cx="9" cy="12" r="2" />
                  <circle cx="15" cy="12" r="2" />
                  <circle cx="9" cy="18" r="2" />
                  <circle cx="15" cy="18" r="2" />
                </svg>
              </div>
            )}
            <div className="row-checkbox">
              <input
                type="checkbox"
                checked={overlay.enabled}
                onChange={(e) => {
                  e.stopPropagation()
                  onToggle(overlay.id, e.target.checked)
                }}
                disabled={disabled}
              />
            </div>

            <div className="row-info">
              <span className="overlay-name">{overlay.displayName}</span>
              <span className="overlay-position">{getPositionLabel(overlay)}</span>
            </div>

            <div className="row-meta">
              {overlay.grouping.group && (
                <span className="meta-tag" title={`Group: ${overlay.grouping.group}`}>
                  {overlay.grouping.group}
                </span>
              )}
              <span className="meta-weight" title="Weight">
                W:{overlay.grouping.weight}
              </span>
            </div>

            <div className="row-actions">
              {!isFiltering && (
                <>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      moveOverlay(originalIndex, 'up')
                    }}
                    disabled={disabled || originalIndex === 0}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      moveOverlay(originalIndex, 'down')
                    }}
                    disabled={disabled || originalIndex === overlays.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                </>
              )}
              <button
                type="button"
                className="action-btn export"
                onClick={(e) => {
                  e.stopPropagation()
                  exportOverlay(overlay)
                }}
                title="Export overlay"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              <button
                type="button"
                className="action-btn delete"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(overlay.id)
                }}
                disabled={disabled}
                title="Remove"
              >
                ×
              </button>
            </div>
          </div>
          )
        })}
      </div>

      <style>{`
        .active-overlays {
          background-color: var(--bg-secondary);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-color);
          overflow: hidden;
        }

        .list-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border-color);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .header-left input[type="checkbox"] {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .header-title {
          font-size: 0.875rem;
          font-weight: 600;
        }

        .header-count {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .bulk-actions {
          display: flex;
          gap: 0.25rem;
        }

        .bulk-btn {
          padding: 0.25rem 0.5rem;
          font-size: 0.625rem;
          font-weight: 500;
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.15s;
        }

        .bulk-btn:hover:not(:disabled) {
          background-color: var(--bg-primary);
          color: var(--text-primary);
        }

        .bulk-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .search-bar {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background-color: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-color);
        }

        .search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .search-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          font-size: 0.8125rem;
          color: var(--text-primary);
        }

        .search-input::placeholder {
          color: var(--text-muted);
        }

        .search-clear {
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 1rem;
          border-radius: var(--radius-sm);
        }

        .search-clear:hover {
          background-color: var(--bg-primary);
          color: var(--text-primary);
        }

        .no-results {
          padding: 1.5rem;
          text-align: center;
          color: var(--text-muted);
          font-size: 0.875rem;
        }

        .overlay-list {
          max-height: 300px;
          overflow-y: auto;
        }

        .overlay-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 1rem;
          border-bottom: 1px solid var(--border-color);
          cursor: pointer;
          transition: background-color 0.15s;
        }

        .overlay-row:last-child {
          border-bottom: none;
        }

        .overlay-row:hover {
          background-color: var(--bg-tertiary);
        }

        .overlay-row.selected {
          background-color: var(--primary-light, rgba(99, 102, 241, 0.1));
          border-left: 3px solid var(--primary);
          padding-left: calc(1rem - 3px);
        }

        .overlay-row.disabled-overlay {
          opacity: 0.5;
        }

        .overlay-row.dragging {
          opacity: 0.5;
          background-color: var(--bg-tertiary);
        }

        .overlay-row.drag-over {
          border-top: 2px solid var(--accent-primary);
          margin-top: -1px;
        }

        .overlay-row[draggable="true"] {
          cursor: grab;
        }

        .overlay-row[draggable="true"]:active {
          cursor: grabbing;
        }

        .drag-handle {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          opacity: 0.5;
          transition: opacity 0.15s;
          cursor: grab;
        }

        .overlay-row:hover .drag-handle {
          opacity: 1;
        }

        .drag-handle:active {
          cursor: grabbing;
        }

        .row-checkbox {
          display: flex;
          align-items: center;
        }

        .row-checkbox input {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }

        .row-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
        }

        .overlay-name {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--text-primary);
        }

        .overlay-position {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .row-meta {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .meta-tag {
          font-size: 0.625rem;
          padding: 0.125rem 0.375rem;
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          text-transform: uppercase;
        }

        .meta-weight {
          font-size: 0.625rem;
          color: var(--text-muted);
          font-family: var(--font-mono);
        }

        .row-actions {
          display: flex;
          gap: 0.25rem;
          opacity: 0;
          transition: opacity 0.15s;
        }

        .overlay-row:hover .row-actions {
          opacity: 1;
        }

        .action-btn {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 0.875rem;
          color: var(--text-secondary);
          transition: all 0.15s;
        }

        .action-btn:hover:not(:disabled) {
          background-color: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .action-btn.delete:hover:not(:disabled) {
          background-color: var(--error);
          border-color: var(--error);
          color: white;
        }

        .action-btn.export {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .action-btn.export:hover:not(:disabled) {
          background-color: var(--accent-primary);
          border-color: var(--accent-primary);
          color: #000;
        }

        .action-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  )
}

export default ActiveOverlaysList
