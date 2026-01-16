import { useState, useEffect } from 'react'
import {
  getCommunityContributors,
  getContributorConfigs,
  getCommunityConfig,
  parseCommunityOverlays,
  type CommunityContributor,
  type CommunityConfig
} from '../../api/client'
import './CommunityBrowser.css'

interface CommunityBrowserProps {
  onImportConfig: (config: string, metadata: { username: string; filename: string; url: string }) => void
}

function CommunityBrowser({ onImportConfig }: CommunityBrowserProps) {
  const [contributors, setContributors] = useState<CommunityContributor[]>([])
  const [selectedContributor, setSelectedContributor] = useState<string | null>(null)
  const [configs, setConfigs] = useState<CommunityConfig[]>([])
  const [selectedConfig, setSelectedConfig] = useState<CommunityConfig | null>(null)
  const [configContent, setConfigContent] = useState<string | null>(null)
  const [configUrl, setConfigUrl] = useState<string | null>(null)
  const [overlays, setOverlays] = useState<string[]>([])

  const [loadingContributors, setLoadingContributors] = useState(true)
  const [loadingConfigs, setLoadingConfigs] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')

  // Load contributors on mount
  useEffect(() => {
    loadContributors()
  }, [])

  // Load configs when contributor is selected
  useEffect(() => {
    if (selectedContributor) {
      loadConfigs(selectedContributor)
    }
  }, [selectedContributor])

  // Load config content when config is selected
  useEffect(() => {
    if (selectedContributor && selectedConfig) {
      loadConfigContent(selectedContributor, selectedConfig.name)
    }
  }, [selectedContributor, selectedConfig])

  const loadContributors = async () => {
    try {
      setLoadingContributors(true)
      setError(null)
      const data = await getCommunityContributors()
      setContributors(data.contributors)

      if (data.contributors.length === 0) {
        setError('No contributors with overlay configs found')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contributors')
    } finally {
      setLoadingContributors(false)
    }
  }

  const loadConfigs = async (username: string) => {
    try {
      setLoadingConfigs(true)
      setError(null)
      setConfigs([])
      setSelectedConfig(null)
      setConfigContent(null)
      setOverlays([])

      const data = await getContributorConfigs(username)

      // Filter configs to only include those with overlays
      const configsWithOverlays: CommunityConfig[] = []

      for (const config of data.configs) {
        try {
          // Fetch and parse each config to check for overlays
          const configData = await getCommunityConfig(username, config.name)
          const parsed = await parseCommunityOverlays(configData.content)

          // Only include configs that have overlays
          if (parsed.success && parsed.overlays.length > 0) {
            configsWithOverlays.push(config)
          }
        } catch (error) {
          // Skip configs that fail to parse
          console.warn(`Failed to check config ${config.name}:`, error)
        }
      }

      setConfigs(configsWithOverlays)

      if (configsWithOverlays.length === 0) {
        setError('No configs with overlays found for this contributor')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configs')
    } finally {
      setLoadingConfigs(false)
    }
  }

  const loadConfigContent = async (username: string, filename: string) => {
    try {
      setLoadingContent(true)
      setError(null)
      setConfigContent(null)
      setOverlays([])

      const data = await getCommunityConfig(username, filename)
      setConfigContent(data.content)
      setConfigUrl(data.url)

      // Parse overlays from content
      try {
        const parsed = await parseCommunityOverlays(data.content)
        if (parsed.success) {
          setOverlays(parsed.overlays)
        }
      } catch (parseErr) {
        console.warn('Failed to parse overlays:', parseErr)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config content')
    } finally {
      setLoadingContent(false)
    }
  }

  const handleImport = () => {
    if (configContent && selectedContributor && selectedConfig && configUrl) {
      onImportConfig(configContent, {
        username: selectedContributor,
        filename: selectedConfig.name,
        url: configUrl
      })
    }
  }

  const filteredContributors = contributors.filter(c =>
    c.username.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="community-browser">
      <div className="browser-header">
        <div className="header-top">
          <h3>Community Configs</h3>
          <span className="contributor-count">
            {contributors.length} contributors
          </span>
        </div>
        <p className="browser-description">
          Browse and import overlay configurations from the Kometa community
        </p>
      </div>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="close-button">×</button>
        </div>
      )}

      <div className="browser-layout">
        {/* Left panel: Contributors list */}
        <div className="contributors-panel">
          <div className="panel-header">
            <h4>Contributors</h4>
          </div>

          <div className="search-box">
            <input
              type="text"
              placeholder="Search contributors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="contributors-list">
            {loadingContributors ? (
              <div className="loading-state">
                <div className="spinner" />
                <p>Loading contributors...</p>
              </div>
            ) : filteredContributors.length === 0 ? (
              <div className="empty-state">
                <p>No contributors found</p>
              </div>
            ) : (
              filteredContributors.map((contributor) => (
                <button
                  key={contributor.username}
                  className={`contributor-item ${selectedContributor === contributor.username ? 'active' : ''}`}
                  onClick={() => setSelectedContributor(contributor.username)}
                >
                  <span className="contributor-icon">👤</span>
                  <span className="contributor-name">{contributor.username}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Middle panel: Configs list */}
        <div className="configs-panel">
          <div className="panel-header">
            <h4>
              {selectedContributor ? `${selectedContributor}'s Configs` : 'Select a contributor'}
            </h4>
          </div>

          <div className="configs-list">
            {!selectedContributor ? (
              <div className="empty-state">
                <span className="empty-icon">📁</span>
                <p>Select a contributor to view their configs</p>
              </div>
            ) : loadingConfigs ? (
              <div className="loading-state">
                <div className="spinner" />
                <p>Loading configs...</p>
              </div>
            ) : configs.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">📄</span>
                <p>No configs found</p>
              </div>
            ) : (
              configs.map((config) => (
                <button
                  key={config.path}
                  className={`config-item ${selectedConfig?.path === config.path ? 'active' : ''}`}
                  onClick={() => setSelectedConfig(config)}
                >
                  <div className="config-info">
                    <span className="config-icon">📄</span>
                    <span className="config-name">{config.name}</span>
                  </div>
                  <span className="config-size">{formatFileSize(config.size)}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right panel: Config preview and import */}
        <div className="preview-panel">
          <div className="panel-header">
            <h4>
              {selectedConfig ? selectedConfig.name : 'Select a config'}
            </h4>
          </div>

          <div className="preview-content">
            {!selectedConfig ? (
              <div className="empty-state">
                <span className="empty-icon">👁️</span>
                <p>Select a config to preview</p>
              </div>
            ) : loadingContent ? (
              <div className="loading-state">
                <div className="spinner" />
                <p>Loading config...</p>
              </div>
            ) : configContent ? (
              <>
                <div className="config-metadata">
                  <div className="metadata-row">
                    <span className="metadata-label">Contributor:</span>
                    <span className="metadata-value">{selectedContributor}</span>
                  </div>
                  <div className="metadata-row">
                    <span className="metadata-label">File:</span>
                    <span className="metadata-value">{selectedConfig.name}</span>
                  </div>
                  <div className="metadata-row">
                    <span className="metadata-label">Size:</span>
                    <span className="metadata-value">{formatFileSize(selectedConfig.size)}</span>
                  </div>
                  {overlays.length > 0 && (
                    <div className="metadata-row">
                      <span className="metadata-label">Overlays Found:</span>
                      <span className="metadata-value">{overlays.length}</span>
                    </div>
                  )}
                </div>

                {overlays.length > 0 && (
                  <div className="overlays-preview">
                    <h5>Detected Overlays:</h5>
                    <div className="overlay-tags">
                      {overlays.map((overlay, idx) => (
                        <span key={idx} className="overlay-tag">
                          {overlay}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="config-code">
                  <div className="code-header">
                    <span>YAML Content</span>
                    {configUrl && (
                      <a
                        href={configUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="github-link"
                      >
                        View on GitHub →
                      </a>
                    )}
                  </div>
                  <pre className="code-block">
                    <code>{configContent}</code>
                  </pre>
                </div>

                <div className="import-actions">
                  <button
                    className="import-button primary"
                    onClick={handleImport}
                  >
                    Import Configuration
                  </button>
                  <p className="import-note">
                    This will load the config into your builder for customization
                  </p>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CommunityBrowser
