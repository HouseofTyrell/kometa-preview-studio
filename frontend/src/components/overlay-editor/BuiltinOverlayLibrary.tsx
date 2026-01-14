import { useMemo, useState } from 'react'
import { BUILTIN_OVERLAYS, BuiltinOverlay } from '../../types/overlayConfig'

interface BuiltinOverlayLibraryProps {
  onAddOverlay: (overlay: BuiltinOverlay) => void
  addedOverlayIds: string[]
  disabled?: boolean
}

function BuiltinOverlayLibrary({
  onAddOverlay,
  addedOverlayIds,
  disabled = false,
}: BuiltinOverlayLibraryProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['Quality', 'Ratings', 'Services'])
  )

  // Group overlays by category
  const groupedOverlays = useMemo(() => {
    const groups: Record<string, BuiltinOverlay[]> = {}
    for (const overlay of BUILTIN_OVERLAYS) {
      if (!groups[overlay.category]) {
        groups[overlay.category] = []
      }
      groups[overlay.category].push(overlay)
    }
    return groups
  }, [])

  // Filter overlays by search term
  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return groupedOverlays

    const term = searchTerm.toLowerCase()
    const filtered: Record<string, BuiltinOverlay[]> = {}

    for (const [category, overlays] of Object.entries(groupedOverlays)) {
      const matchingOverlays = overlays.filter(
        (o) =>
          o.name.toLowerCase().includes(term) ||
          o.description.toLowerCase().includes(term) ||
          o.category.toLowerCase().includes(term)
      )
      if (matchingOverlays.length > 0) {
        filtered[category] = matchingOverlays
      }
    }

    return filtered
  }, [groupedOverlays, searchTerm])

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const isOverlayAdded = (id: string) => addedOverlayIds.includes(id)

  return (
    <div className="overlay-library">
      <div className="library-header">
        <h3 className="library-title">Overlay Library</h3>
      </div>

      <div className="library-search">
        <input
          type="text"
          className="search-input"
          placeholder="Search overlays..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="library-content">
        {Object.entries(filteredGroups).map(([category, overlays]) => (
          <div key={category} className="category-section">
            <button
              type="button"
              className="category-header"
              onClick={() => toggleCategory(category)}
            >
              <span className="category-icon">
                {expandedCategories.has(category) ? '▼' : '▶'}
              </span>
              <span className="category-name">{category}</span>
              <span className="category-count">{overlays.length}</span>
            </button>

            {expandedCategories.has(category) && (
              <div className="category-overlays">
                {overlays.map((overlay) => {
                  const isAdded = isOverlayAdded(overlay.id)
                  return (
                    <button
                      key={overlay.id}
                      type="button"
                      className={`overlay-item ${isAdded ? 'added' : ''}`}
                      onClick={() => !isAdded && onAddOverlay(overlay)}
                      disabled={disabled || isAdded}
                      title={isAdded ? 'Already added' : `Add ${overlay.name} overlay`}
                    >
                      <span className="overlay-icon">{overlay.icon}</span>
                      <div className="overlay-info">
                        <span className="overlay-name">{overlay.name}</span>
                        <span className="overlay-desc">{overlay.description}</span>
                      </div>
                      <span className="overlay-action">
                        {isAdded ? '✓' : '+'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        {Object.keys(filteredGroups).length === 0 && (
          <div className="no-results">
            No overlays match "{searchTerm}"
          </div>
        )}
      </div>

      <style>{`
        .overlay-library {
          display: flex;
          flex-direction: column;
          height: 100%;
          background-color: var(--bg-secondary);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-color);
          overflow: hidden;
        }

        .library-header {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--border-color);
        }

        .library-title {
          margin: 0;
          font-size: 0.875rem;
          font-weight: 600;
        }

        .library-search {
          padding: 0.75rem;
          border-bottom: 1px solid var(--border-color);
        }

        .search-input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          background-color: var(--bg-primary);
          color: var(--text-primary);
          font-size: 0.875rem;
        }

        .search-input:focus {
          outline: none;
          border-color: var(--primary);
        }

        .search-input::placeholder {
          color: var(--text-muted);
        }

        .library-content {
          flex: 1;
          overflow-y: auto;
          padding: 0.5rem;
        }

        .category-section {
          margin-bottom: 0.5rem;
        }

        .category-header {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          background-color: transparent;
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
          text-align: left;
          color: var(--text-secondary);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .category-header:hover {
          background-color: var(--bg-tertiary);
        }

        .category-icon {
          font-size: 0.625rem;
          color: var(--text-muted);
        }

        .category-name {
          flex: 1;
        }

        .category-count {
          background-color: var(--bg-tertiary);
          padding: 0.125rem 0.375rem;
          border-radius: var(--radius-sm);
          font-size: 0.625rem;
        }

        .category-overlays {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          padding: 0.25rem 0 0.25rem 1.5rem;
        }

        .overlay-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem 0.75rem;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          cursor: pointer;
          text-align: left;
          transition: all 0.15s ease;
        }

        .overlay-item:hover:not(:disabled) {
          border-color: var(--primary);
          background-color: var(--bg-tertiary);
        }

        .overlay-item:disabled {
          cursor: not-allowed;
        }

        .overlay-item.added {
          opacity: 0.6;
          background-color: var(--bg-secondary);
        }

        .overlay-icon {
          font-size: 1.25rem;
        }

        .overlay-info {
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

        .overlay-desc {
          font-size: 0.75rem;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .overlay-action {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--primary);
          color: white;
          border-radius: 50%;
          font-size: 0.875rem;
          font-weight: bold;
        }

        .overlay-item.added .overlay-action {
          background-color: var(--success);
        }

        .no-results {
          padding: 2rem 1rem;
          text-align: center;
          color: var(--text-muted);
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  )
}

export default BuiltinOverlayLibrary
