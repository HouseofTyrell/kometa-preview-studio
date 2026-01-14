import { useState } from 'react'
import { createFromCredentials, testPlexConnection, ConfigAnalysis, PlexLibrary } from '../api/client'
import './PlexCredentialsForm.css'

interface PlexCredentialsFormProps {
  onSuccess: (analysis: ConfigAnalysis, configYaml: string) => void
  onCancel: () => void
}

function PlexCredentialsForm({ onSuccess, onCancel }: PlexCredentialsFormProps) {
  const [plexUrl, setPlexUrl] = useState('')
  const [plexToken, setPlexToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message?: string
    libraries?: PlexLibrary[]
  } | null>(null)

  const validateInputs = (): boolean => {
    if (!plexUrl.trim()) {
      setError('Plex URL is required')
      return false
    }
    if (!plexToken.trim()) {
      setError('Plex token is required')
      return false
    }

    try {
      new URL(plexUrl)
    } catch {
      setError('Invalid URL format. Example: http://192.168.1.100:32400')
      return false
    }

    return true
  }

  const handleTestConnection = async () => {
    if (!validateInputs()) return

    setIsTesting(true)
    setError(null)
    setTestResult(null)

    try {
      const result = await testPlexConnection(plexUrl.trim(), plexToken.trim())
      setTestResult(result)
      if (!result.success) {
        setError(result.error || 'Connection failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed')
      setTestResult({ success: false })
    } finally {
      setIsTesting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateInputs()) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await createFromCredentials(plexUrl.trim(), plexToken.trim())
      onSuccess(result.analysis, result.configYaml)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create config')
    } finally {
      setIsLoading(false)
    }
  }

  const isDisabled = isLoading || isTesting
  const canTest = plexUrl.trim() && plexToken.trim() && !isDisabled

  return (
    <div className="card plex-credentials-form">
      <h2 className="card-title">Start from Scratch</h2>
      <p className="form-description">
        Enter your Plex server details to start creating overlays from scratch.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="plex-url">
            Plex URL
          </label>
          <input
            id="plex-url"
            type="text"
            className="form-input"
            value={plexUrl}
            onChange={(e) => {
              setPlexUrl(e.target.value)
              setTestResult(null)
            }}
            placeholder="http://192.168.1.100:32400"
            disabled={isDisabled}
          />
          <span className="form-hint">
            Your Plex server address (e.g., http://localhost:32400 or https://plex.example.com)
          </span>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="plex-token">
            Plex Token
          </label>
          <input
            id="plex-token"
            type="password"
            className="form-input"
            value={plexToken}
            onChange={(e) => {
              setPlexToken(e.target.value)
              setTestResult(null)
            }}
            placeholder="Enter your Plex token"
            disabled={isDisabled}
          />
          <span className="form-hint">
            <a
              href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
              target="_blank"
              rel="noopener noreferrer"
              className="hint-link"
            >
              How to find your Plex token
            </a>
          </span>
        </div>

        {/* Test Connection Button */}
        <div className="test-connection-section">
          <button
            type="button"
            className="btn btn-secondary test-btn"
            onClick={handleTestConnection}
            disabled={!canTest}
          >
            {isTesting ? 'Testing...' : 'Test Connection'}
          </button>

          {testResult && (
            <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
              {testResult.success ? (
                <>
                  <span className="test-icon">✓</span>
                  <span>{testResult.message}</span>
                </>
              ) : (
                <>
                  <span className="test-icon">✕</span>
                  <span>Connection failed</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Libraries List */}
        {testResult?.success && testResult.libraries && testResult.libraries.length > 0 && (
          <div className="libraries-section">
            <label className="form-label">Detected Libraries</label>
            <div className="libraries-list">
              {testResult.libraries.map((lib) => (
                <div key={lib.key} className="library-item">
                  <span className="library-icon">
                    {lib.type === 'movie' ? '🎬' : lib.type === 'show' ? '📺' : '📁'}
                  </span>
                  <span className="library-name">{lib.title}</span>
                  <span className="library-type">{lib.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="alert alert-error">
            {error}
          </div>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isDisabled}
          >
            Back
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isDisabled || !plexUrl.trim() || !plexToken.trim()}
          >
            {isLoading ? 'Creating...' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default PlexCredentialsForm
