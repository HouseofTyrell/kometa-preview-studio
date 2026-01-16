import { useState, useMemo } from 'react'
import {
  PMM_OVERLAY_DEFAULTS,
  PMM_CATEGORIES,
  getOverlaysByCategory,
  searchOverlays,
  type PMMCategory,
  type PMMOverlayDefault
} from '../../constants/pmmDefaults'
import './DefaultsLibrary.css'

interface DefaultsLibraryProps {
  onSelectOverlay: (overlay: PMMOverlayDefault) => void
  enabledOverlayIds: string[]
}

function DefaultsLibrary({ onSelectOverlay, enabledOverlayIds }: DefaultsLibraryProps) {
  const [selectedCategory, setSelectedCategory] = useState<PMMCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedOverlay, setExpandedOverlay] = useState<string | null>(null)

  const filteredOverlays = useMemo(() => {
    let overlays = PMM_OVERLAY_DEFAULTS

    // Filter by category
    if (selectedCategory !== 'all') {
      overlays = getOverlaysByCategory(selectedCategory)
    }

    // Filter by search query
    if (searchQuery.trim()) {
      overlays = searchOverlays(searchQuery)
    }

    return overlays
  }, [selectedCategory, searchQuery])

  const handleToggleExpand = (overlayId: string) => {
    setExpandedOverlay(expandedOverlay === overlayId ? null : overlayId)
  }

  const isOverlayEnabled = (overlayId: string) => {
    return enabledOverlayIds.includes(overlayId)
  }

  return (
    <div className="defaults-library">
      <div className="library-header">
        <div className="header-top">
          <h3>PMM Defaults Library</h3>
          <span className="overlay-count">{filteredOverlays.length} overlays</span>
        </div>
        <p className="library-description">
          Browse and enable Kometa's built-in overlay defaults
        </p>
      </div>

      <div className="library-controls">
        <input
          type="text"
          className="search-input"
          placeholder="Search overlays..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="category-tabs">
        <button
          className={`category-tab ${selectedCategory === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('all')}
        >
          <span className="tab-icon">📦</span>
          <span className="tab-label">All</span>
          <span className="tab-count">{PMM_OVERLAY_DEFAULTS.length}</span>
        </button>
        {Object.entries(PMM_CATEGORIES).map(([key, category]) => (
          <button
            key={key}
            className={`category-tab ${selectedCategory === key ? 'active' : ''}`}
            onClick={() => setSelectedCategory(key as PMMCategory)}
          >
            <span className="tab-icon">{category.icon}</span>
            <span className="tab-label">{category.name}</span>
            <span className="tab-count">{getOverlaysByCategory(key as PMMCategory).length}</span>
          </button>
        ))}
      </div>

      <div className="overlays-grid">
        {filteredOverlays.length === 0 ? (
          <div className="no-results">
            <span className="no-results-icon">🔍</span>
            <p>No overlays found</p>
            <small>Try adjusting your search or category filter</small>
          </div>
        ) : (
          filteredOverlays.map((overlay) => (
            <div
              key={overlay.id}
              className={`overlay-card ${isOverlayEnabled(overlay.id) ? 'enabled' : ''} ${
                expandedOverlay === overlay.id ? 'expanded' : ''
              }`}
            >
              <div className="card-header" onClick={() => handleToggleExpand(overlay.id)}>
                <div className="card-title-row">
                  <span className="overlay-icon">{overlay.icon}</span>
                  <h4 className="overlay-name">{overlay.name}</h4>
                  {isOverlayEnabled(overlay.id) && (
                    <span className="enabled-badge">✓ Enabled</span>
                  )}
                </div>
                <button className="expand-button" type="button">
                  {expandedOverlay === overlay.id ? '▼' : '▶'}
                </button>
              </div>

              <p className="overlay-description">{overlay.description}</p>

              <div className="card-meta">
                <span className="category-badge">
                  {PMM_CATEGORIES[overlay.category].icon} {PMM_CATEGORIES[overlay.category].name}
                </span>
                <span className="media-types">
                  {overlay.mediaTypes.map((type) => (
                    <span key={type} className="media-type-badge">
                      {type}
                    </span>
                  ))}
                </span>
              </div>

              {expandedOverlay === overlay.id && (
                <div className="card-details">
                  <div className="detail-section">
                    <h5>YAML Key</h5>
                    <code className="yaml-key">{overlay.pmmKey}</code>
                  </div>

                  {overlay.templateVariables && overlay.templateVariables.length > 0 && (
                    <div className="detail-section">
                      <h5>Template Variables</h5>
                      <div className="template-variables">
                        {overlay.templateVariables.map((variable) => (
                          <div key={variable.key} className="variable-item">
                            <span className="variable-name">{variable.name}</span>
                            <span className="variable-default">Default: {String(variable.default)}</span>
                            <p className="variable-description">{variable.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="detail-actions">
                    <a
                      href={overlay.documentationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="doc-link"
                    >
                      📖 Documentation
                    </a>
                  </div>
                </div>
              )}

              <button
                className={`enable-button ${isOverlayEnabled(overlay.id) ? 'enabled' : ''}`}
                onClick={() => onSelectOverlay(overlay)}
              >
                {isOverlayEnabled(overlay.id) ? '✓ Enabled' : '+ Enable Overlay'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default DefaultsLibrary
