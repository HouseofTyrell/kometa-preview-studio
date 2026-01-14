import { useState, useCallback } from 'react'
import {
  TestOptions,
  DEFAULT_TEST_OPTIONS,
  hasActiveFilters,
  getFilterSummary,
} from '../types/testOptions'

// Static preview targets (mirrors backend PREVIEW_TARGETS)
const PREVIEW_TARGETS = [
  { id: 'matrix', label: 'The Matrix (1999)', type: 'movie' },
  { id: 'dune', label: 'Dune (2021)', type: 'movie' },
  { id: 'breakingbad_series', label: 'Breaking Bad', type: 'show' },
  { id: 'breakingbad_s01', label: 'Breaking Bad S01', type: 'season' },
  { id: 'breakingbad_s01e01', label: 'Breaking Bad S01E01', type: 'episode' },
]

interface TestOptionsPanelProps {
  options: TestOptions
  onChange: (options: TestOptions) => void
  libraryNames: string[]
  overlayFiles: string[]
  disabled?: boolean
}

function TestOptionsPanel({
  options,
  onChange,
  libraryNames,
  overlayFiles,
  disabled = false,
}: TestOptionsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const handleTargetToggle = useCallback(
    (targetId: string) => {
      const newTargets = options.selectedTargets.includes(targetId)
        ? options.selectedTargets.filter((id) => id !== targetId)
        : [...options.selectedTargets, targetId]
      onChange({ ...options, selectedTargets: newTargets })
    },
    [options, onChange]
  )

  const handleMediaTypeToggle = useCallback(
    (type: keyof typeof options.mediaTypes) => {
      onChange({
        ...options,
        mediaTypes: {
          ...options.mediaTypes,
          [type]: !options.mediaTypes[type],
        },
      })
    },
    [options, onChange]
  )

  const handleLibraryToggle = useCallback(
    (libName: string) => {
      const newLibraries = options.selectedLibraries.includes(libName)
        ? options.selectedLibraries.filter((name) => name !== libName)
        : [...options.selectedLibraries, libName]
      onChange({ ...options, selectedLibraries: newLibraries })
    },
    [options, onChange]
  )

  const handleOverlayToggle = useCallback(
    (overlay: string) => {
      const newOverlays = options.selectedOverlays.includes(overlay)
        ? options.selectedOverlays.filter((o) => o !== overlay)
        : [...options.selectedOverlays, overlay]
      onChange({ ...options, selectedOverlays: newOverlays })
    },
    [options, onChange]
  )

  const handleSelectAllTargets = useCallback(() => {
    onChange({ ...options, selectedTargets: [] })
  }, [options, onChange])

  const handleDeselectAllTargets = useCallback(() => {
    onChange({ ...options, selectedTargets: PREVIEW_TARGETS.map((t) => t.id) })
  }, [options, onChange])

  const handleReset = useCallback(() => {
    onChange(DEFAULT_TEST_OPTIONS)
  }, [onChange])

  const isFiltered = hasActiveFilters(options)
  const summary = getFilterSummary(options)

  // Determine which targets are effectively selected
  const getEffectivelySelectedTargets = () => {
    let targets = PREVIEW_TARGETS

    // Filter by media types
    targets = targets.filter((t) => {
      switch (t.type) {
        case 'movie':
          return options.mediaTypes.movies
        case 'show':
          return options.mediaTypes.shows
        case 'season':
          return options.mediaTypes.seasons
        case 'episode':
          return options.mediaTypes.episodes
        default:
          return true
      }
    })

    // Filter by selected targets
    if (options.selectedTargets.length > 0) {
      targets = targets.filter((t) => options.selectedTargets.includes(t.id))
    }

    return targets
  }

  const effectiveTargets = getEffectivelySelectedTargets()

  return (
    <div className="test-options-panel">
      <div className="options-header" onClick={toggleExpanded}>
        <div className="options-title">
          <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
          <span>Test Options</span>
          {isFiltered && <span className="filter-badge">Filtered</span>}
        </div>
        <div className="options-summary">{summary}</div>
      </div>

      {isExpanded && (
        <div className="options-content">
          {/* Media Type Filters */}
          <div className="options-section">
            <h4 className="section-title">Media Types</h4>
            <div className="checkbox-grid">
              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={options.mediaTypes.movies}
                  onChange={() => handleMediaTypeToggle('movies')}
                  disabled={disabled}
                />
                <span>Movies</span>
              </label>
              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={options.mediaTypes.shows}
                  onChange={() => handleMediaTypeToggle('shows')}
                  disabled={disabled}
                />
                <span>TV Shows</span>
              </label>
              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={options.mediaTypes.seasons}
                  onChange={() => handleMediaTypeToggle('seasons')}
                  disabled={disabled}
                />
                <span>Seasons</span>
              </label>
              <label className="checkbox-item">
                <input
                  type="checkbox"
                  checked={options.mediaTypes.episodes}
                  onChange={() => handleMediaTypeToggle('episodes')}
                  disabled={disabled}
                />
                <span>Episodes</span>
              </label>
            </div>
          </div>

          {/* Target Selection */}
          <div className="options-section">
            <div className="section-header">
              <h4 className="section-title">Preview Targets</h4>
              <div className="section-actions">
                <button
                  type="button"
                  className="btn-link"
                  onClick={handleSelectAllTargets}
                  disabled={disabled}
                >
                  All
                </button>
                <button
                  type="button"
                  className="btn-link"
                  onClick={handleDeselectAllTargets}
                  disabled={disabled}
                >
                  None
                </button>
              </div>
            </div>
            <div className="target-list">
              {PREVIEW_TARGETS.map((target) => {
                const isSelected =
                  options.selectedTargets.length === 0 ||
                  options.selectedTargets.includes(target.id)
                const isMediaTypeEnabled =
                  (target.type === 'movie' && options.mediaTypes.movies) ||
                  (target.type === 'show' && options.mediaTypes.shows) ||
                  (target.type === 'season' && options.mediaTypes.seasons) ||
                  (target.type === 'episode' && options.mediaTypes.episodes)

                return (
                  <label
                    key={target.id}
                    className={`checkbox-item ${!isMediaTypeEnabled ? 'disabled-by-type' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected && isMediaTypeEnabled}
                      onChange={() => handleTargetToggle(target.id)}
                      disabled={disabled || !isMediaTypeEnabled}
                    />
                    <span className="target-label">
                      {target.label}
                      <span className="target-type">{target.type}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            <div className="effective-count">
              {effectiveTargets.length} of {PREVIEW_TARGETS.length} targets will be tested
            </div>
          </div>

          {/* Library Selection */}
          {libraryNames.length > 0 && (
            <div className="options-section">
              <h4 className="section-title">Libraries</h4>
              <p className="section-hint">
                Leave all unchecked to include all libraries
              </p>
              <div className="checkbox-list">
                {libraryNames.map((libName) => (
                  <label key={libName} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={options.selectedLibraries.includes(libName)}
                      onChange={() => handleLibraryToggle(libName)}
                      disabled={disabled}
                    />
                    <span>{libName}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Overlay Selection */}
          {overlayFiles.length > 0 && (
            <div className="options-section">
              <h4 className="section-title">Overlay Files</h4>
              <p className="section-hint">
                Leave all unchecked to include all overlays
              </p>
              <div className="checkbox-list scrollable">
                {overlayFiles.map((overlay) => (
                  <label key={overlay} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={options.selectedOverlays.includes(overlay)}
                      onChange={() => handleOverlayToggle(overlay)}
                      disabled={disabled}
                    />
                    <span className="overlay-name">{overlay}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Reset Button */}
          {isFiltered && (
            <div className="options-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleReset}
                disabled={disabled}
              >
                Reset to Defaults
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`
        .test-options-panel {
          background-color: var(--bg-secondary);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-color);
          overflow: hidden;
        }

        .options-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1rem;
          cursor: pointer;
          user-select: none;
        }

        .options-header:hover {
          background-color: var(--bg-tertiary);
        }

        .options-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 500;
        }

        .expand-icon {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .filter-badge {
          background-color: var(--primary);
          color: white;
          padding: 0.125rem 0.5rem;
          border-radius: var(--radius-sm);
          font-size: 0.75rem;
          font-weight: 500;
        }

        .options-summary {
          color: var(--text-muted);
          font-size: 0.875rem;
        }

        .options-content {
          border-top: 1px solid var(--border-color);
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .options-section {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .section-title {
          margin: 0;
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-secondary);
        }

        .section-hint {
          margin: 0;
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .section-actions {
          display: flex;
          gap: 0.5rem;
        }

        .btn-link {
          background: none;
          border: none;
          color: var(--primary);
          cursor: pointer;
          font-size: 0.75rem;
          padding: 0;
        }

        .btn-link:hover {
          text-decoration: underline;
        }

        .btn-link:disabled {
          color: var(--text-muted);
          cursor: not-allowed;
        }

        .checkbox-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 0.5rem;
        }

        .checkbox-list {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }

        .checkbox-list.scrollable {
          max-height: 200px;
          overflow-y: auto;
        }

        .target-list {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }

        .checkbox-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          font-size: 0.875rem;
        }

        .checkbox-item.disabled-by-type {
          opacity: 0.5;
        }

        .checkbox-item input {
          margin: 0;
        }

        .target-label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .target-type {
          font-size: 0.75rem;
          color: var(--text-muted);
          background-color: var(--bg-tertiary);
          padding: 0.125rem 0.375rem;
          border-radius: var(--radius-sm);
        }

        .overlay-name {
          font-family: var(--font-mono);
          font-size: 0.8rem;
          word-break: break-all;
        }

        .effective-count {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-top: 0.25rem;
        }

        .options-footer {
          border-top: 1px solid var(--border-color);
          padding-top: 1rem;
        }
      `}</style>
    </div>
  )
}

export default TestOptionsPanel
