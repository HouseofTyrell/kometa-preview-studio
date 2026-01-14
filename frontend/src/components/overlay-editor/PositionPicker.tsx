import { useCallback } from 'react'
import {
  OverlayPosition,
  HorizontalAlign,
  VerticalAlign,
  getPositionPresetKey,
} from '../../types/overlayConfig'

interface PositionPickerProps {
  position: OverlayPosition
  onChange: (position: OverlayPosition) => void
  disabled?: boolean
}

const GRID_POSITIONS: Array<{ key: string; label: string; h: HorizontalAlign; v: VerticalAlign }> = [
  { key: 'top-left', label: 'TL', h: 'left', v: 'top' },
  { key: 'top-center', label: 'TC', h: 'center', v: 'top' },
  { key: 'top-right', label: 'TR', h: 'right', v: 'top' },
  { key: 'middle-left', label: 'ML', h: 'left', v: 'center' },
  { key: 'middle-center', label: 'MC', h: 'center', v: 'center' },
  { key: 'middle-right', label: 'MR', h: 'right', v: 'center' },
  { key: 'bottom-left', label: 'BL', h: 'left', v: 'bottom' },
  { key: 'bottom-center', label: 'BC', h: 'center', v: 'bottom' },
  { key: 'bottom-right', label: 'BR', h: 'right', v: 'bottom' },
]

function PositionPicker({ position, onChange, disabled = false }: PositionPickerProps) {
  const currentPreset = getPositionPresetKey(position)

  const handleGridClick = useCallback(
    (h: HorizontalAlign, v: VerticalAlign) => {
      if (disabled) return
      onChange({
        ...position,
        horizontalAlign: h,
        verticalAlign: v,
      })
    },
    [position, onChange, disabled]
  )

  const handleOffsetChange = useCallback(
    (axis: 'horizontal' | 'vertical', value: number) => {
      if (disabled) return
      const clampedValue = Math.max(0, Math.min(500, value))
      onChange({
        ...position,
        [axis === 'horizontal' ? 'horizontalOffset' : 'verticalOffset']: clampedValue,
      })
    },
    [position, onChange, disabled]
  )

  const adjustOffset = useCallback(
    (axis: 'horizontal' | 'vertical', delta: number) => {
      const currentValue =
        axis === 'horizontal' ? position.horizontalOffset : position.verticalOffset
      handleOffsetChange(axis, currentValue + delta)
    },
    [position, handleOffsetChange]
  )

  return (
    <div className="position-picker">
      <label className="picker-label">Position</label>

      {/* 3x3 Grid Selector */}
      <div className="position-grid">
        {GRID_POSITIONS.map(({ key, h, v }) => (
          <button
            key={key}
            type="button"
            className={`grid-cell ${currentPreset === key ? 'active' : ''}`}
            onClick={() => handleGridClick(h, v)}
            disabled={disabled}
            title={`${v}-${h}`}
          >
            {currentPreset === key ? '●' : '○'}
          </button>
        ))}
      </div>

      {/* Offset Controls */}
      <div className="offset-controls">
        <div className="offset-row">
          <label className="offset-label">H Offset:</label>
          <button
            type="button"
            className="offset-btn"
            onClick={() => adjustOffset('horizontal', -5)}
            disabled={disabled}
          >
            -
          </button>
          <input
            type="number"
            className="offset-input"
            value={position.horizontalOffset}
            onChange={(e) => handleOffsetChange('horizontal', parseInt(e.target.value) || 0)}
            disabled={disabled}
            min={0}
            max={500}
          />
          <button
            type="button"
            className="offset-btn"
            onClick={() => adjustOffset('horizontal', 5)}
            disabled={disabled}
          >
            +
          </button>
          <span className="offset-unit">px</span>
        </div>

        <div className="offset-row">
          <label className="offset-label">V Offset:</label>
          <button
            type="button"
            className="offset-btn"
            onClick={() => adjustOffset('vertical', -5)}
            disabled={disabled}
          >
            -
          </button>
          <input
            type="number"
            className="offset-input"
            value={position.verticalOffset}
            onChange={(e) => handleOffsetChange('vertical', parseInt(e.target.value) || 0)}
            disabled={disabled}
            min={0}
            max={500}
          />
          <button
            type="button"
            className="offset-btn"
            onClick={() => adjustOffset('vertical', 5)}
            disabled={disabled}
          >
            +
          </button>
          <span className="offset-unit">px</span>
        </div>
      </div>

      <style>{`
        .position-picker {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .picker-label {
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
          width: fit-content;
        }

        .grid-cell {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 1rem;
          color: var(--text-muted);
          transition: all 0.15s ease;
        }

        .grid-cell:hover:not(:disabled) {
          background-color: var(--bg-tertiary);
          border-color: var(--primary);
        }

        .grid-cell.active {
          background-color: var(--primary);
          border-color: var(--primary);
          color: white;
        }

        .grid-cell:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .offset-controls {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .offset-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .offset-label {
          font-size: 0.75rem;
          color: var(--text-secondary);
          min-width: 60px;
        }

        .offset-btn {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          cursor: pointer;
          font-size: 1rem;
          font-weight: bold;
          color: var(--text-primary);
        }

        .offset-btn:hover:not(:disabled) {
          background-color: var(--bg-tertiary);
        }

        .offset-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .offset-input {
          width: 60px;
          height: 28px;
          padding: 0 0.5rem;
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          background-color: var(--bg-primary);
          color: var(--text-primary);
          font-size: 0.875rem;
          text-align: center;
        }

        .offset-input:focus {
          outline: none;
          border-color: var(--primary);
        }

        .offset-input:disabled {
          opacity: 0.5;
        }

        .offset-unit {
          font-size: 0.75rem;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  )
}

export default PositionPicker
